"""대화형 통증 기록.

**Gemini 호출을 직접 하지 않는다.** 원 PR(#27)은 여기에 클라이언트 생성·타임아웃·
예외 처리를 `integrations/llm/gemini.py` 와 거의 같은 모양으로 한 벌 더 적어 뒀다.
두 벌이면 모델명이나 오류 분류를 한쪽만 고치는 순간 두 경로의 동작이 갈린다.
그래서 클라이언트는 하나만 두고 여기서는 지시문과 스키마만 정한다.
"""

from app.dtos.health_assistant import ChatMessage
from app.dtos.pain_chat import PainChatData, PainChatMessage
from app.integrations.llm.chain import shared_chat_client
from app.integrations.llm.protocol import LLMClientProtocol
from app.prompts.pain_chat import PAIN_CHAT_INSTRUCTION


class PainChatService:
    def __init__(self, llm_client: LLMClientProtocol | None = None):
        self._llm_client = llm_client

    @property
    def llm_client(self) -> LLMClientProtocol:
        # 키가 없으면 생성자에서 바로 터지므로, 실제로 부를 때 만든다. 그래야
        # 라우터 의존성 주입 단계가 아니라 요청 처리 중에 503 이 난다.
        if self._llm_client is None:
            self._llm_client = shared_chat_client()
        return self._llm_client

    async def respond(self, messages: list[PainChatMessage]) -> PainChatData:
        return await self.llm_client.generate_structured_response(
            system_instruction=PAIN_CHAT_INSTRUCTION,
            messages=[ChatMessage(role=m.role, content=m.content) for m in messages],
            response_schema=PainChatData,
        )
