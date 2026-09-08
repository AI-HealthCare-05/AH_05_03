from collections.abc import AsyncIterator
from typing import Any, cast

from app.dtos.health_assistant import (
    HealthAssistantChatRequest,
    HealthAssistantResponse,
    ProfileContext,
)
from app.exceptions import LlmProviderFailedError
from app.integrations.llm.chain import shared_chat_client
from app.integrations.llm.protocol import LLMClientProtocol
from app.prompts.health_assistant import build_system_instruction
from app.repositories.health_record_repository import HealthRecordRepository
from app.services.health_assistant_safety import HealthAssistantSafetyService
from app.services.medical_facility_client import MedicalFacilityClient
from app.services.medical_facility_tools import (
    execute_facility_tool,
    get_facility_tools,
)
from app.services.ocr_partial import PartialJsonTextReader
from app.services.outdoor_conditions_client import OutdoorConditionsClient, OutdoorConditionsClientProtocol
from app.services.outdoor_conditions_tools import execute_outdoor_conditions_tool

_OUTDOOR_ENVIRONMENT_KEYWORDS = ("날씨", "미세먼지", "초미세먼지", "대기질")
_OUTDOOR_ACTIVITY_KEYWORDS = (
    "산책",
    "조깅",
    "러닝",
    "달리기",
    "유산소",
    "자전거",
    "라이딩",
    "걷기",
    "운동추천",
    "운동할",
    "야외",
    "밖에서",
    "외출",
)


