import asyncio
import io
from collections.abc import AsyncIterator
from types import SimpleNamespace

import google.genai as genai
import pytest
from fastapi import UploadFile
from starlette.datastructures import Headers

from app.core import config
from app.exceptions import OcrUnavailableError, OcrUnsupportedTypeError
from app.services.dev_ocr import _MODELS, DevOcrService, recognize_parts, stream_parts

_PAYLOAD = (
    '{"text": "통합 검사 결과", "tables": [{"table_index": 1, '
    '"rows": [["식전혈당", "100", "mg/dL", "정상"], ["AST", "35", "U/L", "정상"]]}]}'
)


async def _achunks(
    payload: str, chunk_size: int, then_raise: Exception | None = None
) -> AsyncIterator[SimpleNamespace]:
    """SDK 의 스트림을 흉내 낸다. `chunk_size` 로 경계를 옮겨 가며 시험한다."""
    for start in range(0, len(payload), chunk_size):
        yield SimpleNamespace(text=payload[start : start + chunk_size])
    if then_raise is not None:
        raise then_raise


def _fake_client_streaming(payload: str, chunk_size: int | None = None):
    """`client.aio.models.generate_content_stream` 만 가진 가짜 클라이언트.

    실물은 `await` 한 뒤 async iterator 를 돌려준다 — 그 모양을 맞춰야 한다.
    """
    size = chunk_size or len(payload)

    class FakeAioModels:
        async def generate_content_stream(self, *, model, contents, config):  # noqa: A002
            return _achunks(payload, size)

    class FakeClient:
        def __init__(self, *args, **kwargs) -> None:
            self.aio = SimpleNamespace(models=FakeAioModels())

    return FakeClient


@pytest.mark.asyncio
async def test_dev_ocr_bridge_is_disabled_by_default(monkeypatch) -> None:
    monkeypatch.setattr(config, "ENABLE_DEV_OCR_BRIDGE", False)
    # 브리지가 꺼져 있는지만 보므로 본문은 읽히지 않는다. 그래도 `BinaryIO` 를 넘긴다 —
    # `SimpleNamespace` 는 타입이 맞지 않고, 나중에 이 경로가 파일을 읽게 바뀌면
    # 런타임 오류로 드러난다.
    upload = UploadFile(filename="result.png", file=io.BytesIO(b""))
    with pytest.raises(OcrUnavailableError, match="비활성화"):
        await DevOcrService().recognize(upload)


@pytest.mark.asyncio
async def test_dev_ocr_bridge_uses_gemini_single_and_multi_file(monkeypatch, tmp_path) -> None:
    source1 = tmp_path / "page1.png"
    source1.write_bytes(b"image1")
    source2 = tmp_path / "page2.pdf"
    source2.write_bytes(b"%PDF-1.4 dummy")

    upload1 = UploadFile(filename="page1.png", file=source1.open("rb"), headers=Headers({"content-type": "image/png"}))
    upload2 = UploadFile(
        filename="page2.pdf", file=source2.open("rb"), headers=Headers({"content-type": "application/pdf"})
    )

    monkeypatch.setattr(genai, "Client", _fake_client_streaming(_PAYLOAD))
    monkeypatch.setattr(config, "ENABLE_DEV_OCR_BRIDGE", True)
    monkeypatch.setattr(config, "GEMINI_API_KEY", "fake_key")

    # Test multi-file (PDF + Image)
    result = await DevOcrService().recognize([upload1, upload2])

    assert result["text"] == "통합 검사 결과"
    assert len(result["tables"][0]["rows"]) == 2
    assert result["status"] == "raw"


@pytest.mark.asyncio
async def test_sync_path_goes_through_the_streaming_implementation(monkeypatch, tmp_path) -> None:
    """`recognize_parts` 는 `stream_parts` 를 끝까지 돌리는 껍데기다.

    두 경로가 갈라지면 같은 문서에 다른 결과가 나올 수 있다. 청크를 잘게 쪼개 보내도
    동기 호출의 결과가 한 번에 받은 것과 같아야 그 계약이 지켜진다.
    """
    monkeypatch.setattr(genai, "Client", _fake_client_streaming(_PAYLOAD, chunk_size=7))
    monkeypatch.setattr(config, "ENABLE_DEV_OCR_BRIDGE", True)
    monkeypatch.setattr(config, "GEMINI_API_KEY", "fake_key")

    result = await recognize_parts([(b"image", "image/png")])
    assert result["text"] == "통합 검사 결과"
    assert result["automatically_confirmed"] is False


