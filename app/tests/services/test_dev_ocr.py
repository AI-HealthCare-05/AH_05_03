from types import SimpleNamespace

import pytest
from fastapi import UploadFile

from app.core import config
from app.exceptions import OcrUnavailableError
from app.services.dev_ocr import DevOcrService


@pytest.mark.asyncio
async def test_dev_ocr_bridge_is_disabled_by_default(monkeypatch) -> None:
    monkeypatch.setattr(config, "ENABLE_DEV_OCR_BRIDGE", False)
    upload = UploadFile(filename="result.png", file=SimpleNamespace())
    with pytest.raises(OcrUnavailableError, match="비활성화"):
        await DevOcrService().recognize(upload)


@pytest.mark.asyncio
async def test_dev_ocr_bridge_uses_gemini_single_and_multi_file(monkeypatch, tmp_path) -> None:
    source1 = tmp_path / "page1.png"
    source1.write_bytes(b"image1")
    source2 = tmp_path / "page2.jpg"
    source2.write_bytes(b"image2")

    upload1 = UploadFile(filename="page1.png", file=source1.open("rb"), headers={"content-type": "image/png"})
    upload2 = UploadFile(filename="page2.jpg", file=source2.open("rb"), headers={"content-type": "image/jpeg"})

    # Mock GenAI client
    class FakeResponse:
        text = '{"text": "통합 검사 결과", "tables": [{"table_index": 1, "rows": [["식전혈당", "100", "mg/dL", "정상"], ["AST", "35", "U/L", "정상"]]}]}'

    class FakeModels:
        def generate_content(self, *args, **kwargs):
            return FakeResponse()

    class FakeClient:
        def __init__(self, *args, **kwargs):
            self.models = FakeModels()

    import google.genai as genai
    monkeypatch.setattr(genai, "Client", FakeClient)

    monkeypatch.setattr(config, "ENABLE_DEV_OCR_BRIDGE", True)
    monkeypatch.setattr(config, "GEMINI_API_KEY", "fake_key")

    # Test multi-file (Images)
    result = await DevOcrService().recognize([upload1, upload2])

    assert result["text"] == "통합 검사 결과"
    assert len(result["tables"][0]["rows"]) == 2
    assert result["status"] == "raw"


@pytest.mark.asyncio
async def test_dev_ocr_bridge_rejects_invalid_file_type(monkeypatch, tmp_path) -> None:
    source = tmp_path / "test.txt"
    source.write_bytes(b"plain text")
    upload = UploadFile(filename="test.txt", file=source.open("rb"), headers={"content-type": "text/plain"})

    monkeypatch.setattr(config, "ENABLE_DEV_OCR_BRIDGE", True)
    monkeypatch.setattr(config, "GEMINI_API_KEY", "fake_key")

    with pytest.raises(OcrUnavailableError, match="JPEG, PNG, WEBP 이미지만 지원"):
        await DevOcrService().recognize(upload)

