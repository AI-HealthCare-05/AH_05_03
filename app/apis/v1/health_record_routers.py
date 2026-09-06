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
    HealthRecordSyncRequest,
    HealthRecordUpdateRequest,
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
