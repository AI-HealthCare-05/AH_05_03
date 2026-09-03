import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status

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
        ErrorCode.PROFILE_REF_INVALID,
        ErrorCode.HOUSEHOLD_MEMBERSHIP_REQUIRED,
        ErrorCode.INVITATION_NOT_FOUND,
        ErrorCode.INVITATION_STATE_CONFLICT,
        ErrorCode.PROFILE_ALREADY_LINKED,
        ErrorCode.PROFILE_REF_ALREADY_CLAIMED,
    ),
    summary="수락한 초대와 기존 로컬 프로필 참조값 연결",
)
async def create_profile_link(
    request: ProfileLinkCreateRequest,
    account: Annotated[ServiceAccount, Depends(require_active_account)],
    service: Annotated[ProfileLinkService, Depends(ProfileLinkService)],
) -> ApiResponse[ProfileLinkData]:
    return ApiResponse(
        data=await service.create(account, request),
        # 연결 성공이 건강정보 전송을 뜻하지 않는다는 사실을 응답에서 밝힌다
        # (docs/03_api_spec.md 6절).
        message="프로필을 연결했습니다. 건강정보는 아직 전송되지 않습니다.",
    )


@profile_link_router.get(
    "/me",
    response_model=ApiResponse[ProfileLinkListData],
    responses=error_responses(*_AUTH_ERRORS),
    summary="현재 계정의 프로필 연결 상태 조회",
)
async def list_my_profile_links(
    account: Annotated[ServiceAccount, Depends(require_active_account)],
    service: Annotated[ProfileLinkService, Depends(ProfileLinkService)],
    household_id: Annotated[uuid.UUID | None, Query()] = None,
) -> ApiResponse[ProfileLinkListData]:
    return ApiResponse(
        data=await service.list_for_account(account, household_id),
        message="프로필 연결 상태를 조회했습니다.",
    )


@profile_link_router.delete(
    "/{profile_link_id}",
    response_model=ApiResponse[ProfileLinkData],
    responses=error_responses(*_AUTH_ERRORS, ErrorCode.PROFILE_LINK_NOT_FOUND),
    summary="계정·프로필 연결 해제(로컬 데이터 미삭제)",
)
async def unlink_profile(
    profile_link_id: uuid.UUID,
    account: Annotated[ServiceAccount, Depends(require_active_account)],
    service: Annotated[ProfileLinkService, Depends(ProfileLinkService)],
) -> ApiResponse[ProfileLinkData]:
    return ApiResponse(
        # DELETE인데 204가 아닌 이유는 DELETE /account와 같다. 봉투(§2)가 모든
        # 응답에 필수인데 204는 본문을 가질 수 없다.
        data=await service.unlink(profile_link_id, account),
        message="프로필 연결을 해제했습니다. 기기에 저장된 건강정보는 삭제되지 않습니다.",
    )
