from typing import Annotated

from fastapi import APIRouter, Depends, status

from app.core.errors import ErrorCode
from app.dependencies.security import require_active_account
from app.dtos.envelope import ApiResponse, error_responses
from app.dtos.subscriptions import PlanChangeData, PlanChangeRequest, SubscriptionData
from app.models.service_accounts import ServiceAccount
from app.services.subscriptions import SubscriptionService

subscription_router = APIRouter(tags=["subscription"])

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


@subscription_router.get(
    "/subscription",
    response_model=ApiResponse[SubscriptionData],
    responses=error_responses(*_AUTH_ERRORS, ErrorCode.SUBSCRIPTION_NOT_FOUND),
    summary="구독·라이선스 상태 조회",
)
async def get_subscription(
    account: Annotated[ServiceAccount, Depends(require_active_account)],
    subscription_service: Annotated[SubscriptionService, Depends(SubscriptionService)],
) -> ApiResponse[SubscriptionData]:
    return ApiResponse(data=await subscription_service.get_for_account(account.id), message="구독 정보를 조회했습니다.")


@subscription_router.post(
    "/subscription/change",
    response_model=ApiResponse[PlanChangeData],
    status_code=status.HTTP_200_OK,
    responses=error_responses(
        *_AUTH_ERRORS,
        ErrorCode.SUBSCRIPTION_NOT_FOUND,
        ErrorCode.SUBSCRIPTION_INACTIVE,
        ErrorCode.PLAN_CHANGE_NOT_ALLOWED,
    ),
    summary="플랜 변경 요청",
    description="결제 연동은 범위 밖이다. 요청 즉시 상태를 반영한다.",
)
async def change_subscription(
    request: PlanChangeRequest,
    account: Annotated[ServiceAccount, Depends(require_active_account)],
    subscription_service: Annotated[SubscriptionService, Depends(SubscriptionService)],
) -> ApiResponse[PlanChangeData]:
    return ApiResponse(
        data=await subscription_service.request_plan_change(account.id, request),
        message="구독 플랜이 변경되었습니다.",
    )