@pytest.mark.asyncio
async def test_stream_emits_deltas_then_a_result(monkeypatch) -> None:
    monkeypatch.setattr(genai, "Client", _fake_client_streaming(_PAYLOAD, chunk_size=5))
    monkeypatch.setattr(config, "ENABLE_DEV_OCR_BRIDGE", True)
    monkeypatch.setattr(config, "GEMINI_API_KEY", "fake_key")

    events = [event async for event in stream_parts([(b"image", "image/png")])]

    assert events[-1]["kind"] == "result"
    deltas = [e["text"] for e in events if e["kind"] == "delta"]
    # 조각을 이어 붙이면 완성본의 `text` 와 같아야 한다. 하나라도 새면 화면에서
    # 글자가 빠진 채로 보인다.
    assert "".join(deltas) == "통합 검사 결과"


@pytest.mark.asyncio
async def test_falls_back_to_the_next_model(monkeypatch) -> None:
    """503(용량 부족)이 잦은 모델을 맨 앞에 두고도 경로가 살아 있어야 한다."""
    called: list[str] = []

    class FakeAioModels:
        async def generate_content_stream(self, *, model, contents, config):  # noqa: A002
            called.append(model)
            if model == _MODELS[0]:
                raise RuntimeError("503 UNAVAILABLE")
            return _achunks(_PAYLOAD, len(_PAYLOAD))

    class FakeClient:
        def __init__(self, *args, **kwargs) -> None:
            self.aio = SimpleNamespace(models=FakeAioModels())

    monkeypatch.setattr(genai, "Client", FakeClient)
    monkeypatch.setattr(config, "ENABLE_DEV_OCR_BRIDGE", True)
    monkeypatch.setattr(config, "GEMINI_API_KEY", "fake_key")

    result = await recognize_parts([(b"image", "image/png")])
    assert result["text"] == "통합 검사 결과"
    assert called[:2] == list(_MODELS[:2])


@pytest.mark.asyncio
async def test_emits_reset_when_a_model_dies_after_output(monkeypatch) -> None:
    """앞 모델의 출력 뒤에 다음 모델 출력이 이어 붙으면 앞뒤가 섞인 글이 된다."""
    head = _PAYLOAD[: _PAYLOAD.index("검사 결과")]
    # **호출 횟수는 클래스 밖에서 센다.** `GeminiProvider.stream()` 이 호출마다
    # `genai.Client(...)` 를 새로 만들기 때문에(`ocr_providers.py`), 인스턴스 속성으로
    # 세면 모델을 넘길 때마다 `FakeAioModels` 가 새로 생겨 `seen` 이 0 으로 돌아간다.
    # 그러면 **모든** 시도가 "첫 번째"가 돼 전부 죽고, 목록을 다 소진해
    # `OcrProviderFailedError` 로 끝난다 — `reset` 을 볼 기회 자체가 없다.
    # 바로 위 `test_falls_back_to_the_next_model` 이 `called` 를 밖에 두는 것과 같은 이유다.
    seen = 0

    class FakeAioModels:
        async def generate_content_stream(self, *, model, contents, config):  # noqa: A002
            nonlocal seen
            seen += 1
            if seen == 1:
                return _achunks(head, 5, then_raise=RuntimeError("연결 끊김"))
            return _achunks(_PAYLOAD, len(_PAYLOAD))

    class FakeClient:
        def __init__(self, *args, **kwargs) -> None:
            self.aio = SimpleNamespace(models=FakeAioModels())

    monkeypatch.setattr(genai, "Client", FakeClient)
    monkeypatch.setattr(config, "ENABLE_DEV_OCR_BRIDGE", True)
    monkeypatch.setattr(config, "GEMINI_API_KEY", "fake_key")

    kinds = [e["kind"] async for e in stream_parts([(b"image", "image/png")])]
    assert "reset" in kinds
    assert kinds.index("reset") < kinds.index("result")
    # reset 뒤에도 델타가 다시 흘러야 한다 — 지우기만 하고 끝나면 화면이 빈다.
    assert "delta" in kinds[kinds.index("reset") :]


