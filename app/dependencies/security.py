import uuid
from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.models.service_accounts import ServiceAccount
from app.repositories.service_account_repository import ServiceAccountRepository
from app.services.auth import get_account_repository
from app.services.jwt import JwtService

security = HTTPBearer()


async def get_request_user(
    credential: Annotated[HTTPAuthorizationCredentials, Depends(security)],
    account_repo: Annotated[ServiceAccountRepository, Depends(get_account_repository)],
) -> ServiceAccount:
    verified = JwtService().verify_jwt(token=credential.credentials, token_type="access")

    try:
        # 방어적으로 파싱한다. 그대로 넘기면 asyncpg 드라이버 오류가 되어
        # 401이어야 할 것이 500으로 나간다.
        account_id = uuid.UUID(str(verified.payload["user_id"]))
    except (KeyError, TypeError, ValueError) as err:
        raise HTTPException(detail="Authenticate Failed.", status_code=status.HTTP_401_UNAUTHORIZED) from err

    account = await account_repo.get_by_id(account_id)
    if not account:
        raise HTTPException(detail="Authenticate Failed.", status_code=status.HTTP_401_UNAUTHORIZED)
    return account
