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
    "application/pdf": "application/pdf",
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
        parts: list[types.Part] = []

        try:
            for upload in file_list:
                mime_type = _ALLOWED_CONTENT_TYPES.get(upload.content_type or "")
                if mime_type is None:
                    # 파일명 확장자 기반 보조 판별
                    filename = (upload.filename or "").lower()
                    if filename.endswith(".pdf"):
                        mime_type = "application/pdf"
                    elif filename.endswith(".png"):
                        mime_type = "image/png"
                    elif filename.endswith((".jpg", ".jpeg")):
                        mime_type = "image/jpeg"
                    elif filename.endswith(".webp"):
                        mime_type = "image/webp"

                if mime_type is None:
                    raise OcrUnavailableError("현재 OCR은 JPEG, PNG, WEBP 이미지 및 PDF 문서만 지원합니다.")

                content = await upload.read(config.DEV_OCR_MAX_FILE_BYTES + 1)
                if not content:
                    raise OcrUnavailableError("비어 있는 파일은 인식할 수 없습니다.")
                if len(content) > config.DEV_OCR_MAX_FILE_BYTES:
                    raise OcrUnavailableError("OCR 파일은 각 20MB 이하여야 합니다.")

                parts.append(types.Part.from_bytes(data=content, mime_type=mime_type))

            prompt = (
                "당신은 의료 문서 전문 OCR 및 데이터 구조화 AI입니다.\n"
                "제공된 건강검진 결과지, 검사결과서, 진단서, 처방전 문서(다중 페이지 PDF 또는 여러 장의 이미지 포함)를 종합 분석하여 "
                "사용자가 보기 쉽고 명확하게 정형화된 JSON 데이터로 변환하세요.\n\n"
                "지침:\n"
                "1. tables (검사 항목 표 추출):\n"
                "   - 여러 페이지나 여러 장의 사진에 나뉘어 있는 모든 검사 항목(요검사, 혈액검사, 간기능, 혈당, 지질/콜레스테롤, 신장기능, 혈압 등)을 빠짐없이 하나의 통합 표로 구조화하세요.\n"
                "   - 각 행(row)의 배열은 반드시 다음 순서의 4개 열로 구성하세요: [검사항목명, 결과값, 단위, 판정및참고치]\n"
                "     예시: ['식전혈당(FBS)', '113', 'mg/dL', '이상 (정상: 74~99)'], ['AST (SGOT)', '41', 'U/L', '이상 (정상: 0~40)'], ['수축기 혈압', '120', 'mmHg', '정상']\n"
                "   - 단위나 판정이 문서에 없으면 빈 문자열('')로 채우세요.\n"
                "2. text (전체 텍스트 정리):\n"
                "   - 문서의 기본 정보(환자 정보, 검사일자, 병원/기관명)와 검사 결과들을 줄바꿈(\\n)을 적절히 사용하여 깔끔하고 가독성 높게 작성하세요.\n"
                "   - 문장이 이어져서 한 덩어리의 줄글로 뭉치지 않도록 항목별로 줄바꿈을 반드시 적용하세요."
            )

            # 주 모델로 gemini-3.5-flash-lite 사용
            models_to_try = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"]
            last_err = None
            response = None

            for model_name in models_to_try:
                try:
                    response = await asyncio.to_thread(
                        client.models.generate_content,
                        model=model_name,
                        contents=[*parts, prompt],
                        config=types.GenerateContentConfig(
                            response_mime_type="application/json",
                            response_schema=RawOcrData,
                            temperature=0.0,
                        ),
                    )
                    if response and response.text:
                        break
                except Exception as ex:
                    last_err = ex
                    continue

            if not response or not response.text:
                if last_err:
                    raise last_err
                raise OcrUnavailableError("Gemini API로부터 응답을 받지 못했습니다.")

            result_dict = json.loads(response.text)

            # API 계약(Contract) 충족을 위한 기본값 고정
            result_dict["status"] = "raw"
            result_dict["automatically_confirmed"] = False

            return result_dict

        except Exception as error:
            if isinstance(error, OcrUnavailableError):
                raise
            # 보안: 원본 데이터나 외부 오류 상세를 로깅하지 않음.
            raise OcrUnavailableError("문서 구조화에 실패했습니다. (외부 전송 오류 포함)") from error
        finally:
            for upload in file_list:
                await upload.close()
