import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status

from app.core.errors import ErrorCode
from app.dependencies.security import require_active_account
from app.dtos.account_audits import AccountAuditEventListData, PinLockAlertData, PinLockAlertListData
from app.dtos.envelope import ApiResponse, error_responses
from app.models.service_accounts import ServiceAccount
from app.services.account_audits import AccountAuditService

account_audit_router = APIRouter(prefix="/households", tags=["account-audits"])

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


@account_audit_router.get(
    "/{household_id}/audit-events",
    response_model=ApiResponse[AccountAuditEventListData],
    responses=error_responses(*_AUTH_ERRORS, ErrorCode.HOUSEHOLD_NOT_FOUND, ErrorCode.HOUSEHOLD_MASTER_REQUIRED),
    summary="가구 권한 감사 이벤트 목록",
)
async def list_audit_events(
    household_id: uuid.UUID,
    account: Annotated[ServiceAccount, Depends(require_active_account)],
    service: Annotated[AccountAuditService, Depends(AccountAuditService)],
    event_type: Annotated[str | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
    occurred_before: Annotated[datetime | None, Query()] = None,
) -> ApiResponse[AccountAuditEventListData]:
    data = await service.list_events(
        household_id, account, event_type=event_type, limit=limit, occurred_before=occurred_before
    )
    return ApiResponse(data=data, message="감사 이벤트를 조회했습니다.")


@account_audit_router.get(
    "/{household_id}/pin-lock-alerts",
    response_model=ApiResponse[PinLockAlertListData],
    responses=error_responses(*_AUTH_ERRORS, ErrorCode.HOUSEHOLD_NOT_FOUND, ErrorCode.HOUSEHOLD_MASTER_REQUIRED),
    summary="구성원 PIN 잠금 알림",
)
async def list_pin_lock_alerts(
    household_id: uuid.UUID,
    account: Annotated[ServiceAccount, Depends(require_active_account)],
    service: Annotated[AccountAuditService, Depends(AccountAuditService)],
) -> ApiResponse[PinLockAlertListData]:
    data = await service.list_pin_lock_alerts(household_id, account)
    return ApiResponse(data=data, message="PIN 잠금 알림을 조회했습니다.")


@account_audit_router.post(
    "/{household_id}/pin-lock-alerts/{alert_id}/acknowledgements",
    response_model=ApiResponse[PinLockAlertData],
    status_code=status.HTTP_201_CREATED,
    responses=error_responses(
        *_AUTH_ERRORS,
        ErrorCode.HOUSEHOLD_NOT_FOUND,
        ErrorCode.HOUSEHOLD_MASTER_REQUIRED,
        ErrorCode.PROFILE_NOT_FOUND,
    ),
    summary="PIN 잠금 알림 확인",
)
async def acknowledge_pin_lock_alert(
    household_id: uuid.UUID,
    alert_id: uuid.UUID,
    response: Response,
    account: Annotated[ServiceAccount, Depends(require_active_account)],
    service: Annotated[AccountAuditService, Depends(AccountAuditService)],
) -> ApiResponse[PinLockAlertData]:
    data = await service.acknowledge_pin_lock(household_id, alert_id, account)
    response.headers["Location"] = f"/api/v1/households/{household_id}/pin-lock-alerts/{alert_id}/acknowledgements"
    return ApiResponse(data=data, message="PIN 잠금 알림을 확인했습니다.")
