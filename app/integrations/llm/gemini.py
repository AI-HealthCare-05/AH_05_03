"""Gemini 구조화 응답 클라이언트. **대화 경로의 유일한 Gemini 진입점이다.**

원 PR(#27)은 `health_assistant` · `pain_chat` · `dev_ocr` 세 곳이 각자 클라이언트를
만들고 모델명·타임아웃·예외 처리를 따로 적었다. 그중 `dev_ocr` 은 이 저장소에 이미
더 완성된 구현(`services/ocr_providers`)이 있어 받지 않았고, 나머지 둘을 여기로 모았다.

**모델명을 코드에 두지 않는다.** 테스트가 클라이언트를 목킹하므로 CI 는 모델
문자열의 유효성을 증명하지 못한다. 설정으로 빼야 틀렸을 때 재배포 없이 고칠 수 있다.
"""

import asyncio
from typing import TypeVar

from google import genai
from google.genai import types
from pydantic import BaseModel

from app.core import config
from app.dtos.health_assistant import ChatMessage
from app.exceptions import LlmProviderFailedError, LlmTimeoutError, LlmUnavailableError
from app.integrations.llm.protocol import LLMClientProtocol

T = TypeVar("T", bound=BaseModel)


class GeminiLLMClient(LLMClientProtocol):
    def __init__(
        self,
        api_key: str | None,
        model_name: str | None = None,
        temperature: float = 0.0,
        timeout: float | None = None,
    ):
        if not api_key:
            raise LlmUnavailableError("Gemini API 키가 설정되지 않았습니다.")
        self.client = genai.Client(api_key=api_key)
        self.model_name = model_name or config.GEMINI_CHAT_MODEL
        self.temperature = temperature
        self.timeout = timeout if timeout is not None else config.LLM_CHAT_TIMEOUT_SECONDS

    async def generate_structured_response(
        self,
        system_instruction: str,
        messages: list[ChatMessage],
        response_schema: type[T],
    ) -> T:
        # `list[Content]` 그대로 넘기면 mypy 가 막는다. SDK 가 받는 타입이
        # `list[Content | str | Part | ...]` 인데 리스트는 불변(invariant)이라
        # `list[Content]` 가 그 하위 타입이 아니다 — 런타임에는 문제가 없고
        # 타입 검사에서만 걸린다. 원소 타입을 넓혀 선언해 푼다.
        gemini_contents: list[types.ContentUnion] = [
            types.Content(
                role="user" if m.role == "user" else "model",
                parts=[types.Part.from_text(text=m.content)],
            )
            for m in messages
        ]

        try:
            response = await asyncio.wait_for(
                self.client.aio.models.generate_content(
                    model=self.model_name,
                    contents=gemini_contents,
                    config=types.GenerateContentConfig(
                        system_instruction=system_instruction,
                        response_mime_type="application/json",
                        response_schema=response_schema,
                        temperature=self.temperature,
                    ),
                ),
                timeout=self.timeout,
            )
        except asyncio.TimeoutError as ex:
            raise LlmTimeoutError() from ex
        except Exception as ex:
            # 모델명 오류·인증 실패·레이트리밋이 여기 모인다. 전부 업스트림 사정이라
            # 502 다 — 우리 쪽이 죽은 것처럼 503 으로 덮으면 원인을 못 찾는다.
            raise LlmProviderFailedError(f"Gemini 호출 실패: {type(ex).__name__}") from ex

        if not response or not response.text:
            raise LlmProviderFailedError("Gemini 가 빈 응답을 돌려줬습니다.")

        try:
            return response_schema.model_validate_json(response.text)
        except Exception as ex:
            raise LlmProviderFailedError(f"응답 구조화 실패: {type(ex).__name__}") from ex
