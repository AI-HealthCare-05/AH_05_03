import asyncio

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
            "당신은 의료 문서(건강검진 결과통보서, 혈액검사지, 처방전 등) 전문 OCR 및 데이터 구조화 AI입니다.\n"
            "제공된 건강검진 문서 이미지를 꼼꼼하게 분석하여 모든 검사항목과 결과를 누락 없이 정형화된 JSON 데이터로 변환하세요.\n\n"
            "지침:\n"
            "1. 프라이버시: 성명, 주민등록번호, 전화번호, 상세주소 등 환자 식별 정보(PII)는 절대 포함하지 마세요.\n"
            "2. 검사일자/판정일자 인식 (매우 중요):\n"
            "   - 문서에 기재된 '판정일'(예: 20191228 -> 2019-12-28), '검진일자', '수검일자'를 반드시 찾아내어 text의 첫 줄에 `[검진 기본정보] 판정/검진일자: YYYY-MM-DD, 검진기관: [기관명]` 형식으로 작성하세요.\n"
            "   - 문서 하단의 단순 출력/조회일시(예: 2026년08월31일)와 실제 검사/판정일(예: 20191228)을 혼동하지 말고, 실제 의사 판정일/수검일을 정확하게 추출하세요.\n"
            "3. 모든 검사 영역의 수치 및 체크박스(■/☑) 판정 누락 없이 추출:\n"
            "   - [계측검사]: 체질량지수(BMI) 및 판정, 허리둘레 및 복부비만 여부, 시력(좌/우, 교정여부), 청력(좌/우), 혈압(수축기/이완기 수치 및 판정)\n"
            "   - [혈액검사]: 혈색소(빈혈), 공복혈당(당뇨), 이상지질혈증(총콜레스테롤, HDL, 중성지방, LDL), 신장기능(혈청크레아티닌, e-GFR), 간기능(AST, ALT, 감마GTP)\n"
            "   - [요검사/영상검사]: 요단백(정상/경계/단백뇨), 흉부X선(정상/의심)\n"
            "   - [진찰/문진/생활습관]: 과거병력, 약물치료, 생활습관 개선 소견(절주 필요, 신체활동 필요, 근력운동 필요, 금연 등 체크된 모든 항목)\n"
            "   - [기타검사 및 종합소견]: 종합 판정(정상A, 정상B, 질환의심 등) 및 의사 소견 전체\n"
            "4. tables (표 구조화):\n"
            "   - 위 모든 항목들을 빠짐없이 통합 표로 구성하세요.\n"
            "   - 각 행(row)은 [검사항목명, 결과값(또는 체크된 판정), 단위, 판정및참고치] 4개의 열로 구성하세요.\n"
            "5. text (전체 텍스트 정리):\n"
            "   - 검진일자, 검진기관, 각 영역별 상세 수치와 판정 소견, 생활습관 권고사항을 줄바꿈(\\n)과 섹션별로 가독성 높고 일목요연하게 작성하세요.\n"
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
                timeout=30.0,
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
