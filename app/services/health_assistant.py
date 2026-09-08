from collections.abc import AsyncIterator
from typing import Any, cast

from app.dtos.health_assistant import (
    HealthAssistantChatRequest,
    HealthAssistantResponse,
    ProfileContext,
    UserLocation,
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
from app.services.outdoor_conditions_client import (
    OutdoorConditionsClient,
    OutdoorConditionsClientProtocol,
    resolve_sido_coordinates,
)
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
_FACILITY_KEYWORDS = (
    "응급실",
    "병원",
    "의원",
    "약국",
    "당직의료",
    "당번약국",
    "야간약국",
    "야간진료",
    "응급의료",
    "내과",
    "외과",
    "이비인후과",
    "소아과",
    "소아청소년과",
    "신경과",
    "정신과",
    "정신건강의학과",
    "정형외과",
    "신경외과",
    "성형외과",
    "산부인과",
    "안과",
    "피부과",
    "비뇨의학과",
    "비뇨기과",
    "영상의학과",
    "마취통증의학과",
    "통증의학과",
    "재활의학과",
    "가정의학과",
    "응급의학과",
    "치과",
    "한방",
    "한의원",
    "진료소",
    "보건소",
    "의료원",
    "진료",
    "처방",
    "문 연 곳",
    "문연 곳",
    "어디 가야",
    "어디로 가",
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
    def _needs_facility_tools(request: HealthAssistantChatRequest) -> bool:
        """의료시설 조회 도구가 실제로 필요한 질문인지 판별한다."""
        if not request.messages:
            return False
        last_msg = request.messages[-1].content
        # 날씨나 대기질을 묻는 질문은 의료시설 조회가 아님
        if any(w in last_msg for w in ("날씨", "미세먼지", "초미세먼지", "대기질")):
            return False
        # 단순히 거주지나 위치만 말한 경우("난 서울살아", "종로구에 있어")도 시설 조회가 아님
        if any(last_msg.strip().endswith(suffix) for suffix in ("살아", "살아요", "있어", "있어요")) and not any(
            k in last_msg for k in ("병원", "약국", "응급실", "의원")
        ):
            return False
        # 의료시설 관련 키워드 확인
        if any(k in last_msg for k in _FACILITY_KEYWORDS):
            return True
        # 이전 어시스턴트 메시지가 시설 위치를 되묻던 상황인지 확인
        if len(request.messages) >= 2:
            prev_msg = request.messages[-2]
            if prev_msg.role == "assistant" and any(
                k in prev_msg.content for k in ("가까운 병원이나 약국", "의료시설", "찾으시는 지역명")
            ):
                return True
        return False

    @staticmethod
    def _resolve_request_location(request: HealthAssistantChatRequest) -> UserLocation | None:
        """요청에 위치가 없더라도 최근 대화에서 시도 명칭이 있으면 대표 좌표로 보정한다."""
        loc = request.location
        if loc is not None:
            return loc
        if request.messages:
            for m in reversed(request.messages[-3:]):
                resolved = resolve_sido_coordinates(m.content)
                if resolved:
                    sido, lat, lon = resolved
                    return UserLocation(
                        latitude=lat,
                        longitude=lon,
                        address=f"{sido}특별시" if sido == "서울" else sido,
                    )
        return None

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
        if any(keyword in message for keyword in _OUTDOOR_ACTIVITY_KEYWORDS) or (
            "운동" in message and any(k in message for k in ("추천", "할까", "할건", "할거", "예정", "계획", "뭐"))
        ):
            return True
        # 이전 턴에서 위치 미확인으로 날씨 조회를 못했을 때 사용자가 거주지/지역명을 답변한 경우
        if len(request.messages) >= 2:
            prev_msg = request.messages[-2]
            if prev_msg.role == "assistant" and any(
                k in prev_msg.content for k in ("실시간 날씨", "날씨와 대기질", "외출 전 기온", "날씨를 확인")
            ):
                if resolve_sido_coordinates(message) is not None or "살아" in message:
                    return True
        return False

    async def _load_outdoor_conditions(self, request: HealthAssistantChatRequest, loc: UserLocation | None):
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
        loc = self._resolve_request_location(request)
        outdoor_conditions = await self._load_outdoor_conditions(request, loc)
        system_instruction = build_system_instruction(
            profile_context,
            user_location=loc,
            outdoor_conditions_context=self._format_outdoor_conditions_context(outdoor_conditions, loc is not None)
            if self._needs_outdoor_conditions(request)
            else None,
        )

        tools = get_facility_tools() if self._needs_facility_tools(request) else None
        response: HealthAssistantResponse
        client_any = cast(Any, self.llm_client)

        if tools and hasattr(client_any, "generate_structured_response_with_tools"):
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
        loc = self._resolve_request_location(request)
        outdoor_conditions = await self._load_outdoor_conditions(request, loc)
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

        tools = get_facility_tools() if self._needs_facility_tools(request) else None
        client_any = cast(Any, self.llm_client)

        if tools and hasattr(client_any, "stream_structured_response_with_tools"):
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
