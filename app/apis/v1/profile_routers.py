import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status

from app.core.errors import ErrorCode
from app.dependencies.concurrency import IfMatchHeader, parse_if_match
from app.dependencies.security import require_active_account
from app.dtos.envelope import ApiResponse, error_responses
from app.dtos.profiles import (
    HouseholdUnshareRequest,
    ProfileCreateRequest,
    ProfileData,
    ProfileDeletionPreviewData,
    ProfileDeletionRequestData,
    ProfileListData,
    ProfilePurgeJobData,
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
    responses=error_responses(
        *_AUTH_ERRORS,
        ErrorCode.PROFILE_NOT_FOUND,
        ErrorCode.HOUSEHOLD_MEMBERSHIP_REQUIRED,
        ErrorCode.PROFILE_ACCESS_DENIED,
    ),
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
    responses=error_responses(
        *_AUTH_ERRORS,
        ErrorCode.PROFILE_NOT_FOUND,
        ErrorCode.HOUSEHOLD_MEMBERSHIP_REQUIRED,
        ErrorCode.PROFILE_ACCESS_DENIED,
        ErrorCode.VERSION_MISMATCH,
    ),
    summary="프로필 수정",
)
async def update_profile(
    profile_id: uuid.UUID,
    req: ProfileUpdateRequest,
    account: Annotated[ServiceAccount, Depends(require_active_account)],
    service: Annotated[ProfileService, Depends(ProfileService)],
    if_match: IfMatchHeader = None,
) -> ApiResponse[ProfileData]:
    data = await service.update_profile(account, profile_id, req, expected_version=parse_if_match(if_match))
    return ApiResponse(data=data, message="프로필을 수정했습니다.")


@profile_router.delete(
    "/{profile_id}",
    response_model=ApiResponse[dict[str, bool]],
    responses=error_responses(
        *_AUTH_ERRORS,
        ErrorCode.PROFILE_NOT_FOUND,
        ErrorCode.HOUSEHOLD_MEMBERSHIP_REQUIRED,
        ErrorCode.PROFILE_ACCESS_DENIED,
        ErrorCode.VERSION_MISMATCH,
    ),
    summary="프로필 삭제",
)
async def delete_profile(
    profile_id: uuid.UUID,
    account: Annotated[ServiceAccount, Depends(require_active_account)],
    service: Annotated[ProfileService, Depends(ProfileService)],
    if_match: IfMatchHeader = None,
) -> ApiResponse[dict[str, bool]]:
    await service.delete_profile(account, profile_id, expected_version=parse_if_match(if_match))
    return ApiResponse(data={"ok": True}, message="프로필을 삭제했습니다.")


@profile_router.post(
    "/{profile_id}/household-unshares",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=error_responses(
        *_AUTH_ERRORS,
        ErrorCode.PROFILE_NOT_FOUND,
        ErrorCode.HOUSEHOLD_MASTER_REQUIRED,
        ErrorCode.HOUSEHOLD_MEMBERSHIP_REQUIRED,
        ErrorCode.PROFILE_ACCESS_DENIED,
        ErrorCode.CREDENTIALS_INVALID,
        ErrorCode.VERSION_MISMATCH,
    ),
    summary="가족 공유에서 제외",
)
async def unshare_profile(
    profile_id: uuid.UUID,
    req: HouseholdUnshareRequest,
    account: Annotated[ServiceAccount, Depends(require_active_account)],
    service: Annotated[ProfileService, Depends(ProfileService)],
    if_match: IfMatchHeader = None,
) -> Response:
    await service.unshare_from_household(account, profile_id, req.password, expected_version=parse_if_match(if_match))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@profile_router.get(
    "/{profile_id}/deletion-preview",
    response_model=ApiResponse[ProfileDeletionPreviewData],
    responses=error_responses(
        *_AUTH_ERRORS,
        ErrorCode.PROFILE_NOT_FOUND,
        ErrorCode.HOUSEHOLD_MEMBERSHIP_REQUIRED,
        ErrorCode.PROFILE_ACCESS_DENIED,
    ),
    summary="프로필 삭제 영향 미리보기",
)
async def get_deletion_preview(
    profile_id: uuid.UUID,
    account: Annotated[ServiceAccount, Depends(require_active_account)],
    service: Annotated[ProfileService, Depends(ProfileService)],
) -> ApiResponse[ProfileDeletionPreviewData]:
    data = await service.deletion_preview(account, profile_id)
    return ApiResponse(data=data, message="삭제 영향을 조회했습니다.")


