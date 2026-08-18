import uuid
from typing import Any, Literal, overload

from app.core.jwt.exceptions import ExpiredTokenError, TokenError
from app.core.jwt.tokens import AccessToken, RefreshToken
from app.exceptions import TokenExpiredError, TokenInvalidError
from app.models.service_accounts import ServiceAccount


def account_id_from_payload(payload: dict[str, Any]) -> uuid.UUID:
    """`sub`를 UUID로 되돌린다.

    방어적으로 파싱해야 한다. 그대로 넘기면 asyncpg 드라이버 오류가 되어
    401이어야 할 것이 500으로 나간다.
    """
    try:
        return uuid.UUID(str(payload["sub"]))
    except (KeyError, TypeError, ValueError) as err:
        raise TokenInvalidError() from err


class JwtService:
    access_token_class = AccessToken
    refresh_token_class = RefreshToken

    def create_access_token(self, account: ServiceAccount) -> AccessToken:
        return self.access_token_class.for_account(account)

    def create_refresh_token(self, account: ServiceAccount) -> RefreshToken:
        return self.refresh_token_class.for_account(account)

    @overload
    def verify_jwt(self, token: str, token_type: Literal["access"]) -> AccessToken: ...

    @overload
    def verify_jwt(self, token: str, token_type: Literal["refresh"]) -> RefreshToken: ...

    def verify_jwt(self, token: str, token_type: Literal["access", "refresh"]) -> AccessToken | RefreshToken:
        token_class: type[AccessToken | RefreshToken]
        if token_type == "access":
            token_class = self.access_token_class
        else:
            token_class = self.refresh_token_class

        try:
            # 생성자가 type 클레임까지 검증한다. 예전에는 검사가 없어서
            # access token을 refresh 자리에 넘기면 그대로 통과했다.
            return token_class(token=token)
        except ExpiredTokenError as err:
            raise TokenExpiredError() from err
        except TokenError as err:
            # 예전에는 400이었다. 유효하지 않은 자격증명은 401이 맞다.
            raise TokenInvalidError() from err

    def issue_pair(self, account: ServiceAccount) -> tuple[AccessToken, RefreshToken]:
        refresh = self.create_refresh_token(account)
        return refresh.access_token, refresh
