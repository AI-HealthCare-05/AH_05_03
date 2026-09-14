
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


def _format_gemini_error(prefix: str, ex: Exception) -> str:
    code = getattr(ex, "code", None)
    msg = getattr(ex, "message", None) or str(ex)
    if code == 429 or "RESOURCE_EXHAUSTED" in msg or "quota" in msg.lower():
        return f"{prefix}: Gemini 무료 호출 한도(분당 15회)를 초과했습니다. 약 30~50초 후 다시 시도해 주세요."
    if code == 400:
        clean_msg = msg.strip().split("\n")[0]
        return f"{prefix} (인자 오류): {clean_msg}"
    clean_msg = msg.strip().split("\n")[0] if msg else type(ex).__name__
    return f"{prefix}: {clean_msg}"


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
            raise LlmUnavailableError("Gemini API 키가 설정되지 않았습니다.")
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
                raise LlmProviderFailedError(_format_gemini_error("Gemini 스트리밍 실패", ex)) from ex

        return _stream()

    async def _prepare_tool_contents(
        self,
        system_instruction: str,
        messages: list[ChatMessage],
        tools: list[Any],
        tool_executor: Callable[[str, dict[str, Any]], Awaitable[Any]],
    ) -> tuple[list[Any] | None, list[Any] | None]:
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
            raise LlmProviderFailedError(_format_gemini_error("Gemini 도구 판별 호출 실패", ex)) from ex

        function_calls = getattr(first_turn, "function_calls", None)
        if not function_calls:
            return None, None

        # 다중 도구 병렬 실행
        async def execute_and_format(fc):
            fc_name = fc.name or ""
            fc_args = fc.args or {}
            tool_res = await tool_executor(fc_name, fc_args)
            result_payload = tool_res.model_dump(mode="json") if hasattr(tool_res, "model_dump") else tool_res
            part = types.Part.from_function_response(
                name=fc_name,
                response={"result": result_payload},
            )
            return tool_res, part

        execution_results = await asyncio.gather(*(execute_and_format(fc) for fc in function_calls))
        tool_results = [res[0] for res in execution_results]
        tool_parts = [res[1] for res in execution_results]

        candidates = first_turn.candidates or []
        model_turn = (
            candidates[0].content if candidates and candidates[0].content else types.Content(role="model", parts=[])
        )
        tool_turn = types.Content(role="user", parts=tool_parts)

        final_contents: list[Any] = [*gemini_contents, model_turn, tool_turn]
        return final_contents, tool_results

    async def generate_structured_response_with_tools(
        self,
        system_instruction: str,
        messages: list[ChatMessage],
        response_schema: type[T],
        tools: list[Any] | None = None,
        tool_executor: Callable[[str, dict[str, Any]], Awaitable[Any]] | None = None,
    ) -> tuple[T, list[Any] | None]:
        if not tools or not tool_executor:
            res = await self.generate_structured_response(
                system_instruction=system_instruction,
                messages=messages,
                response_schema=response_schema,
            )
            return res, None

        final_contents, tool_results = await self._prepare_tool_contents(
            system_instruction, messages, tools, tool_executor
        )

        if not final_contents:
            res = await self.generate_structured_response(
                system_instruction=system_instruction,
                messages=messages,
                response_schema=response_schema,
            )
            return res, None

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
            return response_schema.model_validate_json(second_turn.text), tool_results
        except asyncio.TimeoutError as ex:
            raise LlmTimeoutError() from ex
        except Exception as ex:
            raise LlmProviderFailedError(_format_gemini_error("Gemini 도구 실행 후 응답 생성 실패", ex)) from ex

    async def stream_structured_response_with_tools(
        self,
        system_instruction: str,
        messages: list[ChatMessage],
        response_schema: type[T],
        tools: list[Any] | None = None,
        tool_executor: Callable[[str, dict[str, Any]], Awaitable[Any]] | None = None,
    ) -> tuple[AsyncIterator[str], list[Any] | None]:
        if not tools or not tool_executor:
            return self.stream_structured_response(system_instruction, messages, response_schema), None

        final_contents, tool_results = await self._prepare_tool_contents(
            system_instruction, messages, tools, tool_executor
        )

        if not final_contents:
            return self.stream_structured_response(system_instruction, messages, response_schema), None

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

            return (chunk.text async for chunk in stream if chunk.text), tool_results
        except Exception as ex:
            raise LlmProviderFailedError(_format_gemini_error("Gemini 도구 스트림 생성 실패", ex)) from ex
