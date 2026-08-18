from httpx import AsyncClient
from starlette import status

from app.core import config


async def _login(client: AsyncClient, email: str) -> tuple[dict, str]:
    await client.post("/api/v1/auth/signup", json={"email": email, "password": "Password123!"})
    response = await client.post("/api/v1/auth/login", json={"email": email, "password": "Password123!"})
    refresh_token = response.cookies.get(config.REFRESH_COOKIE_NAME)
    assert refresh_token
    return dict(response.json()["data"]), refresh_token


def _refresh_cookie(token: str) -> dict[str, str]:
    return {"Cookie": f"{config.REFRESH_COOKIE_NAME}={token}"}


class TestRefreshAPI:
    async def test_refresh_rotates_both_tokens(self, client: AsyncClient) -> None:
        tokens, old_refresh = await _login(client, "refresh@example.com")

        response = await client.post("/api/v1/auth/refresh")

        assert response.status_code == status.HTTP_200_OK
        new_tokens = response.json()["data"]
        assert new_tokens["access_token"] != tokens["access_token"]
        assert "refresh_token" not in new_tokens
        assert response.cookies.get(config.REFRESH_COOKIE_NAME) != old_refresh

    async def test_new_access_token_works(self, client: AsyncClient) -> None:
        _, _ = await _login(client, "refresh_works@example.com")
        refreshed = await client.post("/api/v1/auth/refresh")
        new_access = refreshed.json()["data"]["access_token"]

        response = await client.post("/api/v1/auth/logout", headers={"Authorization": f"Bearer {new_access}"})

        assert response.status_code == status.HTTP_200_OK

    async def test_reused_refresh_token_kills_the_whole_family(self, client: AsyncClient) -> None:
        _, old_refresh_token = await _login(client, "reuse@example.com")
        first = await client.post("/api/v1/auth/refresh")
        new_refresh_token = first.cookies.get(config.REFRESH_COOKIE_NAME)
        assert new_refresh_token

        # 이미 회전에 쓴 토큰을 다시 제출한다
        replay = await client.post("/api/v1/auth/refresh", headers=_refresh_cookie(old_refresh_token))
        assert replay.status_code == status.HTTP_401_UNAUTHORIZED
        assert replay.json()["error_code"] == "TOKEN_REUSE_DETECTED"

        # 정상적으로 회전해서 나온 새 토큰도 패밀리째 죽어 있어야 한다.
        # revoke_all_refresh가 지운 jti마다 used 마커를 남기므로, 이 토큰의
        # 재사용도 REVOKED가 아니라 REUSE_DETECTED로 잡힌다 — 대량 무효화
        # 이후의 재사용을 "단순 만료"가 아니라 "탈취 정황"으로 구분하기 위함.
        second = await client.post("/api/v1/auth/refresh", headers=_refresh_cookie(new_refresh_token))
        assert second.status_code == status.HTTP_401_UNAUTHORIZED
        assert second.json()["error_code"] == "TOKEN_REUSE_DETECTED"

    async def test_access_token_rejected_as_refresh(self, client: AsyncClient) -> None:
        """access token을 refresh 자리에 넣으면 세션을 무한 연장할 수 있던 취약점."""
        tokens, _ = await _login(client, "wrongtype@example.com")

        response = await client.post("/api/v1/auth/refresh", headers=_refresh_cookie(tokens["access_token"]))

        assert response.status_code == status.HTTP_401_UNAUTHORIZED
        assert response.json()["error_code"] == "TOKEN_INVALID"

    async def test_garbage_token_rejected(self, client: AsyncClient) -> None:
        response = await client.post("/api/v1/auth/refresh", headers=_refresh_cookie("not-a-jwt"))

        assert response.status_code == status.HTTP_401_UNAUTHORIZED
        assert response.json()["error_code"] == "TOKEN_INVALID"

    async def test_request_body_cannot_supply_refresh_token(self, client: AsyncClient) -> None:
        response = await client.post("/api/v1/auth/refresh", json={"refresh_token": "not-accepted"})

        assert response.status_code == status.HTTP_401_UNAUTHORIZED
        assert response.json()["error_code"] == "TOKEN_INVALID"

    async def test_unregistered_refresh_token_is_revoked(self, client: AsyncClient) -> None:
        """등록된 적 없는(allowlist에 없는) jti는 서명이 유효해도 거부된다."""
        import time

        import jwt as pyjwt

        payload = {
            "type": "refresh",
            "sub": "11111111-1111-1111-1111-111111111111",
            "sid": "forged",
            "jti": "forged",
            "iat": int(time.time()),
            "exp": int(time.time()) + 3600,
        }
        forged = pyjwt.encode(payload, config.SECRET_KEY, algorithm=config.JWT_ALGORITHM)

        response = await client.post("/api/v1/auth/refresh", headers=_refresh_cookie(forged))

        assert response.status_code == status.HTTP_401_UNAUTHORIZED
        assert response.json()["error_code"] == "TOKEN_REVOKED"
