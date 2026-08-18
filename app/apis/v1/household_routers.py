from typing import Annotated

from fastapi import APIRouter, Depends, status

from app.core.errors import ErrorCode
from app.dependencies.security import require_active_account
from app.dtos.envelope import ApiResponse, error_responses
from app.dtos.households import HouseholdData, HouseholdListData
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
