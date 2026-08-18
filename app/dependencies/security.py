from typing import Annotated, Any

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.dependencies.services import get_token_store
from app.exceptions import (
    AccountClosedError,
    AccountNotFoundError,
    AccountSuspendedError,
    AuthRequiredError,
)
from app.models.service_accounts import ServiceAccount, ServiceAccountStatus
from app.repositories.service_account_repository import ServiceAccountRepository
from app.services.auth import get_account_repository
from app.services.jwt import JwtService, account_id_from_payload
from app.services.token_store import TokenStore

# auto_error=False로 둔다. FastAPI가 기본으로 내리는 401 {"detail": "..."}
# 대신 우리 봉투로 통일해서 내려야 하므로, 여기서 직접 AuthRequiredError를 던진다.
security = HTTPBearer(auto_error=False)


async def get_access_token_payload(
    credential: Annotated[HTTPAuthorizationCredentials | None, Depends(security)],
    token_store: Annotated[TokenStore, Depends(get_token_store)],
) -> dict[str, Any]:
    if credential is None:
        raise AuthRequiredError()

    payload = JwtService().verify_jwt(token=credential.credentials, token_type="access").payload
    # denylist 조회. logout이 여기 jti를 등록해 즉시 무효화한다.
    await token_store.assert_access_active(str(payload["jti"]))
    return payload


async def get_current_account(
    payload: Annotated[dict[str, Any], Depends(get_access_token_payload)],
    account_repo: Annotated[ServiceAccountRepository, Depends(get_account_repository)],
) -> ServiceAccount:
    account_id = account_id_from_payload(payload)
    account = await account_repo.get_by_id(account_id)
    if not account:
        raise AccountNotFoundError()
    return account


async def require_active_account(
    account: Annotated[ServiceAccount, Depends(get_current_account)],
) -> ServiceAccount:
    """업무용 라우트가 쓴다. logout·계정 해지처럼 상태 무관하게 동작해야
    하는 라우트는 get_current_account를 직접 쓴다."""
    if account.status is ServiceAccountStatus.SUSPENDED:
        raise AccountSuspendedError()
    if account.status is ServiceAccountStatus.CLOSED:
        raise AccountClosedError()
    return account
