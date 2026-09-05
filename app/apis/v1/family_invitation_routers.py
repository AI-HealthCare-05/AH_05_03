import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, status

from app.core.errors import ErrorCode
from app.dependencies.security import request_origin, require_active_account
from app.dtos.envelope import ApiResponse, error_responses
from app.dtos.family_invitations import (
    FamilyInvitationCreatedData,
    FamilyInvitationCreateRequest,
    FamilyInvitationData,
    FamilyInvitationListData,
    InvitationTokenRequest,
)
from app.models.service_accounts import ServiceAccount
from app.services.family_invitations import FamilyInvitationService

family_invitation_router = APIRouter(prefix="/family-invitations", tags=["family invitations"])

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
_INVITATION_ERRORS = (
    ErrorCode.INVITATION_NOT_FOUND,
    ErrorCode.INVITATION_EXPIRED,
    ErrorCode.INVITATION_STATE_CONFLICT,
    ErrorCode.INVITATION_TOKEN_INVALID,
    ErrorCode.INVITATION_TOKEN_REUSED,
)


@family_invitation_router.post(
    "",
    response_model=ApiResponse[FamilyInvitationCreatedData],
    status_code=status.HTTP_201_CREATED,
    responses=error_responses(
        *_AUTH_ERRORS,
        ErrorCode.HOUSEHOLD_NOT_FOUND,
        ErrorCode.HOUSEHOLD_MEMBERSHIP_REQUIRED,
        ErrorCode.INVITATION_ALREADY_PENDING,
        ErrorCode.PROFILE_REFERENCE_ALREADY_USED,
        ErrorCode.INVITATION_SELF_NOT_ALLOWED,
        ErrorCode.RATE_LIMITED,
    ),
    summary="기존 로컬 프로필에 연결할 가족 서비스 계정 초대",
)
async def create_family_invitation(
    request: FamilyInvitationCreateRequest,
    account: Annotated[ServiceAccount, Depends(require_active_account)],
    service: Annotated[FamilyInvitationService, Depends(FamilyInvitationService)],
    # 메일 링크의 앞부분. 여기서 잡아 두지 않으면 요청 문맥이 없는 메일 워커가
    # 설정 기본값(`localhost:5173`)으로 링크를 만들어 보낸다.
    web_origin: Annotated[str | None, Depends(request_origin)] = None,
) -> ApiResponse[FamilyInvitationCreatedData]:
    return ApiResponse(data=await service.create(account, request, web_origin), message="초대 전송을 예약했습니다.")


@family_invitation_router.get(
    "",
    response_model=ApiResponse[FamilyInvitationListData],
    responses=error_responses(*_AUTH_ERRORS),
    summary="보낸 초대와 받은 초대 조회",
)
async def list_family_invitations(
    account: Annotated[ServiceAccount, Depends(require_active_account)],
    service: Annotated[FamilyInvitationService, Depends(FamilyInvitationService)],
) -> ApiResponse[FamilyInvitationListData]:
    return ApiResponse(data=await service.list_for_account(account), message="초대 목록을 조회했습니다.")


@family_invitation_router.post(
    "/{invitation_id}/accept",
    response_model=ApiResponse[FamilyInvitationData],
    responses=error_responses(*_AUTH_ERRORS, *_INVITATION_ERRORS),
    summary="초대 수락 및 기존 로컬 프로필 연결 승인",
)
async def accept_family_invitation(
    invitation_id: uuid.UUID,
    request: InvitationTokenRequest,
    account: Annotated[ServiceAccount, Depends(require_active_account)],
    service: Annotated[FamilyInvitationService, Depends(FamilyInvitationService)],
) -> ApiResponse[FamilyInvitationData]:
    return ApiResponse(data=await service.accept(invitation_id, account, request), message="초대를 수락했습니다.")


@family_invitation_router.post(
    "/{invitation_id}/decline",
    response_model=ApiResponse[FamilyInvitationData],
    responses=error_responses(*_AUTH_ERRORS, *_INVITATION_ERRORS),
    summary="초대 거절",
)
async def decline_family_invitation(
    invitation_id: uuid.UUID,
    request: InvitationTokenRequest,
    account: Annotated[ServiceAccount, Depends(require_active_account)],
    service: Annotated[FamilyInvitationService, Depends(FamilyInvitationService)],
) -> ApiResponse[FamilyInvitationData]:
    return ApiResponse(data=await service.decline(invitation_id, account, request), message="초대를 거절했습니다.")


@family_invitation_router.post(
    "/{invitation_id}/cancel",
    response_model=ApiResponse[FamilyInvitationData],
    responses=error_responses(*_AUTH_ERRORS, *_INVITATION_ERRORS),
    summary="보낸 초대 취소",
)
async def cancel_family_invitation(
    invitation_id: uuid.UUID,
    account: Annotated[ServiceAccount, Depends(require_active_account)],
    service: Annotated[FamilyInvitationService, Depends(FamilyInvitationService)],
) -> ApiResponse[FamilyInvitationData]:
    return ApiResponse(data=await service.cancel(invitation_id, account), message="초대를 취소했습니다.")
