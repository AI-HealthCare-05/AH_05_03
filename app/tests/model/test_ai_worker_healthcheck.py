from types import SimpleNamespace

import pytest

from ai_worker import consumer, healthcheck


class FakeRedis:
    def __init__(self, consumers: dict[str, list[dict]]) -> None:
        self.consumers = consumers
        self.closed = False

    async def ping(self) -> None:
        return None

    async def xinfo_consumers(self, stream: str, _group: str) -> list[dict]:
        return self.consumers.get(stream, [])

    async def aclose(self) -> None:
        self.closed = True


@pytest.mark.asyncio
async def test_healthcheck_requires_prediction_and_ocr_consumers(monkeypatch: pytest.MonkeyPatch) -> None:
    redis = FakeRedis(
        {
            "ieobom:predict:stream": [{"name": "worker-101", "idle": 5}],
            "ieobom:ocr:stream": [],
        }
    )
    monkeypatch.setattr(consumer, "build_redis", lambda: redis)
    monkeypatch.setattr(healthcheck, "registry", SimpleNamespace(available=True, targets=lambda: ["one"]))
    monkeypatch.setattr(healthcheck, "HOSTNAME", "worker")

    healthy, detail = await healthcheck.check()

    assert healthy is False
    assert "ocr" in detail
    assert redis.closed is True


@pytest.mark.asyncio
async def test_healthcheck_accepts_worker_registered_to_both_queues(monkeypatch: pytest.MonkeyPatch) -> None:
    redis = FakeRedis(
        {
            "ieobom:predict:stream": [{"name": "worker-101", "idle": 5}],
            "ieobom:ocr:stream": [{"name": "worker-101", "idle": 7}],
        }
    )
    monkeypatch.setattr(consumer, "build_redis", lambda: redis)
    monkeypatch.setattr(healthcheck, "registry", SimpleNamespace(available=True, targets=lambda: ["one"]))
    monkeypatch.setattr(healthcheck, "HOSTNAME", "worker")

    healthy, detail = await healthcheck.check()

    assert healthy is True
    assert "queues=2" in detail
    assert redis.closed is True
