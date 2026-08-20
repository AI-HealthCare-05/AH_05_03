import sys
from types import SimpleNamespace

import pytest
from fastapi import UploadFile

from app.core import config
from app.exceptions import OcrUnavailableError
from app.services.dev_ocr import DevOcrService


@pytest.mark.asyncio
async def test_dev_ocr_bridge_is_disabled_by_default() -> None:
    upload = UploadFile(filename="result.png", file=SimpleNamespace())
    with pytest.raises(OcrUnavailableError, match="비활성화"):
        await DevOcrService().recognize(upload)


@pytest.mark.asyncio
async def test_dev_ocr_bridge_adapts_current_ocr_py_output(monkeypatch, tmp_path) -> None:
    source = tmp_path / "result.png"
    source.write_bytes(b"image")
    upload = UploadFile(filename="result.png", file=source.open("rb"), headers={"content-type": "image/png"})
    fake_ocr = SimpleNamespace(
        preprocess_image=lambda path: path,
        naver_ocr=lambda path: {"text": "검사 결과 원문", "tables": [{"table_index": 1, "rows": [["항목", "결과"]]}]},
    )
    monkeypatch.setitem(sys.modules, "ocr", fake_ocr)
    monkeypatch.setattr(config, "ENABLE_DEV_OCR_BRIDGE", True)

    result = await DevOcrService().recognize(upload)

    assert result["text"] == "검사 결과 원문"
    assert result["tables"][0]["rows"] == [["항목", "결과"]]
