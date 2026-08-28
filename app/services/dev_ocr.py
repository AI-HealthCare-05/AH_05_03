import asyncio
import json

from fastapi import UploadFile
from google import genai
from google.genai import types

from app.core import config
from app.dtos.ocr import RawOcrData
from app.exceptions import OcrUnavailableError

_ALLOWED_CONTENT_TYPES = {
    "image/jpeg": "image/jpeg",
    "image/png": "image/png",
    "image/webp": "image/webp",
}


class DevOcrService:
    """Gemini API를 이용한 비식별 문서 구조화 프록시 서비스.

    디스크(DB, File System)나 로그에 원본 이미지나 결과를 남기지 않고 메모리 상에서 처리한다.
    추후 브라우저 로컬 모델로 교체 시 이 서비스는 제거된다.
    """

    async def recognize(self, uploads: list[UploadFile] | UploadFile) -> dict:
        if not config.ENABLE_DEV_OCR_BRIDGE:
            raise OcrUnavailableError("개발용 OCR 브리지가 비활성화되어 있습니다.")

        file_list = uploads if isinstance(uploads, list) else [uploads]
        if not file_list:
            raise OcrUnavailableError("인식할 파일이 제공되지 않았습니다.")

        api_key = config.GEMINI_API_KEY
        if not api_key:
            raise OcrUnavailableError("Gemini API 키가 설정되지 않았습니다.")

        client = genai.Client(api_key=api_key)
        
        try:
            parts = await self._prepare_parts(file_list)
            return await self._call_gemini_api(client, parts)
        except Exception as error:
            if isinstance(error, OcrUnavailableError):
                raise
            raise OcrUnavailableError("문서 구조화에 실패했습니다. (외부 전송 오류 포함)") from error
        finally:
            for upload in file_list:
                await upload.close()

    async def _prepare_parts(self, file_list: list[UploadFile]) -> list[types.Part]:
        parts = []
        for upload in file_list:
            mime_type = _ALLOWED_CONTENT_TYPES.get(upload.content_type or "")
            if mime_type is None:
                filename = (upload.filename or "").lower()
                if filename.endswith(".png"):
                    mime_type = "image/png"
                elif filename.endswith((".jpg", ".jpeg")):
                    mime_type = "image/jpeg"
                elif filename.endswith(".webp"):
                    mime_type = "image/webp"

            if mime_type is None:
                raise OcrUnavailableError("현재 OCR은 JPEG, PNG, WEBP 이미지만 지원합니다.")

            content = await upload.read(config.DEV_OCR_MAX_FILE_BYTES + 1)
            if not content:
                raise OcrUnavailableError("비어 있는 파일은 인식할 수 없습니다.")
            if len(content) > config.DEV_OCR_MAX_FILE_BYTES:
                raise OcrUnavailableError("OCR 파일은 각 20MB 이하여야 합니다.")

            parts.append(types.Part.from_bytes(data=content, mime_type=mime_type))
        return parts

    async def _call_gemini_api(self, client: genai.Client, parts: list[types.Part]) -> dict:
        prompt = (
            "당신은 의료 문서 전문 OCR 및 데이터 구조화 AI입니다.\n"
            "제공된 건강검진 결과지, 처방전 등의 문서 이미지들을 분석하여 정형화된 JSON 데이터로 변환하세요.\n\n"
            "지침:\n"
            "1. 프라이버시(중요): 이름, 주민등록번호, 연락처 등 환자를 식별할 수 있는 개인정보(PII)는 절대 추출하지 마세요.\n"
            "2. tables (검사 항목 표 추출):\n"
            "   - 모든 검사 항목(요검사, 혈액검사, 간기능, 혈당, 지질, 신장기능, 혈압 등)을 빠짐없이 통합 표로 구조화하세요.\n"
            "   - 각 행(row)은 [검사항목명, 결과값, 단위, 판정및참고치] 4개의 열로 구성하세요.\n"
            "   - 단위나 판정이 문서에 없으면 빈 문자열('')로 채우세요.\n"
            "3. text (전체 텍스트 정리):\n"
            "   - 검사일자, 병원/기관명 및 종합 소견 등을 줄바꿈(\\n)을 사용하여 가독성 높게 작성하세요.\n"
        )

        try:
            response = await asyncio.wait_for(
                asyncio.to_thread(
                    client.models.generate_content,
                    model="gemini-3.5-flash-lite",
                    contents=[*parts, prompt],
                    config=types.GenerateContentConfig(
                        response_mime_type="application/json",
                        response_schema=RawOcrData,
                        temperature=0.0,
                    ),
                ),
                timeout=30.0
            )
        except asyncio.TimeoutError as e:
            raise OcrUnavailableError("문서 분석 시간이 초과되었습니다. (30초 제한)") from e

        if not response or not response.text:
            raise OcrUnavailableError("Gemini API로부터 응답을 받지 못했습니다.")

        try:
            validated_data = RawOcrData.model_validate_json(response.text).model_dump(mode="json")
        except Exception as e:
            raise OcrUnavailableError("API 응답 형식이 올바르지 않습니다.") from e

        validated_data["status"] = "raw"
        validated_data["automatically_confirmed"] = False
        return validated_data
