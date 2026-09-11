import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status

from app.core.errors import ErrorCode
from app.dependencies.security import require_active_account
from app.dtos.envelope import ApiResponse, error_responses
from app.dtos.health_records import (
    HealthRecordCreateRequest,
    HealthRecordData,
    HealthRecordListData,
    HealthRecordPrefillData,
    HealthRecordSyncRequest,
    HealthRecordUpdateRequest,
    HealthRecordValuesData,
)
from app.models.service_accounts import ServiceAccount
from app.services.health_records import HealthRecordService

health_record_router = APIRouter(prefix="/health-records", tags=["health-records"])

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


@health_record_router.post(
    "",
    response_model=ApiResponse[HealthRecordData],
    status_code=status.HTTP_201_CREATED,
    responses=error_responses(
        *_AUTH_ERRORS,
        ErrorCode.HOUSEHOLD_NOT_FOUND,
        ErrorCode.HOUSEHOLD_MEMBERSHIP_REQUIRED,
        ErrorCode.PROFILE_NOT_FOUND,
    ),
    summary="건강 기록 생성",
)
async def create_record(
    req: HealthRecordCreateRequest,
    account: Annotated[ServiceAccount, Depends(require_active_account)],
    service: Annotated[HealthRecordService, Depends(HealthRecordService)],
) -> ApiResponse[HealthRecordData]:
    data = await service.create_record(account, req)
    return ApiResponse(data=data, message="건강 기록을 생성했습니다.")


@health_record_router.get(
    "",
    response_model=ApiResponse[HealthRecordListData],
    responses=error_responses(
        *_AUTH_ERRORS,
        ErrorCode.PROFILE_NOT_FOUND,
        ErrorCode.HOUSEHOLD_MEMBERSHIP_REQUIRED,
    ),
    summary="프로필별 건강 기록 목록 조회",
)
async def list_records(
    profile_id: Annotated[uuid.UUID, Query(description="프로필 ID")],
    account: Annotated[ServiceAccount, Depends(require_active_account)],
    service: Annotated[HealthRecordService, Depends(HealthRecordService)],
    record_type: str | None = Query(None, description="기록 유형 필터"),
    limit: int = Query(100, ge=1, le=500, description="조회 개수"),
    offset: int = Query(0, ge=0, description="오프셋"),
) -> ApiResponse[HealthRecordListData]:
    data = await service.list_records(account, profile_id, record_type=record_type, limit=limit, offset=offset)
    return ApiResponse(data=data, message="건강 기록 목록을 조회했습니다.")


@health_record_router.get(
    # **`/{record_id}` 보다 위에 있어야 한다.** 아래에 두면 FastAPI 가 `prefill` 을
    # `record_id` 로 먼저 잡아 UUID 파싱에서 422 를 낸다 — 라우트가 겹칠 때 먼저
    # 선언된 쪽이 이긴다.
    "/prefill",
    response_model=ApiResponse[HealthRecordPrefillData],
    responses=error_responses(
        *_AUTH_ERRORS,
        ErrorCode.PROFILE_NOT_FOUND,
        ErrorCode.HOUSEHOLD_MEMBERSHIP_REQUIRED,
    ),
    summary="남긴 기록으로 판정 폼 채우기",
)
async def prefill_from_records(
    profile_id: Annotated[uuid.UUID, Query(description="프로필 ID")],
    account: Annotated[ServiceAccount, Depends(require_active_account)],
    service: Annotated[HealthRecordService, Depends(HealthRecordService)],
) -> ApiResponse[HealthRecordPrefillData]:
    """혈압·혈당·체성분·검사값 기록을 판정 폼 입력으로 옮긴다.

    옮기는 규칙과 관문은 `app/services/record_prefill.py` 한 곳에 있다. 통증 다이어리와
    판정 스냅샷은 여기로 오지 않는다(그 모듈 머리말 참조).
    """
    data = await service.build_prefill(account, profile_id)
    return ApiResponse(data=data, message="기록에서 판정 입력을 만들었습니다.")


