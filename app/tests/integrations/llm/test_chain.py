"""공급자 폴백 계약 — 앞이 막히면 다음이 답한다.

무엇을 고정하려는가
------------------
1. **실패 종류를 가리지 않는다.** 할당량 소진을 알리는 방식이 공급자마다 다르고
   SDK 가 다시 감싸면서 타입이 또 달라진다. 429 만 골라 넘기면 그날 실제로 막히는
   방식이 그 목록에 없을 때 조용히 안 넘어간다.
2. **키가 없는 공급자는 목록에서 빠진다.** 둘을 적어 두고 키 하나만 넣는 상태가 흔하다.
3. **끝까지 실패하면 그때만 사용자에게 간다.**
4. 순서를 지킨다 — 첫 항목이 성공하면 뒤는 부르지 않는다.

네트워크를 타지 않는다.
"""

from __future__ import annotations

import pytest
from pydantic import BaseModel

from app.dtos.health_assistant import ChatMessage
from app.exceptions import LlmProviderFailedError, LlmUnavailableError
from app.integrations.llm.chain import FallbackChatClient


class Answer(BaseModel):
    text: str


class FakeClient:
    """부르면 정해진 대로 답하거나 터진다. 몇 번 불렸는지 센다."""

    def __init__(self, *, fails: Exception | None = None, text: str = "ok") -> None:
        self.fails = fails
        self.text = text
        self.calls = 0

    async def generate_structured_response(self, system_instruction, messages, response_schema):  # type: ignore[no-untyped-def]
        self.calls += 1
        if self.fails:
            raise self.fails
        return response_schema(text=self.text)

    async def stream_structured_response(self, system_instruction, messages, response_schema):  # type: ignore[no-untyped-def]
        self.calls += 1
        if self.fails:
            raise self.fails
        yield f'{{"text": "{self.text}"}}'


def chain(*clients: FakeClient) -> FallbackChatClient:
    """생성자를 우회해 가짜 목록을 심는다 — 키가 없어도 돌아야 한다."""
    built = FallbackChatClient.__new__(FallbackChatClient)
    built.available = [(f"fake-{i}", client) for i, client in enumerate(clients)]  # type: ignore[attr-defined, misc]
    return built


MESSAGES = [ChatMessage(role="user", content="안녕")]


async def ask(client: FallbackChatClient) -> Answer:
    return await client.generate_structured_response(
        system_instruction="시스템", messages=MESSAGES, response_schema=Answer
    )


@pytest.mark.asyncio
async def test_first_success_does_not_touch_the_rest() -> None:
    first, second = FakeClient(text="첫번째"), FakeClient(text="두번째")
    assert (await ask(chain(first, second))).text == "첫번째"
    assert (first.calls, second.calls) == (1, 0)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "failure",
    [
        RuntimeError("429 RESOURCE_EXHAUSTED"),
        LlmProviderFailedError("Gemini 호출 실패: ClientError"),
        TimeoutError(),
        ValueError("본문에만 적힌 소진"),
    ],
)
async def test_any_failure_moves_to_the_next(failure: Exception) -> None:
    """소진을 알리는 방식이 달라도 넘어가야 한다. 이게 이 설계의 핵심이다."""
    first, second = FakeClient(fails=failure), FakeClient(text="예비")
    assert (await ask(chain(first, second))).text == "예비"
    assert second.calls == 1


@pytest.mark.asyncio
async def test_all_failing_raises_once() -> None:
    first, second = FakeClient(fails=RuntimeError("x")), FakeClient(fails=RuntimeError("y"))
    with pytest.raises(LlmProviderFailedError) as caught:
        await ask(chain(first, second))
    assert "2개가 모두 실패" in str(caught.value)
    assert (first.calls, second.calls) == (1, 1)


def test_missing_key_drops_the_provider(monkeypatch: pytest.MonkeyPatch) -> None:
    """키가 없는 쪽은 목록에서 빠지고, 남은 하나로 돈다."""
    from app.integrations.llm import chain as chain_module

    def build(entry: str):  # type: ignore[no-untyped-def]
        if entry.startswith("gemini"):
            raise LlmUnavailableError("Gemini API 키가 설정되지 않았습니다.")
        return FakeClient()

    monkeypatch.setattr(chain_module, "build_client", build)
    built = FallbackChatClient(["gemini-3.5-flash-lite", "openai:gpt-4o-mini"])
    assert [entry for entry, _ in built.available] == ["openai:gpt-4o-mini"]
    assert built.primary == "openai:gpt-4o-mini"


def test_no_usable_provider_says_so(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.integrations.llm import chain as chain_module

    def build(entry: str):  # type: ignore[no-untyped-def]
        raise LlmUnavailableError("키 없음")

    monkeypatch.setattr(chain_module, "build_client", build)
    with pytest.raises(LlmUnavailableError):
        FallbackChatClient(["gemini-3.5-flash-lite", "openai:gpt-4o-mini"])


def test_entry_without_prefix_is_gemini(monkeypatch: pytest.MonkeyPatch) -> None:
    """`DEV_OCR_MODELS` 와 같은 표기다 — 접두어가 없으면 Gemini."""
    from app.integrations.llm import chain as chain_module

    seen: list[tuple[str, str]] = []

    class Recorder:
        def __init__(self, api_key, model_name=None, **_):  # type: ignore[no-untyped-def]
            seen.append(("gemini", model_name or ""))

    class OpenAIRecorder:
        def __init__(self, api_key, model_name=None, **_):  # type: ignore[no-untyped-def]
            seen.append(("openai", model_name or ""))

    monkeypatch.setattr(chain_module, "GeminiLLMClient", Recorder)
    monkeypatch.setattr(chain_module, "OpenAIChatClient", OpenAIRecorder)
    monkeypatch.setattr(chain_module.config, "GEMINI_API_KEY", "x")
    monkeypatch.setattr(chain_module.config, "OPENAI_API_KEY", "y")

    chain_module.build_client("gemini-3.1-flash-lite")
    chain_module.build_client("openai:gpt-4o-mini")
    assert seen == [("gemini", "gemini-3.1-flash-lite"), ("openai", "gpt-4o-mini")]
