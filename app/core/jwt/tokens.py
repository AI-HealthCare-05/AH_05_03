import sys
from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING, Any
from uuid import uuid4

if sys.version_info >= (3, 11):
    from typing import Self
else:
    from typing_extensions import Self

from app.core import config
from app.core.jwt.exceptions import ExpiredTokenError, TokenBackendError, TokenBackendExpiredError, TokenError
from app.core.jwt.state import token_backend
from app.models.service_accounts import ServiceAccount

if TYPE_CHECKING:
    from app.core.jwt.backends import TokenBackend


class Token:
    token_type: str | None = None
    lifetime: timedelta | None = None
    _token_backend: "TokenBackend" = token_backend

    def __init__(self, token: str | None = None, verify: bool = True) -> None:
        if not self.token_type:
            raise TokenError("token_type must be set")
        if not self.lifetime:
            raise TokenError("lifetime must be set")

        self.token = token
        # 토큰 시간 계산은 KST에 의존할 이유가 없다. KST는 표시용이다.
        self.current_time = datetime.now(tz=timezone.utc)
        self.payload: dict[str, Any] = {}

        if token is not None:
            try:
                self.payload = token_backend.decode(token, verify=verify)
            except TokenBackendExpiredError as err:
                raise ExpiredTokenError("Token is expired") from err
            except TokenBackendError as err:
                raise TokenError("Token is invalid") from err
            # verify_jwt가 아니라 여기서 검사한다. 모든 생성 경로가 덮인다.
            self.verify_token_type()
        else:
            self.payload = {"type": self.token_type}
            self.set_exp(from_time=self.current_time, lifetime=self.lifetime)
            self.set_iat(from_time=self.current_time)
            self.set_jti()

    def __repr__(self) -> str:
        return repr(self.payload)

    def __getitem__(self, key: str):
        return self.payload[key]

    def __setitem__(self, key: str, value: Any) -> None:
        self.payload[key] = value

    def __delitem__(self, key: str) -> None:
        del self.payload[key]

    def __contains__(self, key: str) -> Any:
        return key in self.payload

    def __str__(self) -> str:
        """
        Signs and returns a token as a base64 encoded string.
        """
        return self._token_backend.encode(self.payload)

    def set_exp(self, from_time: datetime | None = None, lifetime: timedelta | None = None) -> None:
        if from_time is None:
            from_time = self.current_time

        if lifetime is None:
            lifetime = self.lifetime

        assert lifetime is not None

        # timegm(dt.timetuple())은 tzinfo를 버려 KST 벽시계를 UTC로 해석했고,
        # 모든 토큰 만료에 정확히 32400초를 더하고 있었다.
        self.payload["exp"] = int((from_time + lifetime).timestamp())

    def set_iat(self, from_time: datetime | None = None) -> None:
        self.payload["iat"] = int((from_time or self.current_time).timestamp())

    def set_jti(self) -> None:
        self.payload["jti"] = uuid4().hex

    def verify_token_type(self) -> None:
        if self.payload.get("type") != self.token_type:
            raise TokenError("Token has wrong type")

    @classmethod
    def for_account(cls, account: ServiceAccount) -> Self:
        token = cls()
        # UUID를 그대로 넣으면 PyJWT의 json.dumps가 TypeError를 낸다.
        # 클레임 이름은 등록된 표준인 sub를 쓴다 (예전 user_id).
        token["sub"] = str(account.id)
        if token.token_type == "refresh":
            # 세션 식별자. access token이 이 값을 물려받아,
            # logout이 access만으로 짝이 되는 refresh를 무효화할 수 있다.
            token["sid"] = token["jti"]
        return token


class AccessToken(Token):
    token_type = "access"
    lifetime = timedelta(minutes=config.ACCESS_TOKEN_EXPIRE_MINUTES)


class RefreshToken(Token):
    token_type = "refresh"
    # 설정값 단위는 '분'이다. days로 넘기면 20160일(약 55년)이 된다.
    lifetime = timedelta(minutes=config.REFRESH_TOKEN_EXPIRE_MINUTES)
    no_copy_claims = ("type", "exp", "iat", "jti")

    @property
    def access_token(self) -> AccessToken:
        access = AccessToken()
        access.set_exp(from_time=self.current_time)
        access.set_iat(from_time=self.current_time)

        no_copy = self.no_copy_claims
        for claim, value in self.payload.items():
            if claim in no_copy:
                continue
            access[claim] = value

        return access
