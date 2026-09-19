import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Response, status

from app.core.errors import ErrorCode
from app.dependencies.household_devices import require_active_household_device
from app.dependencies.security import require_active_account
from app.dtos.envelope import ApiResponse, error_responses
from app.dtos.member_pins import (
    MemberPinIssueData,
    MemberPinReplacementRequest,
    MemberSessionCreateRequest,
    MemberSessionData,
    WallMemberPinReplacementRequest,
    WallMemberSessionCreateRequest,
)
from app.models.household_devices import HouseholdDevice
from app.models.service_accounts import ServiceAccount
from app.services.member_pins import MemberPinService

member_pin_router = APIRouter(tags=["member-pins"])

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


@member_pin_router.post(
    "/profiles/{profile_id}/pin-credentials",
    response_model=ApiResponse[MemberPinIssueData],
    status_code=status.HTTP_201_CREATED,
    responses=error_responses(
        *_AUTH_ERRORS,
        ErrorCode.PROFILE_NOT_FOUND,
        ErrorCode.HOUSEHOLD_MASTER_REQUIRED,
    ),
    summary="구성원 임시 PIN 발급·재발급",
)
async def issue_pin_credential(
    profile_id: uuid.UUID,
    response: Response,
    account: Annotated[ServiceAccount, Depends(require_active_account)],
    service: Annotated[MemberPinService, Depends(MemberPinService)],
) -> ApiResponse[MemberPinIssueData]:
    data = await service.issue(account, profile_id)
    response.headers["Location"] = f"/api/v1/profiles/{profile_id}/pin-credentials"
    return ApiResponse(data=data, message="임시 PIN을 발급했습니다. 원문은 이번만 보입니다.")


@member_pin_router.delete(
    "/profiles/{profile_id}/pin-credentials",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=error_responses(
        *_AUTH_ERRORS,
        ErrorCode.PROFILE_NOT_FOUND,
        ErrorCode.HOUSEHOLD_MASTER_REQUIRED,
    ),
    summary="구성원 PIN 폐기",
)
async def discard_pin_credential(
    profile_id: uuid.UUID,
    account: Annotated[ServiceAccount, Depends(require_active_account)],
    service: Annotated[MemberPinService, Depends(MemberPinService)],
) -> None:
    await service.discard(account, profile_id)


@member_pin_router.post(
    "/profiles/{profile_id}/member-sessions",
    response_model=ApiResponse[MemberSessionData],
    status_code=status.HTTP_201_CREATED,
    responses=error_responses(
        *_AUTH_ERRORS,
        ErrorCode.PROFILE_NOT_FOUND,
        ErrorCode.PIN_INVALID,
        ErrorCode.PIN_LOCKED,
    ),
    summary="계정 가구 화면에서 구성원 PIN 세션 열기",
)
async def create_account_member_session(
    profile_id: uuid.UUID,
    req: MemberSessionCreateRequest,
    response: Response,
    account: Annotated[ServiceAccount, Depends(require_active_account)],
    service: Annotated[MemberPinService, Depends(MemberPinService)],
) -> ApiResponse[MemberSessionData]:
    data = await service.open_session(profile_id=profile_id, pin=req.pin, account=account)
    response.headers["Location"] = f"/api/v1/profiles/{profile_id}/member-sessions/{data.id}"
    return ApiResponse(data=data, message="구성원 세션을 열었습니다. 토큰은 이번만 보입니다.")


@member_pin_router.post(
    "/profiles/{profile_id}/pin-replacements",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=error_responses(
        *_AUTH_ERRORS,
        ErrorCode.PROFILE_NOT_FOUND,
        ErrorCode.PIN_INVALID,
        ErrorCode.PIN_LOCKED,
        ErrorCode.PIN_WEAK,
    ),
    summary="구성원 PIN 본인 변경",
)
async def replace_account_member_pin(
    profile_id: uuid.UUID,
    req: MemberPinReplacementRequest,
    account: Annotated[ServiceAccount, Depends(require_active_account)],
    service: Annotated[MemberPinService, Depends(MemberPinService)],
) -> None:
    await service.replace_pin(
        profile_id=profile_id,
        current_pin=req.current_pin,
        new_pin=req.new_pin,
        account=account,
    )


@member_pin_router.post(
    "/household-devices/me/member-sessions",
    response_model=ApiResponse[MemberSessionData],
    status_code=status.HTTP_201_CREATED,
    responses=error_responses(
        ErrorCode.AUTH_REQUIRED,
        ErrorCode.DEVICE_REVOKED,
        ErrorCode.PROFILE_NOT_FOUND,
        ErrorCode.PIN_INVALID,
        ErrorCode.PIN_LOCKED,
    ),
    summary="등록된 벽 기기에서 구성원 PIN 세션 열기",
)
async def create_wall_member_session(
    req: WallMemberSessionCreateRequest,
    response: Response,
    device: Annotated[HouseholdDevice, Depends(require_active_household_device)],
    service: Annotated[MemberPinService, Depends(MemberPinService)],
) -> ApiResponse[MemberSessionData]:
    data = await service.open_session(profile_id=req.profile_id, pin=req.pin, device=device)
    response.headers["Location"] = f"/api/v1/household-devices/me/member-sessions/{data.id}"
    return ApiResponse(data=data, message="구성원 세션을 열었습니다. 토큰은 이번만 보입니다.")


@member_pin_router.post(
    "/household-devices/me/pin-replacements",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=error_responses(
        ErrorCode.AUTH_REQUIRED,
        ErrorCode.DEVICE_REVOKED,
        ErrorCode.PROFILE_NOT_FOUND,
        ErrorCode.PIN_INVALID,
        ErrorCode.PIN_LOCKED,
        ErrorCode.PIN_WEAK,
    ),
    summary="벽 기기에서 구성원 PIN 본인 변경",
)
async def replace_wall_member_pin(
    req: WallMemberPinReplacementRequest,
    device: Annotated[HouseholdDevice, Depends(require_active_household_device)],
    service: Annotated[MemberPinService, Depends(MemberPinService)],
) -> None:
    await service.replace_pin(
        profile_id=req.profile_id,
        current_pin=req.current_pin,
        new_pin=req.new_pin,
        device=device,
    )
