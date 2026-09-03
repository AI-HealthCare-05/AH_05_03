from collections.abc import AsyncIterator
from typing import Any

from app.dtos.health_assistant import (
    HealthAssistantChatRequest,
    HealthAssistantResponse,
)
from app.exceptions import LlmProviderFailedError
from app.integrations.llm.chain import FallbackChatClient
from app.integrations.llm.protocol import LLMClientProtocol
from app.prompts.health_assistant import build_system_instruction
from app.services.health_assistant_safety import HealthAssistantSafetyService
from app.services.ocr_partial import PartialJsonTextReader


class HealthAssistantService:
    """통합 건강 어시스턴트 (봄이) 서비스.

    자연어 입력을 분석하여 건강기록(운동, 혈압, 혈당, 복약, 통증 등) 추출,
    기록 조회 의도 분류, 안전 가이드라인 기반 상담 응답을 생성합니다.
    """

    def __init__(
        self, llm_client: LLMClientProtocol | None = None, safety_service: HealthAssistantSafetyService | None = None
    ):
        self._llm_client = llm_client
        self.safety_service = safety_service or HealthAssistantSafetyService()

    @property
    def llm_client(self) -> LLMClientProtocol:
        # 키가 없으면 생성자에서 터진다. 의존성 주입 단계가 아니라 요청 처리 중에
        # 503 이 나야 오류 봉투가 정상적으로 실린다. `PainChatService` 와 같은 모양.
        # 하나가 아니라 **순서 목록**을 쓴다. Gemini 무료 등급은 할당량을 모델마다
        # 하루로 따로 세서, 하나만 걸어 두면 소진되는 날 대화가 통째로 멈춘다.
        if self._llm_client is None:
            self._llm_client = FallbackChatClient()
        return self._llm_client

    async def respond(self, request: HealthAssistantChatRequest) -> HealthAssistantResponse:
        # 1. 입력 메시지 사전 안전 검사 (응급 키워드 감지)
        safety_check = self.safety_service.check_input_safety(request.messages)
        if safety_check:
            return safety_check

        system_instruction = build_system_instruction(request.profile_context)

        response = await self.llm_client.generate_structured_response(
            system_instruction=system_instruction,
            messages=request.messages,
            response_schema=HealthAssistantResponse,
        )

        # 안전 검증 및 후처리
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

        system_instruction = build_system_instruction(request.profile_context)
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
        yield "result", self.safety_service.validate_response(parsed).model_dump(mode="json")
