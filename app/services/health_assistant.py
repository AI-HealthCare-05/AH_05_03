from collections.abc import AsyncIterator
from typing import Any

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
from app.services.ocr_partial import PartialJsonTextReader
from app.services.outdoor_conditions_client import OutdoorConditionsClient
from app.services.outdoor_conditions_tools import execute_outdoor_conditions_tool

_OUTDOOR_ENVIRONMENT_KEYWORDS = ("날씨", "미세먼지", "초미세먼지", "대기질")
_OUTDOOR_ACTIVITY_KEYWORDS = (
    "산책",
    "조깅",
    "러닝",
    "유산소",
    "운동추천",
    "운동할",
    "야외",
    "밖에서",
    "외출",
)


class HealthAssistantService:
    """통합 건강 어시스턴트 (봄이) 서비스.

    자연어 입력을 분석하여 건강기록(운동, 혈압, 혈당, 복약, 통증 등) 추출,
    기록 조회 의도 분류, 안전 가이드라인 기반 상담 응답을 생성합니다.
    """

    def __init__(
        self,
        llm_client: LLMClientProtocol | None = None,
        safety_service: HealthAssistantSafetyService | None = None,
        record_repo: HealthRecordRepository | None = None,
        outdoor_conditions_client: OutdoorConditionsClient | None = None,
    ):
        self._llm_client = llm_client
        self.safety_service = safety_service or HealthAssistantSafetyService()
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
        if any(keyword in message for keyword in ("했어", "완료", "기록해", "기록할", "기록하기")):
            return False
        return any(keyword in message for keyword in _OUTDOOR_ACTIVITY_KEYWORDS)

    async def _load_outdoor_conditions(self, request: HealthAssistantChatRequest):
        if not self._needs_outdoor_conditions(request) or request.current_location is None:
            return None
        return await execute_outdoor_conditions_tool(
            "get_outdoor_health_conditions",
            {
                "latitude": request.current_location.latitude,
                "longitude": request.current_location.longitude,
            },
            self.outdoor_conditions_client,
        )

    @staticmethod
    def _format_outdoor_conditions_context(result: Any | None, location_available: bool) -> str | None:
        if result is None:
            return "현재 위치가 제공되지 않아 실시간 날씨·대기질을 조회하지 못했습니다." if not location_available else None

        lines: list[str] = []
        if result.weather:
            weather = result.weather
            lines.append(
                "날씨: "
                f"기온 {weather.temperature_c if weather.temperature_c is not None else '확인 불가'}℃, "
                f"습도 {weather.humidity_percent if weather.humidity_percent is not None else '확인 불가'}%, "
                f"강수 {weather.precipitation_type}, "
                f"풍속 {weather.wind_speed_mps if weather.wind_speed_mps is not None else '확인 불가'}m/s"
            )
        if result.air_quality:
            air = result.air_quality
            lines.append(
                "대기질: "
                f"{air.region_name} {air.station_name or '측정소'}, "
                f"PM10 {air.pm10 if air.pm10 is not None else '확인 불가'}㎍/㎥({air.pm10_grade or '등급 확인 불가'}), "
                f"PM2.5 {air.pm25 if air.pm25 is not None else '확인 불가'}㎍/㎥({air.pm25_grade or '등급 확인 불가'})"
            )
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
        # 키가 없으면 생성자에서 터진다. 의존성 주입 단계가 아니라 요청 처리 중에
        # 503 이 나야 오류 봉투가 정상적으로 실린다. `PainChatService` 와 같은 모양.
        # 하나가 아니라 **순서 목록**을 쓴다. Gemini 무료 등급은 할당량을 모델마다
        # 하루로 따로 세서, 하나만 걸어 두면 소진되는 날 대화가 통째로 멈춘다.
        if self._llm_client is None:
            self._llm_client = shared_chat_client()
        return self._llm_client

    async def respond(self, request: HealthAssistantChatRequest) -> HealthAssistantResponse:
        # 1. 입력 메시지 사전 안전 검사 (응급 키워드 감지)
        safety_check = self.safety_service.check_input_safety(request.messages)
        if safety_check:
            return safety_check

        profile_context = await self._enrich_context(request.profile_context)
        outdoor_conditions = await self._load_outdoor_conditions(request)
        system_instruction = build_system_instruction(
            profile_context,
            self._format_outdoor_conditions_context(outdoor_conditions, request.current_location is not None)
            if self._needs_outdoor_conditions(request)
            else None,
        )

        response = await self.llm_client.generate_structured_response(
            system_instruction=system_instruction,
            messages=request.messages,
            response_schema=HealthAssistantResponse,
        )

        # 안전 검증 및 후처리
        response.outdoor_conditions = outdoor_conditions
        validated_response = self.safety_service.validate_response(response)

        return validated_response

    async def stream(self, request: HealthAssistantChatRequest) -> AsyncIterator[tuple[str, Any]]:
        """대화를 조각으로 흘린다. `(이벤트 이름, payload)`.

        `delta` 로 `assistant_message` 의 새로 온 부분만 보내고, 끝나면 `result` 로
        **완성된 구조화 응답**을 한 번 보낸다. 화면은 글자가 흐르는 동안 읽고,
        기록 초안·빠른답장·응급 안내는 마지막 한 번에서 받는다.

        왜 두 벌인가. 초안은 JSON 이 끝나야 유효해지고, 안전 검증
        (`validate_response`)도 완성본에만 걸 수 있다 — 덜 온 문장으로 응급 판정을
        하면 "가슴이 아" 에서 119 를 띄우거나 반대로 놓친다.

        **응급 사전 검사는 스트리밍 전에 한다.** 그때는 모델을 부르지도 않는다.
        """
        safety_check = self.safety_service.check_input_safety(request.messages)
        if safety_check:
            yield "delta", {"text": safety_check.assistant_message}
            yield "result", safety_check.model_dump(mode="json")
            return

        profile_context = await self._enrich_context(request.profile_context)
        outdoor_conditions = await self._load_outdoor_conditions(request)
        system_instruction = build_system_instruction(
            profile_context,
            self._format_outdoor_conditions_context(outdoor_conditions, request.current_location is not None)
            if self._needs_outdoor_conditions(request)
            else None,
        )
        reader = PartialJsonTextReader("assistant_message")
        raw = ""
        async for piece in self.llm_client.stream_structured_response(
            system_instruction=system_instruction,
            messages=request.messages,
            response_schema=HealthAssistantResponse,
        ):
            raw += piece
            fresh = reader.push(piece)
            if fresh:
                yield "delta", {"text": fresh}

        try:
            parsed = HealthAssistantResponse.model_validate_json(raw)
        except Exception as ex:
            raise LlmProviderFailedError(f"응답 구조화 실패: {type(ex).__name__}") from ex
        parsed.outdoor_conditions = outdoor_conditions
        yield "result", self.safety_service.validate_response(parsed).model_dump(mode="json")
