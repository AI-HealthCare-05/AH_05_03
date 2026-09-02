from app.core import config
from app.dtos.health_assistant import (
    HealthAssistantChatRequest,
    HealthAssistantResponse,
)
from app.integrations.llm.gemini import GeminiLLMClient
from app.integrations.llm.protocol import LLMClientProtocol
from app.prompts.health_assistant import build_system_instruction
from app.services.health_assistant_safety import HealthAssistantSafetyService


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
        if self._llm_client is None:
            self._llm_client = GeminiLLMClient(api_key=config.GEMINI_API_KEY)
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