class HealthAssistantService:
    """통합 건강 어시스턴트 (봄이) 서비스.

    자연어 입력을 분석하여 건강기록(운동, 혈압, 혈당, 복약, 통증 등) 추출,
    기록 조회 의도 분류, 주변 의료시설(응급실, 병원, 약국) 도구 호출(Tool Calling),
    안전 가이드라인 기반 상담 응답을 생성합니다.
    """

    def __init__(
        self,
        llm_client: LLMClientProtocol | None = None,
        safety_service: HealthAssistantSafetyService | None = None,
        facility_client: MedicalFacilityClient | None = None,
        record_repo: HealthRecordRepository | None = None,
        outdoor_conditions_client: OutdoorConditionsClientProtocol | None = None,
    ):
        self._llm_client = llm_client
        self.safety_service = safety_service or HealthAssistantSafetyService()
        self.facility_client = facility_client or MedicalFacilityClient()
        self.record_repo = record_repo
        self.outdoor_conditions_client = outdoor_conditions_client or OutdoorConditionsClient()

    @staticmethod
    def _needs_outdoor_conditions(request: HealthAssistantChatRequest) -> bool:
        """실시간 API가 필요한 질문만 판별한다.

        모든 대화에 외부 API를 호출하면 느려지고 할당량을 낭비한다. 이 라우팅은
        도구의 호출 조건만 정하며, 최종 건강 안내 문장은 모델의 안전 지침을 거친다.
        """
        if not request.messages:
            return False
        message = request.messages[-1].content.replace(" ", "")
        if any(keyword in message for keyword in _OUTDOOR_ENVIRONMENT_KEYWORDS):
            return True
        if any(
            keyword in message
            for keyword in ("했어", "완료", "기록해", "기록할", "기록하기", "달렸어", "뛰었어", "걸었어", "탔어")
        ):
            return False
        return any(keyword in message for keyword in _OUTDOOR_ACTIVITY_KEYWORDS) or (
            "운동" in message and any(k in message for k in ("추천", "할까", "할건", "할거", "예정", "계획", "뭐"))
        )

    async def _load_outdoor_conditions(self, request: HealthAssistantChatRequest):
        loc = request.location
        if not self._needs_outdoor_conditions(request) or loc is None:
            return None
        return await execute_outdoor_conditions_tool(
            "get_outdoor_health_conditions",
            {
                "latitude": loc.latitude,
                "longitude": loc.longitude,
            },
            self.outdoor_conditions_client,
        )

    @staticmethod
    def _format_outdoor_conditions_context(result: Any | None, location_available: bool) -> str | None:
        if result is None:
            return (
                "현재 위치가 제공되지 않아 실시간 날씨·대기질을 조회하지 못했습니다."
                if not location_available
                else None
            )

        lines: list[str] = []
        is_raining = False
        bad_air = False
        if result.weather:
            weather = result.weather
            is_raining = bool(weather.precipitation_type and weather.precipitation_type != "강수 없음")
            lines.append(
                "날씨: "
                f"기온 {weather.temperature_c if weather.temperature_c is not None else '확인 불가'}℃, "
                f"습도 {weather.humidity_percent if weather.humidity_percent is not None else '확인 불가'}%, "
                f"강수 {weather.precipitation_type}, "
                f"풍속 {weather.wind_speed_mps if weather.wind_speed_mps is not None else '확인 불가'}m/s"
            )
        if result.air_quality:
            air = result.air_quality
            bad_air = bool(
                (air.pm10_grade in ("나쁨", "매우 나쁨", "매우나쁨"))
                or (air.pm25_grade in ("나쁨", "매우 나쁨", "매우나쁨"))
            )
            lines.append(
                "대기질: "
                f"{air.region_name} {air.station_name or '측정소'}, "
                f"PM10 {air.pm10 if air.pm10 is not None else '확인 불가'}㎍/㎥({air.pm10_grade or '등급 확인 불가'}), "
                f"PM2.5 {air.pm25 if air.pm25 is not None else '확인 불가'}㎍/㎥({air.pm25_grade or '등급 확인 불가'})"
            )
        if is_raining or bad_air:
            reasons = []
            if is_raining:
                reasons.append("비/강수")
            if bad_air:
                reasons.append("미세먼지 나쁨")
            lines.append(
                f"환경 종합 평가: 야외 활동 비권장 ({', '.join(reasons)} - 야외 유산소 대신 실내 운동 추천 필요)"
            )
        elif result.weather and result.air_quality:
            lines.append("환경 종합 평가: 야외 활동 적합 (쾌적한 환경 - 가벼운 산책이나 야외 러닝 적극 추천 가능)")

        if result.errors:
            lines.append("일부 조회 실패: " + "; ".join(result.errors))
        return "\n".join(lines) or "실시간 야외 환경 정보를 불러오지 못했습니다."

    async def _enrich_context(self, context: ProfileContext | None) -> ProfileContext | None:
        if context is None or context.recent_records_summary or not context.profile_id or not self.record_repo:
            return context
        try:
            records = await self.record_repo.list_by_profile(context.profile_id, limit=5)
            if records:
                summaries = []
                for r in records:
                    date_str = r.recorded_at.strftime("%Y-%m-%d")
                    summaries.append(f"[{date_str}] {r.record_type}: {r.payload}")
                context.recent_records_summary = "; ".join(summaries)[:2000]
        except Exception:
            pass
        return context

    @property
    def llm_client(self) -> LLMClientProtocol:
        if self._llm_client is None:
            self._llm_client = shared_chat_client()
        return self._llm_client

    async def _execute_tool(self, name: str, args: dict[str, Any]) -> Any:
        return await execute_facility_tool(name, args, self.facility_client)

    async def respond(self, request: HealthAssistantChatRequest) -> HealthAssistantResponse:
        safety_check = self.safety_service.check_input_safety(request.messages)
        if safety_check:
            return safety_check

        profile_context = await self._enrich_context(request.profile_context)
        outdoor_conditions = await self._load_outdoor_conditions(request)
        loc = request.location
        system_instruction = build_system_instruction(
            profile_context,
            user_location=loc,
            outdoor_conditions_context=self._format_outdoor_conditions_context(outdoor_conditions, loc is not None)
            if self._needs_outdoor_conditions(request)
            else None,
        )

        tools = get_facility_tools()
        response: HealthAssistantResponse
        client_any = cast(Any, self.llm_client)

        if hasattr(client_any, "generate_structured_response_with_tools"):
            res_tuple = await client_any.generate_structured_response_with_tools(
                system_instruction=system_instruction,
                messages=request.messages,
                response_schema=HealthAssistantResponse,
                tools=tools,
                tool_executor=self._execute_tool,
            )
            response, tool_result = res_tuple
            if tool_result and not response.facility_search_draft:
                response.facility_search_draft = tool_result
                if getattr(tool_result, "message", None):
                    response.assistant_message = tool_result.message
        else:
            response = await self.llm_client.generate_structured_response(
                system_instruction=system_instruction,
                messages=request.messages,
                response_schema=HealthAssistantResponse,
            )

        if outdoor_conditions and not response.outdoor_conditions:
            response.outdoor_conditions = outdoor_conditions
        validated_response = self.safety_service.validate_response(response)
        return validated_response

    async def stream(self, request: HealthAssistantChatRequest) -> AsyncIterator[tuple[str, Any]]:
        safety_check = self.safety_service.check_input_safety(request.messages)
        if safety_check:
            yield "delta", {"text": safety_check.assistant_message}
            yield "result", safety_check.model_dump(mode="json")
            return

        profile_context = await self._enrich_context(request.profile_context)
        outdoor_conditions = await self._load_outdoor_conditions(request)
        loc = request.location
        system_instruction = build_system_instruction(
            profile_context,
            user_location=loc,
            outdoor_conditions_context=self._format_outdoor_conditions_context(outdoor_conditions, loc is not None)
            if self._needs_outdoor_conditions(request)
            else None,
        )
        reader = PartialJsonTextReader("assistant_message")
        raw = ""
        tool_result = None

        tools = get_facility_tools()
        client_any = cast(Any, self.llm_client)

        if hasattr(client_any, "stream_structured_response_with_tools"):
            stream_gen, tool_result = await client_any.stream_structured_response_with_tools(
                system_instruction=system_instruction,
                messages=request.messages,
                response_schema=HealthAssistantResponse,
                tools=tools,
                tool_executor=self._execute_tool,
            )
        else:
            stream_gen = self.llm_client.stream_structured_response(
                system_instruction=system_instruction,
                messages=request.messages,
                response_schema=HealthAssistantResponse,
            )

        if tool_result is not None:
            payload = tool_result.model_dump(mode="json") if hasattr(tool_result, "model_dump") else tool_result
            yield "facility", payload
            summary_msg = getattr(tool_result, "message", None) or "주변 의료시설을 조회했습니다."
            yield "delta", {"text": summary_msg}
            res_obj = HealthAssistantResponse(
                intent="search_facility",
                assistant_message=summary_msg,
                facility_search_draft=tool_result,
                outdoor_conditions=outdoor_conditions,
            )
            yield "result", self.safety_service.validate_response(res_obj).model_dump(mode="json")
            return

        async for piece in stream_gen:
            raw += piece
            fresh = reader.push(piece)
            if fresh:
                yield "delta", {"text": fresh}

        try:
            parsed = HealthAssistantResponse.model_validate_json(raw)
            if tool_result and not parsed.facility_search_draft:
                parsed.facility_search_draft = tool_result
            if outdoor_conditions and not parsed.outdoor_conditions:
                parsed.outdoor_conditions = outdoor_conditions
        except Exception as ex:
            raise LlmProviderFailedError(f"응답 구조화 실패: {type(ex).__name__}") from ex

        yield "result", self.safety_service.validate_response(parsed).model_dump(mode="json")
