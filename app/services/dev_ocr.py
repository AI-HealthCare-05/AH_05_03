import asyncio
from pathlib import Path
from tempfile import TemporaryDirectory

from fastapi import UploadFile

from app.core import config
from app.exceptions import OcrUnavailableError

_ALLOWED_CONTENT_TYPES = {"image/jpeg": ".jpg", "image/png": ".png"}


class DevOcrService:
    """현재 ocr.py를 웹 화면에서 시험하기 위한 교체 가능한 임시 어댑터.

    파일과 OCR 결과를 DB·로그에 남기지 않는다. ocr.py가 브라우저 OCR로
    교체되면 이 서비스와 API는 제거하고 프론트 OcrAdapter만 바꾼다.
    """

    async def recognize(self, upload: UploadFile) -> dict:
        if not config.ENABLE_DEV_OCR_BRIDGE:
            raise OcrUnavailableError("개발용 OCR 브리지가 비활성화되어 있습니다.")

        suffix = _ALLOWED_CONTENT_TYPES.get(upload.content_type or "")
        if suffix is None:
            raise OcrUnavailableError("현재 OCR 테스트는 JPEG와 PNG 이미지만 지원합니다.")

        content = await upload.read(config.DEV_OCR_MAX_FILE_BYTES + 1)
        if not content:
            raise OcrUnavailableError("비어 있는 파일은 인식할 수 없습니다.")
        if len(content) > config.DEV_OCR_MAX_FILE_BYTES:
            raise OcrUnavailableError("OCR 테스트 파일은 20MB 이하여야 합니다.")

        try:
            # OCR 모듈은 OpenCV를 포함하므로 개발 기능을 실제 호출할 때만
            # 불러와 일반 API 프로세스의 시작 경로와 분리한다.
            from ocr import naver_ocr, preprocess_image

            with TemporaryDirectory(prefix="ieobom-ocr-") as temp_dir:
                source = Path(temp_dir) / f"source{suffix}"
                source.write_bytes(content)
                corrected = await asyncio.to_thread(preprocess_image, str(source))
                result = await asyncio.to_thread(naver_ocr, corrected)
        except (FileNotFoundError, RuntimeError, ValueError) as error:
            # 원본 파일명, 인식 텍스트, 외부 응답은 로그에 남기지 않는다.
            raise OcrUnavailableError("OCR 인식에 실패했습니다. 이미지와 OCR 설정을 확인해 주세요.") from error
        finally:
            await upload.close()

        return result
