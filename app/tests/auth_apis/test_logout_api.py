from httpx import AsyncClient
from starlette import status

from app.core import config


async def _login(client: AsyncClient, email: str) -> tuple[dict, str]:
    await client.post("/api/v1/auth/signup", json={"email": email, "password": "Password123!"})
    response = await client.post("/api/v1/auth/login", json={"email": email, "password": "Password123!"})
    refresh_token = response.cookies.get(config.REFRESH_COOKIE_NAME)
    assert refresh_token
    return dict(response.json()["data"]), refresh_token


class TestLogoutAPI:
    async def test_logout_success(self, client: AsyncClient) -> None:
        tokens, _ = await _login(client, "logout@example.com")

        response = await client.post(
            "/api/v1/auth/logout", headers={"Authorization": f"Bearer {tokens['access_token']}"}
        )

        assert response.status_code == status.HTTP_200_OK
        assert response.json()["data"] is None
        assert f'{config.REFRESH_COOKIE_NAME}=""' in response.headers["set-cookie"]
        assert "Max-Age=0" in response.headers["set-cookie"]

    async def test_access_token_revoked_after_logout(self, client: AsyncClient) -> None:
        tokens, _ = await _login(client, "revoke_access@example.com")
        await client.post("/api/v1/auth/logout", headers={"Authorization": f"Bearer {tokens['access_token']}"})

        response = await client.post(
            "/api/v1/auth/logout", headers={"Authorization": f"Bearer {tokens['access_token']}"}
        )

        assert response.status_code == status.HTTP_401_UNAUTHORIZED
        assert response.json()["error_code"] == "TOKEN_REVOKED"

    async def test_paired_refresh_token_revoked_after_logout(self, client: AsyncClient) -> None:
        """sid 클레임으로 access만 갖고도 짝이 되는 refresh를 무효화한다."""
        tokens, refresh_token = await _login(client, "revoke_refresh@example.com")
        await client.post("/api/v1/auth/logout", headers={"Authorization": f"Bearer {tokens['access_token']}"})

        response = await client.post(
            "/api/v1/auth/refresh",
            headers={"Cookie": f"{config.REFRESH_COOKIE_NAME}={refresh_token}"},
        )

        assert response.status_code == status.HTTP_401_UNAUTHORIZED

    async def test_logout_without_token_requires_auth(self, client: AsyncClient) -> None:
        response = await client.post("/api/v1/auth/logout")

        assert response.status_code == status.HTTP_401_UNAUTHORIZED
        assert response.json()["error_code"] == "AUTH_REQUIRED"
        assert response.headers.get("www-authenticate") == "Bearer"

    async def test_logout_with_malformed_auth_header(self, client: AsyncClient) -> None:
        response = await client.post("/api/v1/auth/logout", headers={"Authorization": "Basic xxx"})

        assert response.status_code == status.HTTP_401_UNAUTHORIZED