@health_record_router.get(
    "/{record_id}/values",
    response_model=ApiResponse[HealthRecordValuesData],
    responses=error_responses(
        *_AUTH_ERRORS,
        ErrorCode.HEALTH_RECORD_NOT_FOUND,
        ErrorCode.HOUSEHOLD_MEMBERSHIP_REQUIRED,
    ),
    summary="기록 하나의 판정 칸 값 조회",
)
async def read_record_values(
    record_id: uuid.UUID,
    account: Annotated[ServiceAccount, Depends(require_active_account)],
    service: Annotated[HealthRecordService, Depends(HealthRecordService)],
) -> ApiResponse[HealthRecordValuesData]:
    """검진표에서 읽은 행을 판정 칸 이름으로 풀어 준다.

    표기 100개를 판정 칸 20개에 잇는 사전은 `app/services/ocr_measurements.py` 에만
    있다. 클라이언트가 직접 풀면 같은 판단이 두 곳에 살게 된다 — 그래서 이 길이 있다.
    """
    data = await service.record_values(account, record_id)
    return ApiResponse(data=data, message="기록의 판정 칸 값을 조회했습니다.")


@health_record_router.get(
    "/{record_id}",
    response_model=ApiResponse[HealthRecordData],
    responses=error_responses(
        *_AUTH_ERRORS,
        ErrorCode.HEALTH_RECORD_NOT_FOUND,
        ErrorCode.HOUSEHOLD_MEMBERSHIP_REQUIRED,
    ),
    summary="건강 기록 상세 조회",
)
async def get_record(
    record_id: uuid.UUID,
    account: Annotated[ServiceAccount, Depends(require_active_account)],
    service: Annotated[HealthRecordService, Depends(HealthRecordService)],
) -> ApiResponse[HealthRecordData]:
    data = await service.get_record(account, record_id)
    return ApiResponse(data=data, message="건강 기록을 조회했습니다.")


@health_record_router.patch(
    "/{record_id}",
    response_model=ApiResponse[HealthRecordData],
    responses=error_responses(
        *_AUTH_ERRORS,
        ErrorCode.HEALTH_RECORD_NOT_FOUND,
        ErrorCode.HOUSEHOLD_MEMBERSHIP_REQUIRED,
    ),
    summary="건강 기록 수정",
)
async def update_record(
    record_id: uuid.UUID,
    req: HealthRecordUpdateRequest,
    account: Annotated[ServiceAccount, Depends(require_active_account)],
    service: Annotated[HealthRecordService, Depends(HealthRecordService)],
) -> ApiResponse[HealthRecordData]:
    data = await service.update_record(account, record_id, req)
    return ApiResponse(data=data, message="건강 기록을 수정했습니다.")


@health_record_router.delete(
    "/{record_id}",
    response_model=ApiResponse[dict[str, bool]],
    responses=error_responses(
        *_AUTH_ERRORS,
        ErrorCode.HEALTH_RECORD_NOT_FOUND,
        ErrorCode.HOUSEHOLD_MEMBERSHIP_REQUIRED,
    ),
    summary="건강 기록 삭제",
)
async def delete_record(
    record_id: uuid.UUID,
    account: Annotated[ServiceAccount, Depends(require_active_account)],
    service: Annotated[HealthRecordService, Depends(HealthRecordService)],
) -> ApiResponse[dict[str, bool]]:
    await service.delete_record(account, record_id)
    return ApiResponse(data={"ok": True}, message="건강 기록을 삭제했습니다.")


@health_record_router.post(
    "/sync",
    response_model=ApiResponse[HealthRecordListData],
    responses=error_responses(
        *_AUTH_ERRORS,
        ErrorCode.HOUSEHOLD_NOT_FOUND,
        ErrorCode.HOUSEHOLD_MEMBERSHIP_REQUIRED,
    ),
    summary="건강 기록 일괄 동기화 (IndexedDB -> PG)",
)
async def sync_records(
    req: HealthRecordSyncRequest,
    account: Annotated[ServiceAccount, Depends(require_active_account)],
    service: Annotated[HealthRecordService, Depends(HealthRecordService)],
) -> ApiResponse[HealthRecordListData]:
    data = await service.sync_records(account, req)
    return ApiResponse(data=data, message="건강 기록을 동기화했습니다.")
