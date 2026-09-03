import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, File, UploadFile, status
from redis.asyncio import Redis

from app.core.errors import ErrorCode
from app.core.jobs import JobStatus, JobStore, TaskName
from app.core.redis.client import get_redis
from app.dependencies.security import require_active_account
from app.dtos.documents import OcrExtractionData, OcrJobData
from app.dtos.envelope import ApiResponse, error_responses
from app.exceptions import JobNotFoundError
from app.models.service_accounts import ServiceAccount
from app.services.documents import DocumentOcrService

document_router = APIRouter(prefix="/documents", tags=["documents"])

_AUTH_ERRORS = (
    ErrorCode.AUTH_REQUIRED,
    ErrorCode.TOKEN_INVALID,
    ErrorCode.TOKEN_EXPIRED,
    ErrorCode.TOKEN_REVOKED,
    ErrorCode.ACCOUNT_NOT_FOUND,
    ErrorCode.ACCOUNT_SUSPENDED,
    ErrorCode.ACCOUNT_CLOSED,
    ErrorCode.SERVICE_UNAVAILABLE,
)


async def get_job_store(redis: Annotated[Redis, Depends(get_redis)]) -> JobStore:
    return JobStore(redis)


@document_router.post(
    "/ocr",
    status_code=status.HTTP_202_ACCEPTED,
    response_model=ApiResponse[OcrJobData],
    responses=error_responses(
        *_AUTH_ERRORS,
        ErrorCode.DOCUMENT_UNSUPPORTED_TYPE,
        ErrorCode.DOCUMENT_TOO_LARGE,
        ErrorCode.DOCUMENT_RESOLUTION_TOO_LOW,
    ),
    summary="검진문서 인식 작업 등록 (저장하지 않음)",
    description=(
        "건강검진 결과지 이미지를 인식 큐에 넣고 `job_id`를 돌려준다. "
        "결과는 `GET /documents/ocr/{job_id}`로 조회한다.\n\n"
        "- 형식·크기·해상도는 이 시점에 검사한다. 통과하지 못하면 큐에 넣지 않고 바로 거절한다.\n"
        "- 원본 이미지는 인식이 끝나는 즉시 삭제한다. 디스크·DB에 쓰지 않는다.\n"
        "- 인식 결과의 수치는 **후보값**이다. `needs_review=true`인 행은 사용자 확인 없이 쓰지 않는다.\n"
        "- 기록은 이 엔드포인트가 하지 않는다. 호출자가 검수 후 저장 위치를 결정한다."
    ),
)
async def enqueue_document_extraction(
    account: Annotated[ServiceAccount, Depends(require_active_account)],
    store: Annotated[JobStore, Depends(get_job_store)],
    file: Annotated[UploadFile, File(description="검진 결과지 이미지 (JPG·PNG·WebP, 20MB 이하)")],
) -> ApiResponse[OcrJobData]:
    content = await file.read()
    DocumentOcrService.validate(content=content, content_type=file.content_type)
    record = await store.enqueue(task=TaskName.OCR_EXTRACT, payload=content, owner_account_id=account.id)
    return ApiResponse(
        data=OcrJobData(job_id=record.job_id, status=record.status),
        message="인식 작업을 등록했습니다. job_id로 결과를 조회해 주세요.",
    )


@document_router.get(
    "/ocr/{job_id}",
    response_model=ApiResponse[OcrJobData],
    responses=error_responses(
        *_AUTH_ERRORS,
        ErrorCode.JOB_NOT_FOUND,
        ErrorCode.OCR_NO_RESULT,
        ErrorCode.OCR_UNAVAILABLE,
    ),
    summary="검진문서 인식 결과 조회",
    description=(
        "등록한 인식 작업의 상태와 결과를 돌려준다.\n\n"
        "- `queued`·`running`이면 아직 처리 중이다. 잠시 후 다시 조회한다.\n"
        "- `succeeded`면 `result`에 인식 결과가 들어 있다.\n"
        "- `failed`면 `error_code`가 실패 사유를 가리킨다.\n"
        "- 결과는 일정 시간이 지나면 사라진다. 그 뒤 조회하면 `JOB_NOT_FOUND`다."
    ),
)
async def get_document_extraction(
    account: Annotated[ServiceAccount, Depends(require_active_account)],
    store: Annotated[JobStore, Depends(get_job_store)],
    job_id: uuid.UUID,
) -> ApiResponse[OcrJobData]:
    record = await store.read(job_id)
    # 남의 작업은 없는 것과 똑같이 답한다. 존재 여부도 알려주지 않는다.
    if record is None or record.owner_account_id != account.id:
        raise JobNotFoundError()

    result = OcrExtractionData.model_validate(record.result) if record.result is not None else None
    return ApiResponse(
        data=OcrJobData(
            job_id=record.job_id,
            status=record.status,
            result=result,
            error_code=record.error_code,
            error_message=record.error_message,
        ),
        message=_describe(record.status, result),
    )


def _describe(job_status: JobStatus, result: OcrExtractionData | None) -> str:
    if job_status is JobStatus.SUCCEEDED and result is not None:
        return (
            f"{len(result.rows)}개 항목을 인식했습니다. "
            f"{result.needs_review}개는 확인이 필요합니다. 원본 이미지는 저장하지 않았습니다."
        )
    if job_status is JobStatus.FAILED:
        return "인식에 실패했습니다."
    return "인식 중입니다. 잠시 후 다시 조회해 주세요."
