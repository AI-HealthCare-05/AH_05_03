import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.core import config
from app.core.jwt.exceptions import TokenError
from app.core.jwt.tokens import AccessToken, RefreshToken
from app.exceptions import TokenInvalidError
from app.models.service_accounts import ServiceAccount
from app.services.jwt import JwtService, account_id_from_payload


def _account() -> ServiceAccount:
    account = ServiceAccount(email="token@example.com", password_hash="x")
    account.id = uuid.uuid4()
    return account


class TestTokenLifetimes:
    def test_refresh_lifetime_is_fourteen_days(self) -> None:
        """설정값 단위는 '분'인데 days로 넘어가 약 55년이던 버그."""
        assert RefreshToken.lifetime == timedelta(days=14)

    def test_access_lifetime_matches_config(self) -> None:
        assert AccessToken.lifetime == timedelta(minutes=config.ACCESS_TOKEN_EXPIRE_MINUTES)

    def test_exp_minus_iat_equals_lifetime(self) -> None:
        access = AccessToken.for_account(_account())
        refresh = RefreshToken.for_account(_account())

        assert access["exp"] - access["iat"] == config.ACCESS_TOKEN_EXPIRE_MINUTES * 60
        assert refresh["exp"] - refresh["iat"] == 14 * 24 * 3600


class TestTokenExpiryTimezone:
    def test_exp_has_no_nine_hour_skew(self) -> None:
        """timegm(dt.timetuple())이 KST를 UTC로 오해해 +32400초를 더하던 버그."""
        now = int(datetime.now(tz=timezone.utc).timestamp())

        token = AccessToken.for_account(_account())

        expected = now + config.ACCESS_TOKEN_EXPIRE_MINUTES * 60
        assert abs(token["exp"] - expected) <= 2, "exp에 시간대 오프셋이 섞였다"


class TestTokenTypeVerification:
    def test_access_token_rejected_as_refresh(self) -> None:
        """access token 하나로 세션을 무한 연장할 수 있던 취약점."""
        access_str = str(AccessToken.for_account(_account()))

        with pytest.raises(TokenError):
            RefreshToken(token=access_str)

    def test_verify_jwt_maps_wrong_type_to_401(self) -> None:
        access_str = str(AccessToken.for_account(_account()))

        with pytest.raises(TokenInvalidError):
            JwtService().verify_jwt(access_str, "refresh")

    def test_refresh_token_accepted_as_refresh(self) -> None:
        refresh_str = str(RefreshToken.for_account(_account()))

        assert JwtService().verify_jwt(refresh_str, "refresh")["type"] == "refresh"


class TestClaims:
    def test_sub_is_a_string_and_encodes(self) -> None:
        """UUID를 그대로 넣으면 PyJWT의 json.dumps가 TypeError를 낸다."""
        account = _account()

        token = AccessToken.for_account(account)

        assert isinstance(token["sub"], str)
        assert token["sub"] == str(account.id)
        assert str(token)  # 인코딩이 예외 없이 끝난다

    def test_refresh_carries_sid_equal_to_its_jti(self) -> None:
        refresh = RefreshToken.for_account(_account())

        assert refresh["sid"] == refresh["jti"]

    def test_derived_access_inherits_sid_but_gets_fresh_jti(self) -> None:
        refresh = RefreshToken.for_account(_account())

        access = refresh.access_token

        assert access["sid"] == refresh["sid"]
        assert access["jti"] != refresh["jti"]
        assert access["type"] == "access"

    def test_account_id_from_payload_round_trips(self) -> None:
        account = _account()
        token = AccessToken.for_account(account)

        assert account_id_from_payload(token.payload) == account.id

    @pytest.mark.parametrize("payload", [{}, {"sub": "not-a-uuid"}, {"sub": None}])
    def test_malformed_sub_raises_token_invalid(self, payload: dict) -> None:
        """401이어야 할 것이 asyncpg 드라이버 오류로 500이 되면 안 된다."""
        with pytest.raises(TokenInvalidError):
            account_id_from_payload(payload)