@pytest.mark.asyncio
async def test_dev_ocr_bridge_rejects_invalid_file_type(monkeypatch, tmp_path) -> None:
    source = tmp_path / "test.txt"
    source.write_bytes(b"plain text")
    upload = UploadFile(filename="test.txt", file=source.open("rb"), headers=Headers({"content-type": "text/plain"}))

    monkeypatch.setattr(config, "ENABLE_DEV_OCR_BRIDGE", True)
    monkeypatch.setattr(config, "GEMINI_API_KEY", "fake_key")

    # 사용자가 잘못 올린 것이므로 503 이 아니라 415 다 — `app/core/errors.py` 참조.
    with pytest.raises(OcrUnsupportedTypeError, match="JPEG, PNG, WEBP 이미지 및 PDF 문서만 지원"):
        await DevOcrService().recognize(upload)


@pytest.mark.asyncio
async def test_honours_the_retry_delay_a_429_reports(monkeypatch) -> None:
    """429 는 "안 된다" 가 아니라 "이따 다시 오라" 다.

    무료 등급에서는 이게 성패를 가른다. 힌트를 무시하고 모델 둘을 연달아 태우면
    둘 다 같은 429 를 맞고 작업이 실패로 확정된다 — 실제로 그렇게 실패했다.
    """
    slept: list[float] = []
    calls: list[str] = []

    async def fake_sleep(seconds: float) -> None:
        slept.append(seconds)

    class FakeAioModels:
        async def generate_content_stream(self, *, model, contents, config):  # noqa: A002
            calls.append(model)
            if len(calls) == 1:
                raise RuntimeError("429 RESOURCE_EXHAUSTED. Quota exceeded ... Please retry in 19.925417153s.")
            return _achunks(_PAYLOAD, len(_PAYLOAD))

    class FakeClient:
        def __init__(self, *args, **kwargs) -> None:
            self.aio = SimpleNamespace(models=FakeAioModels())

    monkeypatch.setattr(genai, "Client", FakeClient)
    monkeypatch.setattr(asyncio, "sleep", fake_sleep)
    monkeypatch.setattr(config, "ENABLE_DEV_OCR_BRIDGE", True)
    monkeypatch.setattr(config, "GEMINI_API_KEY", "fake_key")

    result = await recognize_parts([(b"image", "image/png")])

    assert result["text"] == "통합 검사 결과"
    # 알려 준 만큼 기다렸고, **다음 모델이 아니라 같은 모델**로 다시 걸었다.
    assert slept and 19 < slept[0] < 21, slept
    assert calls == [_MODELS[0], _MODELS[0]], calls


@pytest.mark.asyncio
async def test_does_not_wait_when_the_quota_is_truly_spent(monkeypatch) -> None:
    """하루치가 진짜 소진되면 retryDelay 가 수천 초다. 그때는 기다리지 않고 넘어간다."""
    slept: list[float] = []
    calls: list[str] = []

    async def fake_sleep(seconds: float) -> None:
        slept.append(seconds)

    class FakeAioModels:
        async def generate_content_stream(self, *, model, contents, config):  # noqa: A002
            calls.append(model)
            if model == _MODELS[0]:
                raise RuntimeError("429 RESOURCE_EXHAUSTED. Please retry in 3600.0s.")
            return _achunks(_PAYLOAD, len(_PAYLOAD))

    class FakeClient:
        def __init__(self, *args, **kwargs) -> None:
            self.aio = SimpleNamespace(models=FakeAioModels())

    monkeypatch.setattr(genai, "Client", FakeClient)
    monkeypatch.setattr(asyncio, "sleep", fake_sleep)
    monkeypatch.setattr(config, "ENABLE_DEV_OCR_BRIDGE", True)
    monkeypatch.setattr(config, "GEMINI_API_KEY", "fake_key")

    result = await recognize_parts([(b"image", "image/png")])

    assert result["text"] == "통합 검사 결과"
    assert not slept, "한 시간을 기다리면 안 된다"
    assert calls[:2] == list(_MODELS[:2]), calls
