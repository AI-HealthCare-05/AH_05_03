"""Gemini 구조화 응답 클라이언트. **대화 경로의 유일한 Gemini 진입점이다.**

원 PR(#27)은 `health_assistant` · `pain_chat` · `dev_ocr` 세 곳이 각자 클라이언트를
만들고 모델명·타임아웃·예외 처리를 따로 적었다. 그중 `dev_ocr` 은 이 저장소에 이미
더 완성된 구현(`services/ocr_providers`)이 있어 받지 않았고, 나머지 둘을 여기로 모았다.

**모델명을 코드에 두지 않는다.** 테스트가 클라이언트를 목킹하므로 CI 는 모델
문자열의 유효성을 증명하지 못한다. 설정으로 빼야 틀렸을 때 재배포 없이 고칠 수 있다.
"""

import asyncio
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Any, TypeVar, cast

from google import genai
from google.genai import types
from pydantic import BaseModel

from app.core import config
from app.dtos.health_assistant import ChatMessage
from app.exceptions import LlmProviderFailedError, LlmTimeoutError, LlmUnavailableError
from app.integrations.llm.protocol import LLMClientProtocol

T = TypeVar("T", bound=BaseModel)


class GeminiLLMClient(LLMClientProtocol):
    """구조화 JSON 출력을 강제하는 Gemini 클라이언트."""

    def __init__(
        self,
        api_key: str | None = None,
        model_name: str | None = None,
        timeout: float = 30.0,
        temperature: float = 0.2,
    ) -> None:
        self.api_key = api_key or config.GEMINI_API_KEY
        if not self.api_key:
            raise LlmUnavailableError("GEMINI_API_KEY 가 설정되지 않았습니다.")
        self.model_name = model_name or config.GEMINI_CHAT_MODEL
        self.timeout = timeout
        self.temperature = temperature
        self.client = genai.Client(api_key=self.api_key)

    async def generate_structured_response(
        self,
        system_instruction: str,
        messages: list[ChatMessage],
        response_schema: type[T],
    ) -> T:
        gemini_contents = [
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
                    contents=cast(Any, gemini_contents),
                    config=types.GenerateContentConfig(
                        system_instruction=system_instruction,
                        response_mime_type="application/json",
                        response_schema=response_schema,
                        temperature=self.temperature,
                    ),
                ),
                timeout=self.timeout,
            )
            if not response.text:
                raise LlmProviderFailedError("Gemini 응답 본문이 비어 있습니다.")
            return response_schema.model_validate_json(response.text)
        except asyncio.TimeoutError as ex:
            raise LlmTimeoutError() from ex
        except Exception as ex:
            raise LlmProviderFailedError(f"Gemini 호출 실패: {type(ex).__name__}") from ex

    def stream_structured_response(
        self,
        system_instruction: str,
        messages: list[ChatMessage],
        response_schema: type[T],
    ) -> AsyncIterator[str]:
        gemini_contents = [
            types.Content(
                role="user" if m.role == "user" else "model",
                parts=[types.Part.from_text(text=m.content)],
            )
            for m in messages
        ]

        async def _stream() -> AsyncIterator[str]:
            try:
                stream = await self.client.aio.models.generate_content_stream(
                    model=self.model_name,
                    contents=cast(Any, gemini_contents),
                    config=types.GenerateContentConfig(
                        system_instruction=system_instruction,
                        response_mime_type="application/json",
                        response_schema=response_schema,
                        temperature=self.temperature,
                    ),
                )
                async for chunk in stream:
                    if chunk.text:
                        yield chunk.text
            except Exception as ex:
                raise LlmProviderFailedError(f"Gemini 스트리밍 실패: {type(ex).__name__}") from ex

        return _stream()

    async def generate_structured_response_with_tools(
        self,
        system_instruction: str,
        messages: list[ChatMessage],
        response_schema: type[T],
        tools: list[Any] | None = None,
        tool_executor: Callable[[str, dict[str, Any]], Awaitable[Any]] | None = None,
    ) -> tuple[T, Any | None]:
        if not tools or not tool_executor:
            res = await self.generate_structured_response(
                system_instruction=system_instruction,
                messages=messages,
                response_schema=response_schema,
            )
            return res, None

        gemini_contents = [
            types.Content(
                role="user" if m.role == "user" else "model",
                parts=[types.Part.from_text(text=m.content)],
            )
            for m in messages
        ]

        try:
            first_turn = await asyncio.wait_for(
                self.client.aio.models.generate_content(
                    model=self.model_name,
                    contents=cast(Any, gemini_contents),
                    config=types.GenerateContentConfig(
                        system_instruction=system_instruction,
                        tools=cast(Any, tools),
                        automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
                        temperature=0.0,
                    ),
                ),
                timeout=self.timeout,
            )
        except asyncio.TimeoutError as ex:
            raise LlmTimeoutError() from ex
        except Exception as ex:
            raise LlmProviderFailedError(f"Gemini 도구 판별 호출 실패: {type(ex).__name__}") from ex

        function_calls = getattr(first_turn, "function_calls", None)
        if function_calls:
            fc = function_calls[0]
            fc_name = fc.name or ""
            fc_args = fc.args or {}
            tool_result = await tool_executor(fc_name, fc_args)

            candidates = first_turn.candidates or []
            model_turn = (
                candidates[0].content if candidates and candidates[0].content else types.Content(role="model", parts=[])
            )
            result_payload = tool_result.model_dump(mode="json") if hasattr(tool_result, "model_dump") else tool_result
            tool_turn = types.Content(
                role="user",
                parts=[
                    types.Part.from_function_response(
                        name=fc_name,
                        response={"result": result_payload},
                    )
                ],
            )
            final_contents: list[Any] = [*gemini_contents, model_turn, tool_turn]

            try:
                second_turn = await asyncio.wait_for(
                    self.client.aio.models.generate_content(
                        model=self.model_name,
                        contents=cast(Any, final_contents),
                        config=types.GenerateContentConfig(
                            system_instruction=system_instruction,
                            response_mime_type="application/json",
                            response_schema=response_schema,
                            temperature=self.temperature,
                        ),
                    ),
                    timeout=self.timeout,
                )
                if not second_turn.text:
                    raise LlmProviderFailedError("Gemini 도구 실행 후 응답 본문이 비어 있습니다.")
                return response_schema.model_validate_json(second_turn.text), tool_result
            except asyncio.TimeoutError as ex:
                raise LlmTimeoutError() from ex
            except Exception as ex:
                raise LlmProviderFailedError(f"Gemini 도구 실행 후 응답 생성 실패: {type(ex).__name__}") from ex

        res = await self.generate_structured_response(
            system_instruction=system_instruction,
            messages=messages,
            response_schema=response_schema,
        )
        return res, None

    async def stream_structured_response_with_tools(
        self,
        system_instruction: str,
        messages: list[ChatMessage],
        response_schema: type[T],
        tools: list[Any] | None = None,
        tool_executor: Callable[[str, dict[str, Any]], Awaitable[Any]] | None = None,
    ) -> tuple[AsyncIterator[str], Any | None]:
        if not tools or not tool_executor:
            return self.stream_structured_response(system_instruction, messages, response_schema), None

        gemini_contents = [
            types.Content(
                role="user" if m.role == "user" else "model",
                parts=[types.Part.from_text(text=m.content)],
            )
            for m in messages
        ]

        try:
            first_turn = await asyncio.wait_for(
                self.client.aio.models.generate_content(
                    model=self.model_name,
                    contents=cast(Any, gemini_contents),
                    config=types.GenerateContentConfig(
                        system_instruction=system_instruction,
                        tools=cast(Any, tools),
                        automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
                        temperature=0.0,
                    ),
                ),
                timeout=self.timeout,
            )
        except asyncio.TimeoutError as ex:
            raise LlmTimeoutError() from ex
        except Exception as ex:
            raise LlmProviderFailedError(f"Gemini 도구 판별 스트림 실패: {type(ex).__name__}") from ex

        function_calls = getattr(first_turn, "function_calls", None)
        if function_calls:
            fc = function_calls[0]
            fc_name = fc.name or ""
            fc_args = fc.args or {}
            tool_result = await tool_executor(fc_name, fc_args)

            candidates = first_turn.candidates or []
            model_turn = (
                candidates[0].content if candidates and candidates[0].content else types.Content(role="model", parts=[])
            )
            result_payload = tool_result.model_dump(mode="json") if hasattr(tool_result, "model_dump") else tool_result
            tool_turn = types.Content(
                role="user",
                parts=[
                    types.Part.from_function_response(
                        name=fc_name,
                        response={"result": result_payload},
                    )
                ],
            )
            final_contents: list[Any] = [*gemini_contents, model_turn, tool_turn]

            try:
                stream = await self.client.aio.models.generate_content_stream(
                    model=self.model_name,
                    contents=cast(Any, final_contents),
                    config=types.GenerateContentConfig(
                        system_instruction=system_instruction,
                        response_mime_type="application/json",
                        response_schema=response_schema,
                        temperature=self.temperature,
                    ),
                )

                async def _stream_chunks() -> AsyncIterator[str]:
                    async for chunk in stream:
                        if chunk.text:
                            yield chunk.text

                return _stream_chunks(), tool_result
            except Exception as ex:
                raise LlmProviderFailedError(f"Gemini 도구 실행 후 스트리밍 실패: {type(ex).__name__}") from ex

        return self.stream_structured_response(system_instruction, messages, response_schema), None
