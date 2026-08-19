import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, status

from app.core.errors import ErrorCode
from app.dependencies.security import require_active_account
from app.dtos.envelope import ApiResponse, error_responses
from app.dtos.profile_links import ProfileLinkCreateRequest, ProfileLinkData, ProfileLinkListData
from app.models.service_accounts import ServiceAccount
from app.services.profile_links import ProfileLinkService

profile_link_router = APIRouter(prefix="/profile-links", tags=["profile links"])

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


@profile_link_router.post(
    "",
    response_model=ApiResponse[ProfileLinkData],
    status_code=status.HTTP_201_CREATED,
    responses=error_responses(
        *_AUTH_ERRORS,
        ErrorCode.INVITATION_NOT_FOUND,
        ErrorCode.HOUSEHOLD_MEMBERSHIP_REQUIRED,
        ErrorCode.PROFILE_REFERENCE_ALREADY_USED,
        ErrorCode.PROFILE_ALREADY_LINKED,
        ErrorCode.PROFILE_REF_ALREADY_CLAIMED,
        ErrorCode.PROFILE_LINK_INVITATION_MISMATCH,
    ),
    summary="수락한 초대와 기존 로컬 프로필 연결",
)
async def create_profile_link(
    request: ProfileLinkCreateRequest,
    account: Annotated[ServiceAccount, Depends(require_active_account)],
    service: Annotated[ProfileLinkService, Depends(ProfileLinkService)],
) -> ApiResponse[ProfileLinkData]:
    return ApiResponse(data=await service.create(account, request), message="프로필 연결을 생성했습니다.")


@profile_link_router.get(
    "",
    response_model=ApiResponse[ProfileLinkListData],
    responses=error_responses(*_AUTH_ERRORS),
    summary="내 프로필 연결 이력 조회",
)
async def list_profile_links(
    account: Annotated[ServiceAccount, Depends(require_active_account)],
    service: Annotated[ProfileLinkService, Depends(ProfileLinkService)],
) -> ApiResponse[ProfileLinkListData]:
    return ApiResponse(data=await service.list_for_account(account), message="프로필 연결을 조회했습니다.")


@profile_link_router.post(
    "/{link_id}/unlink",
    response_model=ApiResponse[ProfileLinkData],
    responses=error_responses(
        *_AUTH_ERRORS,
        ErrorCode.PROFILE_LINK_NOT_FOUND,
        ErrorCode.PROFILE_LINK_STATE_CONFLICT,
    ),
    summary="프로필 연결 해제",
)
async def unlink_profile_link(
    link_id: uuid.UUID,
    account: Annotated[ServiceAccount, Depends(require_active_account)],
    service: Annotated[ProfileLinkService, Depends(ProfileLinkService)],
) -> ApiResponse[ProfileLinkData]:
    return ApiResponse(data=await service.unlink(link_id, account), message="프로필 연결을 해제했습니다.")
