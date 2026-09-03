"""공급자 순서 목록 — 앞이 막히면 다음으로 넘어간다.

무엇을 푸는가
-------------
Gemini 무료 등급은 **모델마다 하루 할당량을 따로** 센다. 소진되면 그 모델은 그날
끝이고, 대화 화면이 통째로 멈춘다. 문서 인식은 이미 이 방식으로 넘어가고 있었는데
(`app/services/dev_ocr.py`) 대화만 한 공급자에 매여 있었다.

왜 "실패 종류를 가리지 않는가"
------------------------------
할당량 초과만 골라 넘기고 싶어지지만 그러면 안 된다. 공급자마다 소진을 알리는
방식이 다르고(429·403·`RESOURCE_EXHAUSTED`·본문에만 적힌 경우), SDK 가 그걸 다시
감싸면서 타입이 또 달라진다. **어떤 실패든 다음으로 넘긴다** — 목록의 마지막까지
실패했을 때만 사용자에게 오류가 간다. `dev_ocr` 이 같은 결론에 먼저 도달했다.

다만 두 가지는 넘기지 않는다.

- `LlmUnavailableError` — 그 공급자의 **키가 없다**. 시도할 것도 없으니 만들 때
  걸러내고 목록에서 뺀다. 요청마다 같은 예외를 다시 만들 이유가 없다.
- 마지막 항목의 실패 — 넘길 곳이 없다. 그대로 올린다.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from typing import TypeVar

from pydantic import BaseModel

from app.core import config
from app.dtos.health_assistant import ChatMessage
from app.exceptions import LlmProviderFailedError, LlmUnavailableError
from app.integrations.llm.gemini import GeminiLLMClient
from app.integrations.llm.openai_chat import OpenAIChatClient
from app.integrations.llm.protocol import LLMClientProtocol

T = TypeVar("T", bound=BaseModel)

logger = logging.getLogger(__name__)


def build_client(entry: str) -> LLMClientProtocol:
    """`"openai:gpt-4o-mini"` · `"gemini-3.1-flash-lite"` 한 항목을 클라이언트로.

    접두어가 없으면 Gemini 다 — 목록 대부분이 Gemini 라 그쪽을 기본으로 둔다.
    `DEV_OCR_MODELS` 와 **같은 표기**를 쓴다. 두 목록이 다른 문법을 쓰면 `.env` 를
    고치는 사람이 매번 어느 쪽인지 확인해야 한다.
    """
    provider, _, model = entry.partition(":")
    if not model:
        provider, model = "gemini", provider
    if provider == "openai":
        return OpenAIChatClient(api_key=config.OPENAI_API_KEY, model_name=model)
    if provider == "gemini":
        return GeminiLLMClient(api_key=config.GEMINI_API_KEY, model_name=model)
    raise LlmUnavailableError(f"모르는 대화 공급자입니다: {entry}")


class FallbackChatClient(LLMClientProtocol):
    """앞에서부터 하나씩 시도하고, 실패하면 다음으로 넘긴다."""

    def __init__(self, entries: list[str] | None = None) -> None:
        wanted = entries if entries is not None else list(config.HEALTH_ASSISTANT_MODELS)
        self.available: list[tuple[str, LLMClientProtocol]] = []
        for entry in wanted:
            try:
                self.available.append((entry, build_client(entry)))
            except LlmUnavailableError:
                # 키가 없는 공급자는 조용히 뺀다. 목록에 Gemini 와 OpenAI 를 같이
                # 적어 두고 키 하나만 넣은 상태가 실제로 흔하다.
                logger.info("대화 공급자 제외 — 키 없음: %s", entry)
        if not self.available:
            raise LlmUnavailableError("쓸 수 있는 대화 공급자가 없습니다. API 키를 확인해 주세요.")

    @property
    def primary(self) -> str:
        return self.available[0][0]

    async def generate_structured_response(
        self,
        system_instruction: str,
        messages: list[ChatMessage],
        response_schema: type[T],
    ) -> T:
        last: Exception | None = None
        for index, (entry, client) in enumerate(self.available):
            try:
                return await client.generate_structured_response(
                    system_instruction=system_instruction,
                    messages=messages,
                    response_schema=response_schema,
                )
            except Exception as error:  # noqa: BLE001 - 어떤 실패든 다음 공급자로 넘긴다
                last = error
                remaining = len(self.available) - index - 1
                if not remaining:
                    break
                # 할당량 소진은 하루 단위라 흔하다. 넘어간 사실은 남기되 시끄럽지 않게.
                logger.warning(
                    "대화 공급자 %s 실패(%s) — 다음으로 넘어간다(%d개 남음)",
                    entry,
                    type(error).__name__,
                    remaining,
                )
        assert last is not None
        raise LlmProviderFailedError(
            f"대화 공급자 {len(self.available)}개가 모두 실패했습니다: {type(last).__name__}"
        ) from last

    async def stream_structured_response(
        self,
        system_instruction: str,
        messages: list[ChatMessage],
        response_schema: type[T],
    ) -> AsyncIterator[str]:
        """스트리밍도 같은 순서로 넘긴다.

        **첫 조각을 받은 뒤에는 넘기지 않는다.** 화면에 이미 글자가 나가 있는데 다음
        공급자로 넘어가면 앞의 문장을 지우고 다시 쓰게 된다 — 사용자에게는 답이
        번복되는 것으로 보인다. 넘길지 말지를 첫 조각으로 가르는 이유다.
        """
        last: Exception | None = None
        for index, (entry, client) in enumerate(self.available):
            started = False
            try:
                async for piece in client.stream_structured_response(
                    system_instruction=system_instruction,
                    messages=messages,
                    response_schema=response_schema,
                ):
                    started = True
                    yield piece
                return
            except Exception as error:  # noqa: BLE001 - 첫 조각 전이면 다음 공급자로
                last = error
                if started or index == len(self.available) - 1:
                    raise
                logger.warning(
                    "대화 공급자 %s 스트리밍 실패(%s) — 다음으로 넘어간다",
                    entry,
                    type(error).__name__,
                )
        assert last is not None
        raise LlmProviderFailedError(
            f"대화 공급자 {len(self.available)}개가 모두 실패했습니다: {type(last).__name__}"
        ) from last
