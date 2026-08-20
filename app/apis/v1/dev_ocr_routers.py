from typing import Annotated

from fastapi import APIRouter, Depends, File, UploadFile

from app.core.errors import ErrorCode
from app.dtos.envelope import ApiResponse, error_responses
from app.dtos.ocr import RawOcrData
from app.services.dev_ocr import DevOcrService

dev_ocr_router = APIRouter(prefix="/dev/ocr", tags=["development-ocr"])


@dev_ocr_router.post(
    "/recognize",
    response_model=ApiResponse[RawOcrData],
    responses=error_responses(ErrorCode.OCR_UNAVAILABLE, ErrorCode.VALIDATION_ERROR),
    summary="개발용 원시 OCR 실행",
    description="ocr.py의 현재 출력 확인용이다. 파일과 결과를 DB에 저장하지 않으며 운영에서는 비활성화한다.",
)
async def recognize_document(
    file: Annotated[UploadFile, File(description="JPEG 또는 PNG 건강서류 이미지")],
    service: Annotated[DevOcrService, Depends(DevOcrService)],
) -> ApiResponse[RawOcrData]:
    result = await service.recognize(file)
    return ApiResponse(data=RawOcrData(**result), message="원시 OCR 결과를 불러왔습니다.")
