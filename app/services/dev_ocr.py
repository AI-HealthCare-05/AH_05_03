import asyncio
import json

from fastapi import UploadFile
from google import genai
from google.genai import types

from app.core import config
from app.dtos.ocr import RawOcrData
from app.exceptions import OcrUnavailableError

_ALLOWED_CONTENT_TYPES = {"image/jpeg": "image/jpeg", "image/png": "image/png"}


class DevOcrService:
    """Gemini API를 이용한 비식별 문서 구조화 프록시 서비스.

    디스크(DB, File System)나 로그에 원본 이미지나 결과를 남기지 않고 메모리 상에서 처리한다.
    추후 브라우저 로컬 모델로 교체 시 이 서비스는 제거된다.
    """

    async def recognize(self, upload: UploadFile) -> dict:
        if not config.ENABLE_DEV_OCR_BRIDGE:
            raise OcrUnavailableError("개발용 OCR 브리지가 비활성화되어 있습니다.")

        mime_type = _ALLOWED_CONTENT_TYPES.get(upload.content_type or "")
        if mime_type is None:
            raise OcrUnavailableError("현재 OCR 테스트는 JPEG와 PNG 이미지만 지원합니다.")

        # 디스크를 거치지 않고 메모리에서만 읽음 (Stateless 방어)
        content = await upload.read(config.DEV_OCR_MAX_FILE_BYTES + 1)
        if not content:
            raise OcrUnavailableError("비어 있는 파일은 인식할 수 없습니다.")
        if len(content) > config.DEV_OCR_MAX_FILE_BYTES:
            raise OcrUnavailableError("OCR 테스트 파일은 20MB 이하여야 합니다.")

        api_key = config.GEMINI_API_KEY
        if not api_key:
            raise OcrUnavailableError("Gemini API 키가 설정되지 않았습니다.")

        client = genai.Client(api_key=api_key)

        prompt = (
            "이 문서는 건강 검진 결과지, 진단서, 처방전 등의 의료 문서입니다. "
            "문서에 있는 모든 텍스트를 읽고 지정된 JSON 스키마에 맞게 구조화해 주세요.\n"
            "1. text: 문서 전체의 텍스트 내용을 한 문자열로 이어서 작성\n"
            "2. tables: 문서 내에 표(Table)가 있다면 각 표를 식별해서 배열로 반환. "
            "각 표는 table_index(0부터 시작)와 rows(2차원 배열 형태의 문자열 리스트)를 가짐."
        )

        try:
            # 네트워크 IO를 block하지 않도록 asyncio.to_thread 사용
            response = await asyncio.to_thread(
                client.models.generate_content,
                model='gemini-1.5-pro',
                contents=[
                    types.Part.from_bytes(data=content, mime_type=mime_type),
                    prompt
                ],
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema=RawOcrData,
                    temperature=0.0,
                )
            )

            if not response.text:
                raise OcrUnavailableError("Gemini API로부터 빈 응답을 받았습니다.")

            result_dict = json.loads(response.text)
            
            # API 계약(Contract) 충족을 위한 기본값 고정
            result_dict["status"] = "raw"
            result_dict["automatically_confirmed"] = False

            return result_dict

        except Exception as error:
            # 보안: 원본 데이터나 외부 오류 상세를 로깅하지 않음.
            raise OcrUnavailableError("문서 구조화에 실패했습니다. (외부 전송 오류 포함)") from error
        finally:
            await upload.close()
