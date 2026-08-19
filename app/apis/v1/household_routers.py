import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, status

from app.core.errors import ErrorCode
from app.dependencies.security import require_active_account
from app.dtos.envelope import ApiResponse, error_responses
from app.dtos.households import (
    HouseholdData,
    HouseholdListData,
    HouseholdMembershipData,
    HouseholdMembershipListData,
)
from app.models.service_accounts import ServiceAccount
from app.services.households import HouseholdService

household_router = APIRouter(prefix="/households", tags=["households"])

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


@household_router.post(
    "",
    response_model=ApiResponse[HouseholdData],
    status_code=status.HTTP_201_CREATED,
    responses=error_responses(*_AUTH_ERRORS),
    summary="가정 생성",
)
async def create_household(
    account: Annotated[ServiceAccount, Depends(require_active_account)],
    service: Annotated[HouseholdService, Depends(HouseholdService)],
) -> ApiResponse[HouseholdData]:
    return ApiResponse(data=await service.create(account), message="가정을 생성했습니다.")


@household_router.get(
    "",
    response_model=ApiResponse[HouseholdListData],
    responses=error_responses(*_AUTH_ERRORS),
    summary="내 가정 목록 조회",
)
async def list_households(
    account: Annotated[ServiceAccount, Depends(require_active_account)],
    service: Annotated[HouseholdService, Depends(HouseholdService)],
) -> ApiResponse[HouseholdListData]:
    return ApiResponse(data=await service.list_for_account(account), message="가정 목록을 조회했습니다.")


@household_router.get(
    "/{household_id}",
    response_model=ApiResponse[HouseholdData],
    responses=error_responses(*_AUTH_ERRORS, ErrorCode.HOUSEHOLD_NOT_FOUND),
    summary="내 가정 상세 조회",
)
async def get_household(
    household_id: uuid.UUID,
    account: Annotated[ServiceAccount, Depends(require_active_account)],
    service: Annotated[HouseholdService, Depends(HouseholdService)],
) -> ApiResponse[HouseholdData]:
    return ApiResponse(data=await service.get_for_account(household_id, account), message="가정을 조회했습니다.")


@household_router.get(
    "/{household_id}/memberships",
    response_model=ApiResponse[HouseholdMembershipListData],
    responses=error_responses(*_AUTH_ERRORS, ErrorCode.HOUSEHOLD_NOT_FOUND),
    summary="가정 멤버십 목록 조회",
)
async def list_household_memberships(
    household_id: uuid.UUID,
    account: Annotated[ServiceAccount, Depends(require_active_account)],
    service: Annotated[HouseholdService, Depends(HouseholdService)],
) -> ApiResponse[HouseholdMembershipListData]:
    return ApiResponse(data=await service.list_members(household_id, account), message="멤버십을 조회했습니다.")


@household_router.post(
    "/{household_id}/leave",
    response_model=ApiResponse[HouseholdMembershipData],
    responses=error_responses(
        *_AUTH_ERRORS,
        ErrorCode.HOUSEHOLD_NOT_FOUND,
        ErrorCode.HOUSEHOLD_MEMBERSHIP_REQUIRED,
        ErrorCode.MEMBERSHIP_STATE_CONFLICT,
    ),
    summary="가정 자진 탈퇴",
)
async def leave_household(
    household_id: uuid.UUID,
    account: Annotated[ServiceAccount, Depends(require_active_account)],
    service: Annotated[HouseholdService, Depends(HouseholdService)],
) -> ApiResponse[HouseholdMembershipData]:
    return ApiResponse(data=await service.leave(household_id, account), message="가정에서 탈퇴했습니다.")


@household_router.delete(
    "/{household_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=error_responses(
        *_AUTH_ERRORS,
        ErrorCode.HOUSEHOLD_NOT_FOUND,
        ErrorCode.HOUSEHOLD_MEMBERSHIP_REQUIRED,
        ErrorCode.HOUSEHOLD_STATE_CONFLICT,
        ErrorCode.ACTIVE_MEMBERS_REMAIN,
    ),
    summary="가정 폐쇄",
)
async def close_household(
    household_id: uuid.UUID,
    account: Annotated[ServiceAccount, Depends(require_active_account)],
    service: Annotated[HouseholdService, Depends(HouseholdService)],
) -> None:
    await service.close(household_id, account)
