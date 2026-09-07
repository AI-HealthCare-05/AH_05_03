import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status

from app.core.errors import ErrorCode
from app.dependencies.security import require_active_account
from app.dtos.envelope import ApiResponse, error_responses
from app.dtos.profiles import (
    ProfileCreateRequest,
    ProfileData,
    ProfileListData,
    ProfileSyncRequest,
    ProfileUpdateRequest,
)
from app.models.service_accounts import ServiceAccount
from app.services.profiles import ProfileService

profile_router = APIRouter(prefix="/profiles", tags=["profiles"])

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


@profile_router.post(
    "",
    response_model=ApiResponse[ProfileData],
    status_code=status.HTTP_201_CREATED,
    responses=error_responses(*_AUTH_ERRORS, ErrorCode.HOUSEHOLD_NOT_FOUND, ErrorCode.HOUSEHOLD_MEMBERSHIP_REQUIRED),
    summary="가족 프로필 생성",
)
async def create_profile(
    req: ProfileCreateRequest,
    account: Annotated[ServiceAccount, Depends(require_active_account)],
    service: Annotated[ProfileService, Depends(ProfileService)],
) -> ApiResponse[ProfileData]:
    data = await service.create_profile(account, req)
    return ApiResponse(data=data, message="프로필을 생성했습니다.")


@profile_router.get(
    "",
    response_model=ApiResponse[ProfileListData],
    responses=error_responses(*_AUTH_ERRORS, ErrorCode.HOUSEHOLD_NOT_FOUND, ErrorCode.HOUSEHOLD_MEMBERSHIP_REQUIRED),
    summary="가정 내 프로필 목록 조회",
)
async def list_profiles(
    household_id: Annotated[uuid.UUID, Query(description="가정 ID")],
    account: Annotated[ServiceAccount, Depends(require_active_account)],
    service: Annotated[ProfileService, Depends(ProfileService)],
    include_hidden: bool = Query(False, description="숨김 프로필 포함 여부"),
) -> ApiResponse[ProfileListData]:
    data = await service.list_profiles(account, household_id, include_hidden=include_hidden)
    return ApiResponse(data=data, message="프로필 목록을 조회했습니다.")


@profile_router.get(
    "/{profile_id}",
    response_model=ApiResponse[ProfileData],
    responses=error_responses(*_AUTH_ERRORS, ErrorCode.PROFILE_NOT_FOUND, ErrorCode.HOUSEHOLD_MEMBERSHIP_REQUIRED),
    summary="프로필 상세 조회",
)
async def get_profile(
    profile_id: uuid.UUID,
    account: Annotated[ServiceAccount, Depends(require_active_account)],
    service: Annotated[ProfileService, Depends(ProfileService)],
) -> ApiResponse[ProfileData]:
    data = await service.get_profile(account, profile_id)
    return ApiResponse(data=data, message="프로필을 조회했습니다.")


@profile_router.patch(
    "/{profile_id}",
    response_model=ApiResponse[ProfileData],
    responses=error_responses(*_AUTH_ERRORS, ErrorCode.PROFILE_NOT_FOUND, ErrorCode.HOUSEHOLD_MEMBERSHIP_REQUIRED),
    summary="프로필 수정",
)
async def update_profile(
    profile_id: uuid.UUID,
    req: ProfileUpdateRequest,
    account: Annotated[ServiceAccount, Depends(require_active_account)],
    service: Annotated[ProfileService, Depends(ProfileService)],
) -> ApiResponse[ProfileData]:
    data = await service.update_profile(account, profile_id, req)
    return ApiResponse(data=data, message="프로필을 수정했습니다.")


@profile_router.delete(
    "/{profile_id}",
    response_model=ApiResponse[dict[str, bool]],
    responses=error_responses(*_AUTH_ERRORS, ErrorCode.PROFILE_NOT_FOUND, ErrorCode.HOUSEHOLD_MEMBERSHIP_REQUIRED),
    summary="프로필 삭제",
)
async def delete_profile(
    profile_id: uuid.UUID,
    account: Annotated[ServiceAccount, Depends(require_active_account)],
    service: Annotated[ProfileService, Depends(ProfileService)],
) -> ApiResponse[dict[str, bool]]:
    await service.delete_profile(account, profile_id)
    return ApiResponse(data={"ok": True}, message="프로필을 삭제했습니다.")


@profile_router.post(
    "/sync",
    response_model=ApiResponse[ProfileListData],
    responses=error_responses(*_AUTH_ERRORS, ErrorCode.HOUSEHOLD_NOT_FOUND, ErrorCode.HOUSEHOLD_MEMBERSHIP_REQUIRED),
    summary="프로필 일괄 동기화 (IndexedDB -> PG)",
)
async def sync_profiles(
    req: ProfileSyncRequest,
    account: Annotated[ServiceAccount, Depends(require_active_account)],
    service: Annotated[ProfileService, Depends(ProfileService)],
) -> ApiResponse[ProfileListData]:
    data = await service.sync_profiles(account, req)
    return ApiResponse(data=data, message="프로필을 동기화했습니다.")
