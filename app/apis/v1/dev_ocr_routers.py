from typing import Annotated

from fastapi import APIRouter, Depends, File, UploadFile

from app.core.errors import ErrorCode
from app.dtos.envelope import ApiResponse, error_responses
from app.dtos.ocr import RawOcrData
from app.exceptions import OcrUnavailableError
from app.services.dev_ocr import DevOcrService

dev_ocr_router = APIRouter(prefix="/dev/ocr", tags=["development-ocr"])


@dev_ocr_router.post(
    "/recognize",
    response_model=ApiResponse[RawOcrData],
    responses=error_responses(ErrorCode.OCR_UNAVAILABLE, ErrorCode.VALIDATION_ERROR),
    summary="개발용 원시 OCR 실행",
    description="Gemini API를 이용한 비식별 문서(PDF/이미지) 구조화 프록시. 파일과 결과를 DB에 저장하지 않으며 운영에서는 비활성화한다.",
)
async def recognize_document(
    service: Annotated[DevOcrService, Depends(DevOcrService)],
    file: Annotated[UploadFile | None, File(description="단일 건강서류 이미지 또는 PDF")] = None,
    files: Annotated[list[UploadFile] | None, File(description="복수 건강서류 이미지 또는 PDF")] = None,
) -> ApiResponse[RawOcrData]:
    target_files = files or ([file] if file else [])
    if not target_files:
        raise OcrUnavailableError("인식할 파일이 제공되지 않았습니다.")
    result = await service.recognize(target_files)
    return ApiResponse(data=RawOcrData(**result), message="원시 OCR 결과를 불러왔습니다.")