@profile_router.post(
    "/{profile_id}/archives",
    response_model=ApiResponse[ProfileData],
    status_code=status.HTTP_201_CREATED,
    responses=error_responses(
        *_AUTH_ERRORS,
        ErrorCode.PROFILE_NOT_FOUND,
        ErrorCode.HOUSEHOLD_MEMBERSHIP_REQUIRED,
        ErrorCode.PROFILE_ACCESS_DENIED,
        ErrorCode.VERSION_MISMATCH,
    ),
    summary="프로필 보관",
)
async def archive_profile(
    profile_id: uuid.UUID,
    response: Response,
    account: Annotated[ServiceAccount, Depends(require_active_account)],
    service: Annotated[ProfileService, Depends(ProfileService)],
    if_match: IfMatchHeader = None,
) -> ApiResponse[ProfileData]:
    data = await service.archive_profile(account, profile_id, expected_version=parse_if_match(if_match))
    response.headers["Location"] = f"/api/v1/profiles/{profile_id}"
    return ApiResponse(data=data, message="프로필을 보관했습니다.")


@profile_router.post(
    "/{profile_id}/restorations",
    response_model=ApiResponse[ProfileData],
    status_code=status.HTTP_201_CREATED,
    responses=error_responses(
        *_AUTH_ERRORS,
        ErrorCode.PROFILE_NOT_FOUND,
        ErrorCode.HOUSEHOLD_MEMBERSHIP_REQUIRED,
        ErrorCode.PROFILE_ACCESS_DENIED,
        ErrorCode.VERSION_MISMATCH,
    ),
    summary="숨김·보관·휴지통 프로필 복구",
)
async def restore_profile(
    profile_id: uuid.UUID,
    response: Response,
    account: Annotated[ServiceAccount, Depends(require_active_account)],
    service: Annotated[ProfileService, Depends(ProfileService)],
    if_match: IfMatchHeader = None,
) -> ApiResponse[ProfileData]:
    data = await service.restore_profile(account, profile_id, expected_version=parse_if_match(if_match))
    response.headers["Location"] = f"/api/v1/profiles/{profile_id}"
    return ApiResponse(data=data, message="프로필을 복구했습니다.")


@profile_router.post(
    "/{profile_id}/deletion-requests",
    response_model=ApiResponse[ProfileDeletionRequestData],
    responses=error_responses(
        *_AUTH_ERRORS,
        ErrorCode.PROFILE_NOT_FOUND,
        ErrorCode.HOUSEHOLD_MEMBERSHIP_REQUIRED,
        ErrorCode.PROFILE_ACCESS_DENIED,
        ErrorCode.VERSION_MISMATCH,
    ),
    summary="프로필 삭제 요청 또는 빈 슬롯 파기",
)
async def request_profile_deletion(
    profile_id: uuid.UUID,
    response: Response,
    account: Annotated[ServiceAccount, Depends(require_active_account)],
    service: Annotated[ProfileService, Depends(ProfileService)],
    if_match: IfMatchHeader = None,
) -> ApiResponse[ProfileDeletionRequestData] | Response:
    data = await service.request_deletion(account, profile_id, expected_version=parse_if_match(if_match))
    if data.purged:
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    response.status_code = status.HTTP_202_ACCEPTED
    response.headers["Location"] = f"/api/v1/profiles/{profile_id}"
    return ApiResponse(data=data, message="30일 휴지통에 넣었습니다. 유예 기간에 복구할 수 있습니다.")


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


profile_purge_router = APIRouter(tags=["profiles"])


@profile_purge_router.post(
    "/profile-purge-jobs",
    response_model=ApiResponse[ProfilePurgeJobData],
    status_code=status.HTTP_202_ACCEPTED,
    responses=error_responses(*_AUTH_ERRORS),
    summary="만료된 휴지통 프로필 멱등 파기",
)
async def create_profile_purge_job(
    account: Annotated[ServiceAccount, Depends(require_active_account)],
    service: Annotated[ProfileService, Depends(ProfileService)],
) -> ApiResponse[ProfilePurgeJobData]:
    data = await service.run_due_purges(account)
    return ApiResponse(data=data, message="만료된 휴지통 프로필을 파기했습니다.")
