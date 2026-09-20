import pytest

from app.core import config
from app.dtos.health_assistant import HealthAssistantResponse
from app.exceptions import AppError
from app.integrations.llm.gemini import GeminiLLMClient


@pytest.mark.asyncio
async def test_gemini_client_raises_when_no_api_key(monkeypatch) -> None:
    monkeypatch.setattr(config, "GEMINI_API_KEY", None)
    with pytest.raises(AppError, match="Gemini API 키가 설정되지 않았습니다"):
        GeminiLLMClient(api_key=None)


@pytest.mark.asyncio
async def test_gemini_client_generates_response(monkeypatch) -> None:
    fake_json = """{
        "intent": "general_chat",
        "assistant_message": "안녕하세요!",
        "exercise_draft": null,
        "blood_pressure_draft": null,
        "blood_glucose_draft": null,
        "medication_draft": null,
        "pain_draft": null,
        "lab_result_draft": null,
        "query_draft": null,
        "missing_fields": [],
        "needs_confirmation": false,
        "suggested_quick_replies": [],
        "emergency_notice": null,
        "safety_disclaimer": null
    }"""

    class FakeResponse:
        text = fake_json

    class FakeModels:
        async def generate_content(self, *args, **kwargs):
            return FakeResponse()

    class FakeAio:
        def __init__(self):
            self.models = FakeModels()

    class FakeClient:
        def __init__(self, *args, **kwargs):
            self.aio = FakeAio()

    import google.genai as genai

    monkeypatch.setattr(genai, "Client", FakeClient)

    from app.dtos.health_assistant import ChatMessage

    client = GeminiLLMClient(api_key="fake_key")
    response = await client.generate_structured_response(
        system_instruction="안녕",
        messages=[ChatMessage(role="user", content="안녕")],
        response_schema=HealthAssistantResponse,
    )

    assert response.intent == "general_chat"
    assert response.assistant_message == "안녕하세요!"


async def test_gemini_client_tools_execute_exactly_once_and_handle_errors(monkeypatch) -> None:

    from pydantic import BaseModel

    from app.integrations.llm.gemini import GeminiLLMClient

    monkeypatch.setenv("GOOGLE_API_KEY", "dummy")
    client = GeminiLLMClient("gemini-2.5-flash")

    class DummySchema(BaseModel):
        msg: str

    from unittest.mock import AsyncMock, MagicMock

    class MockContent:
        text = '{"msg": "done"}'

    class MockFC:
        def __init__(self, n):
            self.name, self.args = n, {}

    class MockFirstTurn:
        function_calls = [MockFC("tool_1"), MockFC("tool_error")]
        candidates: list = []
        text = ""

    client.client = MagicMock()
    client.client.aio.models.generate_content = AsyncMock(side_effect=[MockFirstTurn(), MockContent()])

    execution_counts = {"tool_1": 0, "tool_error": 0}

    async def mock_tool_executor(name, args):
        execution_counts[name] += 1
        if name == "tool_error":
            raise ValueError("Test error")
        return {"ok": True}

    res, tool_results = await client.generate_structured_response_with_tools(
        system_instruction="sys",
        messages=[],
        response_schema=DummySchema,
        tools=["dummy_tool"],
        tool_executor=mock_tool_executor,
    )

    assert execution_counts["tool_1"] == 1
    assert execution_counts["tool_error"] == 1
    assert tool_results == [{"ok": True}, {"error": "TOOL_EXECUTION_FAILED"}]
