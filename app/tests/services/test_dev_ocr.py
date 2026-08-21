import sys
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
async def test_dev_ocr_bridge_uses_gemini(monkeypatch, tmp_path) -> None:
    source = tmp_path / "result.png"
    source.write_bytes(b"image")
    upload = UploadFile(filename="result.png", file=source.open("rb"), headers={"content-type": "image/png"})
    
    # Mock GenAI client
    class FakeResponse:
        text = '{"text": "검사 결과 원문", "tables": [{"table_index": 1, "rows": [["항목", "결과"]]}]}'
        
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

    result = await DevOcrService().recognize(upload)

    assert result["text"] == "검사 결과 원문"
    assert result["tables"][0]["rows"] == [["항목", "결과"]]
    assert result["status"] == "raw"
