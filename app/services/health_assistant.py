import re
import uuid
from collections.abc import AsyncIterator
from typing import Any, cast

from app.dtos.health_assistant import (
    HealthAssistantChatRequest,
    HealthAssistantResponse,
    UserLocation,
)
from app.dtos.health_record_query import HealthRecordQueryResult
from app.dtos.medical_facility import FacilitySearchResult
from app.exceptions import LlmProviderFailedError
from app.integrations.llm.chain import shared_chat_client
from app.integrations.llm.protocol import LLMClientProtocol
from app.models.service_accounts import ServiceAccount
from app.prompts.health_assistant import build_system_instruction
from app.services.health_assistant_safety import HealthAssistantSafetyService
from app.services.health_record_tools import (
    QUERY_HEALTH_RECORDS_TOOL_NAME,
    execute_health_record_tool,
    get_health_record_tools,
)
from app.services.health_records import HealthRecordService
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
)
_FACILITY_SEARCH_KEYWORDS = (
    "찾아",
    "검색",
    "조회",
    "알려",
    "추천",
    "가까운",
    "가까이",
    "근처",
    "주변",
    "위치",
    "어디",
    "문 연",
    "문연",
    "진료 중",
    "진료중",
    "운영 중",
    "운영중",
    "가야",
    "갈 수",
    "전화번호",
    "지도",
)
_FACILITY_HISTORY_OR_ADVICE_KEYWORDS = (
    "다녀",
    "갔다",
    "왔어",
    "받았",
    "진료받",
    "처방받",
    "기록해",
    "복용",
    "먹어도",
    "부작용",
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
        health_record_service: HealthRecordService | None = None,
        outdoor_conditions_client: OutdoorConditionsClientProtocol | None = None,
    ):
        self._llm_client = llm_client
        self.safety_service = safety_service or HealthAssistantSafetyService()
        self.facility_client = facility_client or MedicalFacilityClient()
        self.health_record_service = health_record_service
        self.outdoor_conditions_client = outdoor_conditions_client or OutdoorConditionsClient()

    @staticmethod
    def _needs_health_record_query_tool(request: HealthAssistantChatRequest) -> bool:
        """1차 수직 슬라이스인 기간별 혈압 기준 초과 일수 질문만 연다."""

        if not request.messages:
            return False
        message = request.messages[-1].content.replace(" ", "")
        # 현재 도구 스키마는 1~12개월의 rolling period만 표현한다. "최근"처럼
        # 길이가 불명확하거나 "작년"처럼 달력 구간인 표현을 임의 개월 수로 바꾸지 않는다.
        has_period = re.search(r"(?<!\d)(?:[1-9]|1[0-2])개월", message) is not None
        has_threshold = any(word in message for word in ("넘", "초과", "이상"))
        has_day_count = any(word in message for word in ("며칠", "몇일", "몇번", "몇회", "날이", "날은"))
        return "혈압" in message and has_period and has_threshold and has_day_count

    @classmethod
    def _tools_for_request(cls, request: HealthAssistantChatRequest) -> Any:
        if cls._needs_health_record_query_tool(request):
            return get_health_record_tools()
        if cls._needs_facility_tools(request):
            return get_facility_tools()
        return None

    @staticmethod
    def _needs_facility_tools(request: HealthAssistantChatRequest) -> bool:
        """의료시설 조회 도구가 실제로 필요한 질문인지 판별한다."""
        if not request.messages:
            return False
        last_msg = request.messages[-1].content
        compact_msg = last_msg.replace(" ", "")
        # 날씨나 대기질을 묻는 질문은 의료시설 조회가 아님
        if any(w in last_msg for w in ("날씨", "미세먼지", "초미세먼지", "대기질")):
            return False
        # 단순히 거주지나 위치만 말한 경우("난 서울살아", "종로구에 있어")도 시설 조회가 아님
        if any(last_msg.strip().endswith(suffix) for suffix in ("살아", "살아요", "있어", "있어요")) and not any(
            k in last_msg for k in ("병원", "약국", "응급실", "의원")
        ):
            return False
        has_facility = any(k in last_msg for k in _FACILITY_KEYWORDS)
        has_search_intent = any(k in last_msg for k in _FACILITY_SEARCH_KEYWORDS)
        if has_facility and has_search_intent:
            return True
        # "강남응급실", "서울 내과"처럼 짧은 검색어만 입력한 경우는 허용하되,
        # 과거 진료·복약 상담 문장은 시설 검색으로 오인하지 않는다.
        if (
            has_facility
            and len(compact_msg) <= 15
            and not any(k in last_msg for k in _FACILITY_HISTORY_OR_ADVICE_KEYWORDS)
        ):
            return True
        if any(k in last_msg for k in ("어디 가야", "어디로 가")):
            return True
        # 이전 어시스턴트 메시지가 시설 위치를 되묻던 상황인지 확인
        if len(request.messages) >= 2:
            prev_msg = request.messages[-2]
            if prev_msg.role == "assistant" and any(
                k in prev_msg.content for k in ("가까운 병원이나 약국", "의료시설", "찾으시는 지역명")
            ):
                return True
        return False

    async def _resolve_request_location(self, request: HealthAssistantChatRequest) -> UserLocation | None:
        """동의된 좌표를 우선하고, 야외 질문의 사용자 장소명만 보조적으로 좌표화한다."""
        loc = request.location
        if loc is not None:
            return loc

        recent_user_messages = [message for message in request.messages[-3:] if message.role == "user"]
        for message in reversed(recent_user_messages):
            resolved = resolve_sido_coordinates(message.content)
            if resolved:
                sido, lat, lon = resolved
                return UserLocation(
                    latitude=lat,
                    longitude=lon,
                    address=f"{sido}특별시" if sido == "서울" else sido,
                )

        if self._needs_outdoor_conditions(request):
            for message in reversed(recent_user_messages):
                resolved_place = await self.outdoor_conditions_client.resolve_location(message.content)
                if resolved_place:
                    lat, lon, address = resolved_place
                    return UserLocation(latitude=lat, longitude=lon, address=address)
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
    def _temperature_risk(temperature_c: float | None) -> tuple[str | None, str | None]:
        if temperature_c is None:
            return None, None
        if temperature_c >= 33:
            return "폭염 수준 고온", None
        if temperature_c <= -10:
            return "한파 수준 저온", None
        if temperature_c >= 30:
            return None, "높은 기온"
        if temperature_c <= 0:
            return None, "낮은 기온"
        return None, None

    @staticmethod
    def _classify_weather_risks(weather: Any) -> tuple[list[str], list[str]]:
        unsafe_reasons: list[str] = []
        caution_reasons: list[str] = []
        if weather.precipitation_type and weather.precipitation_type != "강수 없음":
            unsafe_reasons.append("비/강수")
        unsafe_temperature, caution_temperature = HealthAssistantService._temperature_risk(weather.temperature_c)
        if unsafe_temperature:
            unsafe_reasons.append(unsafe_temperature)
        if caution_temperature:
            caution_reasons.append(caution_temperature)
        if weather.wind_speed_mps is not None:
            if weather.wind_speed_mps >= 14:
                unsafe_reasons.append("강풍")
            elif weather.wind_speed_mps >= 9:
                caution_reasons.append("강한 바람")
        if (
            weather.temperature_c is not None
            and weather.temperature_c >= 28
            and weather.humidity_percent is not None
            and weather.humidity_percent >= 80
        ):
            caution_reasons.append("고온다습")
        return unsafe_reasons, caution_reasons

    @staticmethod
    def _format_outdoor_conditions_context(result: Any | None, location_available: bool) -> str | None:
        if result is None:
            return (
                "현재 위치가 제공되지 않아 실시간 날씨·대기질을 조회하지 못했습니다."
                if not location_available
                else None
            )

        lines: list[str] = []
        unsafe_reasons: list[str] = []
        caution_reasons: list[str] = []
        if result.weather:
            weather = result.weather
            weather_unsafe, weather_caution = HealthAssistantService._classify_weather_risks(weather)
            unsafe_reasons.extend(weather_unsafe)
            caution_reasons.extend(weather_caution)
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
            if bad_air:
                unsafe_reasons.append("미세먼지 나쁨")
            lines.append(
                "대기질: "
                f"{air.region_name} {air.station_name or '측정소'}, "
                f"PM10 {air.pm10 if air.pm10 is not None else '확인 불가'}㎍/㎥({air.pm10_grade or '등급 확인 불가'}), "
                f"PM2.5 {air.pm25 if air.pm25 is not None else '확인 불가'}㎍/㎥({air.pm25_grade or '등급 확인 불가'})"
            )
        if unsafe_reasons:
            lines.append(
                f"환경 종합 평가: 야외 활동 비권장 ({', '.join(unsafe_reasons)} - 야외 유산소 대신 실내 운동 추천 필요)"
            )
        elif caution_reasons:
            lines.append(
                f"환경 종합 평가: 야외 활동 주의 필요 ({', '.join(caution_reasons)} - "
                "운동 강도와 시간을 낮추고 수분 섭취 및 컨디션 확인 필요)"
            )
        elif result.weather and result.air_quality:
            lines.append("환경 종합 평가: 야외 활동 적합 (쾌적한 환경 - 가벼운 산책이나 야외 러닝 적극 추천 가능)")

        if result.errors:
            lines.append("일부 조회 실패: " + "; ".join(result.errors))
        return "\n".join(lines) or "실시간 야외 환경 정보를 불러오지 못했습니다."

    @property
    def llm_client(self) -> LLMClientProtocol:
        if self._llm_client is None:
            self._llm_client = shared_chat_client()
        return self._llm_client

    async def _execute_tool(
        self,
        name: str,
        args: dict[str, Any],
        *,
        account: ServiceAccount | None = None,
        profile_id: uuid.UUID | None = None,
    ) -> Any:
        if name == QUERY_HEALTH_RECORDS_TOOL_NAME:
            if account is None or profile_id is None or self.health_record_service is None:
                raise ValueError("건강기록 조회에 필요한 인증 프로필 정보가 없습니다.")
            return await execute_health_record_tool(
                name,
                args,
                account=account,
                profile_id=profile_id,
                record_service=self.health_record_service,
            )
        return await execute_facility_tool(name, args, self.facility_client)

    @staticmethod
    def _profile_required_response() -> HealthAssistantResponse:
        return HealthAssistantResponse(
            intent="query_records",
            assistant_message="건강기록을 조회할 대상을 확인할 수 없습니다. 먼저 대화할 프로필을 선택해 주세요.",
            missing_fields=["profile_id"],
            needs_confirmation=False,
        )

    async def respond(
        self,
        request: HealthAssistantChatRequest,
        account: ServiceAccount | None = None,
    ) -> HealthAssistantResponse:
        safety_check = self.safety_service.check_input_safety(request.messages)
        if safety_check:
            return safety_check

        profile_context = request.profile_context
        needs_health_query = self._needs_health_record_query_tool(request)
        if needs_health_query and (
            profile_context is None
            or profile_context.profile_id is None
            or account is None
            or self.health_record_service is None
        ):
            return self._profile_required_response()
        loc = await self._resolve_request_location(request)
        outdoor_conditions = await self._load_outdoor_conditions(request, loc)
        system_instruction = build_system_instruction(
            profile_context,
            user_location=loc,
            outdoor_conditions_context=self._format_outdoor_conditions_context(outdoor_conditions, loc is not None)
            if self._needs_outdoor_conditions(request)
            else None,
        )

        tools = self._tools_for_request(request)
        response: HealthAssistantResponse
        client_any = cast(Any, self.llm_client)

        async def tool_executor(name: str, args: dict[str, Any]) -> Any:
            return await self._execute_tool(
                name,
                args,
                account=account,
                profile_id=profile_context.profile_id if profile_context else None,
            )

        if tools and hasattr(client_any, "generate_structured_response_with_tools"):
            res_tuple = await client_any.generate_structured_response_with_tools(
                system_instruction=system_instruction,
                messages=request.messages,
                response_schema=HealthAssistantResponse,
                tools=tools,
                tool_executor=tool_executor,
            )
            response, tool_result = res_tuple
            if isinstance(tool_result, HealthRecordQueryResult):
                response.intent = "query_records"
                response.health_record_query_result = tool_result
                response.assistant_message = tool_result.message
            elif isinstance(tool_result, FacilitySearchResult) and not response.facility_search_draft:
                response.facility_search_draft = tool_result
                if tool_result.message:
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

    async def stream(  # noqa: C901 - 안전·도구·SSE 종료 경로를 한 상태기계에서 다룬다.
        self,
        request: HealthAssistantChatRequest,
        account: ServiceAccount | None = None,
    ) -> AsyncIterator[tuple[str, Any]]:
        safety_check = self.safety_service.check_input_safety(request.messages)
        if safety_check:
            yield "delta", {"text": safety_check.assistant_message}
            yield "result", safety_check.model_dump(mode="json")
            return

        profile_context = request.profile_context
        needs_health_query = self._needs_health_record_query_tool(request)
        if needs_health_query and (
            profile_context is None
            or profile_context.profile_id is None
            or account is None
            or self.health_record_service is None
        ):
            response = self._profile_required_response()
            yield "delta", {"text": response.assistant_message}
            yield "result", response.model_dump(mode="json")
            return
        loc = await self._resolve_request_location(request)
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

        tools = self._tools_for_request(request)
        client_any = cast(Any, self.llm_client)

        async def tool_executor(name: str, args: dict[str, Any]) -> Any:
            return await self._execute_tool(
                name,
                args,
                account=account,
                profile_id=profile_context.profile_id if profile_context else None,
            )

        if tools and hasattr(client_any, "stream_structured_response_with_tools"):
            stream_gen, tool_result = await client_any.stream_structured_response_with_tools(
                system_instruction=system_instruction,
                messages=request.messages,
                response_schema=HealthAssistantResponse,
                tools=tools,
                tool_executor=tool_executor,
            )
        else:
            stream_gen = self.llm_client.stream_structured_response(
                system_instruction=system_instruction,
                messages=request.messages,
                response_schema=HealthAssistantResponse,
            )

        if isinstance(tool_result, HealthRecordQueryResult):
            yield "delta", {"text": tool_result.message}
            res_obj = HealthAssistantResponse(
                intent="query_records",
                assistant_message=tool_result.message,
                health_record_query_result=tool_result,
                outdoor_conditions=outdoor_conditions,
            )
            yield "result", self.safety_service.validate_response(res_obj).model_dump(mode="json")
            return

        if isinstance(tool_result, FacilitySearchResult):
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
            if isinstance(tool_result, FacilitySearchResult) and not parsed.facility_search_draft:
                parsed.facility_search_draft = tool_result
            if outdoor_conditions and not parsed.outdoor_conditions:
                parsed.outdoor_conditions = outdoor_conditions
        except Exception as ex:
            raise LlmProviderFailedError(f"응답 구조화 실패: {type(ex).__name__}") from ex

        yield "result", self.safety_service.validate_response(parsed).model_dump(mode="json")
