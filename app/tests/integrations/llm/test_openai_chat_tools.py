"""GPT 폴백도 봄이의 서버 도구를 실제로 실행하는지 확인한다."""

from __future__ import annotations

import json
from types import SimpleNamespace
from typing import Any, cast
from unittest.mock import AsyncMock

import pytest
from google.genai import types
from pydantic import BaseModel

from app.dtos.health_assistant import ChatMessage
from app.integrations.llm.chain import FallbackChatClient
from app.integrations.llm.openai_chat import OpenAIChatClient


class Answer(BaseModel):
    text: str


TOOLS = [
    types.Tool(
        function_declarations=[
            types.FunctionDeclaration(
                name="query_health_records",
                description="인증된 프로필의 혈압 기록 조회",
                parameters_json_schema={
                    "type": "object",
                    "properties": {"period": {"type": "integer"}},
                    "required": ["period"],
                },
            )
        ]
    )
]
MESSAGES = [ChatMessage(role="user", content="내 혈압 기록 알려줘")]


def _completion(*, calls: list[Any] | None = None, content: str | None = None) -> Any:
    return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(tool_calls=calls, content=content))])


def _call(name: str = "query_health_records", arguments: str = '{"period": 3}') -> Any:
    return SimpleNamespace(id="call_1", type="function", function=SimpleNamespace(name=name, arguments=arguments))


def _client(*responses: Any) -> tuple[OpenAIChatClient, AsyncMock]:
    create = AsyncMock(side_effect=responses)
    client = OpenAIChatClient.__new__(OpenAIChatClient)
    client.client = cast(Any, SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create))))
    client.model_name = "gpt-4o"
    client.temperature = 0.0
    client.timeout = 12.0
    return client, create


@pytest.mark.asyncio
async def test_gpt_executes_same_server_tool_and_uses_result() -> None:
    client, create = _client(
        _completion(calls=[_call()]),
        _completion(content='{"text":"혈압 기록을 확인했어요"}'),
    )
    executor = AsyncMock(return_value={"matched_days": 2})

    answer, results = await client.generate_structured_response_with_tools("시스템", MESSAGES, Answer, TOOLS, executor)

    assert answer.text == "혈압 기록을 확인했어요"
    assert results == [{"matched_days": 2}]
    executor.assert_awaited_once_with("query_health_records", {"period": 3})
    sent_tools = create.await_args_list[0].kwargs["tools"]
    assert sent_tools[0]["function"]["name"] == "query_health_records"
    second_messages = create.await_args_list[1].kwargs["messages"]
    assert second_messages[-2]["tool_calls"][0]["id"] == "call_1"
    assert json.loads(second_messages[-1]["content"]) == {"matched_days": 2}


@pytest.mark.asyncio
async def test_gpt_can_answer_without_requesting_a_tool() -> None:
    client, create = _client(_completion(content="도구 필요 없음"), _completion(content='{"text":"안녕하세요"}'))
    executor = AsyncMock()

    answer, results = await client.generate_structured_response_with_tools("시스템", MESSAGES, Answer, TOOLS, executor)

    assert answer.text == "안녕하세요"
    assert results is None
    executor.assert_not_awaited()
    assert "tools" not in create.await_args_list[1].kwargs


@pytest.mark.asyncio
async def test_gpt_does_not_execute_unoffered_tool() -> None:
    client, _ = _client(_completion(calls=[_call(name="unknown")]), _completion(content='{"text":"확인 불가"}'))
    executor = AsyncMock()

    _, results = await client.generate_structured_response_with_tools("시스템", MESSAGES, Answer, TOOLS, executor)

    executor.assert_not_awaited()
    assert results == [{"error": "TOOL_NOT_REGISTERED", "message": "요청한 기능을 지금은 사용할 수 없습니다."}]


@pytest.mark.asyncio
async def test_gpt_handles_multiple_tool_calls_and_invalid_arguments() -> None:
    first = _call()
    second = _call(arguments="not json")
    second.id = "call_2"
    client, create = _client(
        _completion(calls=[first, second]),
        _completion(content='{"text":"첫 기록만 확인"}'),
    )
    executor = AsyncMock(return_value={"matched_days": 2})

    _, results = await client.generate_structured_response_with_tools("시스템", MESSAGES, Answer, TOOLS, executor)

    assert results is not None
    assert results[0] == {"matched_days": 2}
    assert "error" in results[1]
    executor.assert_awaited_once_with("query_health_records", {"period": 3})
    messages = create.await_args_list[1].kwargs["messages"]
    assert [message["tool_call_id"] for message in messages[-2:]] == ["call_1", "call_2"]


@pytest.mark.asyncio
async def test_gpt_stream_uses_tool_result_before_streaming() -> None:
    async def chunks():
        yield SimpleNamespace(choices=[SimpleNamespace(delta=SimpleNamespace(content='{"text":"확인'))])
        yield SimpleNamespace(choices=[SimpleNamespace(delta=SimpleNamespace(content='했어요"}'))])

    client, create = _client(_completion(calls=[_call()]), chunks())
    executor = AsyncMock(return_value={"matched_days": 2})

    stream, results = await client.stream_structured_response_with_tools("시스템", MESSAGES, Answer, TOOLS, executor)

    assert results == [{"matched_days": 2}]
    assert "".join([piece async for piece in stream]) == '{"text":"확인했어요"}'
    executor.assert_awaited_once()
    assert json.loads(create.await_args_list[1].kwargs["messages"][-1]["content"]) == {"matched_days": 2}


@pytest.mark.asyncio
async def test_gemini_failure_falls_back_to_gpt_with_tools() -> None:
    class FailedGemini:
        async def generate_structured_response_with_tools(self, **_kwargs: Any) -> Any:
            raise RuntimeError("Gemini quota")

    gpt, _ = _client(_completion(calls=[_call()]), _completion(content='{"text":"기록 확인"}'))
    chain = FallbackChatClient.__new__(FallbackChatClient)
    chain.available = [("gemini", FailedGemini()), ("openai:gpt-4o", gpt)]  # type: ignore[list-item]
    executor = AsyncMock(return_value={"matched_days": 2})

    answer, results = await chain.generate_structured_response_with_tools("시스템", MESSAGES, Answer, TOOLS, executor)

    assert answer.text == "기록 확인"
    assert results == [{"matched_days": 2}]
    executor.assert_awaited_once_with("query_health_records", {"period": 3})


@pytest.mark.asyncio
async def test_gemini_stream_failure_falls_back_to_gpt_with_tools() -> None:
    class FailedGemini:
        async def stream_structured_response_with_tools(self, **_kwargs: Any) -> Any:
            raise RuntimeError("Gemini quota")

    async def chunks():
        yield SimpleNamespace(choices=[SimpleNamespace(delta=SimpleNamespace(content='{"text":"기록 확인"}'))])

    gpt, _ = _client(_completion(calls=[_call()]), chunks())
    chain = FallbackChatClient.__new__(FallbackChatClient)
    chain.available = [("gemini", FailedGemini()), ("openai:gpt-4o", gpt)]  # type: ignore[list-item]
    executor = AsyncMock(return_value={"matched_days": 2})

    stream, results = await chain.stream_structured_response_with_tools("시스템", MESSAGES, Answer, TOOLS, executor)

    assert "".join([piece async for piece in stream]) == '{"text":"기록 확인"}'
    assert results == [{"matched_days": 2}]
    executor.assert_awaited_once_with("query_health_records", {"period": 3})
