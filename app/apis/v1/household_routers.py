import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, status
from fastapi.responses import Response

from app.core.errors import ErrorCode
from app.dependencies.concurrency import (
    IdempotencyKeyHeader,
    IfMatchHeader,
    check_idempotency,
    parse_if_match,
    remember_idempotent,
)
from app.dependencies.security import require_active_account
from app.dependencies.services import get_idempotency_store
from app.dtos.envelope import ApiResponse, error_responses
from app.dtos.households import (
    HouseholdData,
    HouseholdListData,
    HouseholdMembershipData,
    HouseholdMembershipListData,
    TransferMasterRequest,
)
from app.models.service_accounts import ServiceAccount
from app.services.households import HouseholdService
from app.services.idempotency import IdempotencyStore

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
    responses=error_responses(*_AUTH_ERRORS, ErrorCode.IDEMPOTENCY_KEY_REUSED),
    summary="가정 생성",
)
async def create_household(
    account: Annotated[ServiceAccount, Depends(require_active_account)],
    service: Annotated[HouseholdService, Depends(HouseholdService)],
    idem_store: Annotated[IdempotencyStore, Depends(get_idempotency_store)],
    idempotency_key: IdempotencyKeyHeader = None,
) -> ApiResponse[HouseholdData] | Response:
    payload: dict = {}
    cached = await check_idempotency(idem_store, account.id, "household.create", idempotency_key, payload)
    if cached is not None:
        return cached
    response = ApiResponse(data=await service.create(account), message="가정을 생성했습니다.")
    await remember_idempotent(
        idem_store,
        account.id,
        "household.create",
        idempotency_key,
        payload,
        status_code=status.HTTP_201_CREATED,
        body=response.model_dump(mode="json"),
    )
    return response


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
    "/{household_id}/transfer-master",
    response_model=ApiResponse[HouseholdData],
    responses=error_responses(
        *_AUTH_ERRORS,
        ErrorCode.HOUSEHOLD_NOT_FOUND,
        ErrorCode.HOUSEHOLD_STATE_CONFLICT,
    ),
    summary="가정 마스터 권한 위임",
)
async def transfer_household_master(
    household_id: uuid.UUID,
    payload: TransferMasterRequest,
    account: Annotated[ServiceAccount, Depends(require_active_account)],
    service: Annotated[HouseholdService, Depends(HouseholdService)],
) -> ApiResponse[HouseholdData]:
    data = await service.transfer_master(household_id, account, payload.target_account_id)
    return ApiResponse(data=data, message="가정 마스터 권한을 위임했습니다.")


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
    # **명시적으로 `None`이어야 한다.** 반환 타입에 `Response`가 섞여 있으면 FastAPI가
    # 그로부터 응답 스키마를 추론하려다 "204는 본문을 가질 수 없다"는 조립 시점
    # 단언에 걸린다. 재생 경로가 `Response`를 직접 돌려주므로 스키마 추론 자체를 끈다.
    response_model=None,
    status_code=status.HTTP_204_NO_CONTENT,
    responses=error_responses(
        *_AUTH_ERRORS,
        ErrorCode.HOUSEHOLD_NOT_FOUND,
        ErrorCode.HOUSEHOLD_MEMBERSHIP_REQUIRED,
        ErrorCode.HOUSEHOLD_STATE_CONFLICT,
        ErrorCode.ACTIVE_MEMBERS_REMAIN,
        ErrorCode.IDEMPOTENCY_KEY_REUSED,
        ErrorCode.VERSION_MISMATCH,
    ),
    summary="가정 폐쇄",
)
async def close_household(
    household_id: uuid.UUID,
    account: Annotated[ServiceAccount, Depends(require_active_account)],
    service: Annotated[HouseholdService, Depends(HouseholdService)],
    idem_store: Annotated[IdempotencyStore, Depends(get_idempotency_store)],
    idempotency_key: IdempotencyKeyHeader = None,
    if_match: IfMatchHeader = None,
) -> Response | None:
    payload = {"household_id": str(household_id)}
    cached = await check_idempotency(idem_store, account.id, "household.close", idempotency_key, payload)
    if cached is not None:
        return cached
    await service.close(household_id, account, expected_version=parse_if_match(if_match))
    await remember_idempotent(
        idem_store,
        account.id,
        "household.close",
        idempotency_key,
        payload,
        status_code=status.HTTP_204_NO_CONTENT,
        body=None,
    )
    return None


@household_router.delete(
    "/{household_id}/memberships/{membership_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=error_responses(
        *_AUTH_ERRORS,
        ErrorCode.HOUSEHOLD_NOT_FOUND,
        ErrorCode.HOUSEHOLD_MEMBERSHIP_REQUIRED,
        ErrorCode.MEMBERSHIP_STATE_CONFLICT,
        ErrorCode.HOUSEHOLD_STATE_CONFLICT,
    ),
    summary="가정 구성원 이력 삭제",
)
async def delete_household_membership(
    household_id: uuid.UUID,
    membership_id: uuid.UUID,
    account: Annotated[ServiceAccount, Depends(require_active_account)],
    service: Annotated[HouseholdService, Depends(HouseholdService)],
) -> None:
    await service.delete_member_history(household_id, membership_id, account)
