from typing import Annotated

from fastapi import APIRouter, Depends

from app.core.errors import ErrorCode
from app.dependencies.security import get_current_account, require_active_account
from app.dtos.accounts import AccountCloseData, AccountSummaryData
from app.dtos.envelope import ApiResponse, error_responses
from app.models.service_accounts import ServiceAccount
from app.services.accounts import AccountService

# prefix 없이 등록한다. URL이 문서 표기(/account)와 그대로 grep 가능하도록.
account_router = APIRouter(tags=["account"])

_AUTH_ERRORS = (
    ErrorCode.AUTH_REQUIRED,
    ErrorCode.TOKEN_INVALID,
    ErrorCode.TOKEN_EXPIRED,
    ErrorCode.TOKEN_REVOKED,
    ErrorCode.ACCOUNT_NOT_FOUND,
    ErrorCode.SERVICE_UNAVAILABLE,
)


@account_router.get(
    "/account",
    response_model=ApiResponse[AccountSummaryData],
    responses=error_responses(*_AUTH_ERRORS, ErrorCode.ACCOUNT_SUSPENDED, ErrorCode.ACCOUNT_CLOSED),
    summary="계정·구독 요약",
)
async def get_account_summary(
    account: Annotated[ServiceAccount, Depends(require_active_account)],
    account_service: Annotated[AccountService, Depends(AccountService)],
) -> ApiResponse[AccountSummaryData]:
    return ApiResponse(data=await account_service.get_summary(account), message="계정 정보를 조회했습니다.")


@account_router.delete(
    "/account",
    response_model=ApiResponse[AccountCloseData],
    responses=error_responses(*_AUTH_ERRORS),
    summary="서비스 계정 해지(로컬 데이터 미삭제)",
)
async def close_account(
    # 상태 무관 의존성이다. 이미 closed인 계정도 다시 호출할 수 있어야
    # 멱등성이 성립한다 (require_active_account였다면 두 번째 호출이 403이 된다).
    account: Annotated[ServiceAccount, Depends(get_current_account)],
    account_service: Annotated[AccountService, Depends(AccountService)],
) -> ApiResponse[AccountCloseData]:
    return ApiResponse(
        data=await account_service.close(account),
        message="서비스 계정이 해지되었습니다. 기기에 저장된 건강정보는 삭제되지 않습니다.",
        # DELETE인데 200 + 본문인 이유: 봉투(§2)가 모든 응답에 필수이고
        # 204는 본문을 가질 수 없다. docs/03_api_spec.md §2에 반영 필요.
    )
