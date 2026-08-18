import re

from httpx import AsyncClient
from starlette import status


class TestJWTTokenRefreshAPI:
    async def test_token_refresh_success(self, client: AsyncClient) -> None:
        email = "refresh@example.com"
        await client.post("/api/v1/auth/signup", json={"email": email, "password": "Password123!"})
        login_response = await client.post("/api/v1/auth/login", json={"email": email, "password": "Password123!"})

        set_cookie = login_response.headers.get("set-cookie", "")
        match = re.search(r"refresh_token=([^;]+)", set_cookie)
        assert match is not None
        client.cookies["refresh_token"] = match.group(1)

        response = await client.get("/api/v1/auth/token/refresh")

        assert response.status_code == status.HTTP_200_OK
        assert "access_token" in response.json()

    async def test_token_refresh_missing_token(self, client: AsyncClient) -> None:
        response = await client.get("/api/v1/auth/token/refresh")

        assert response.status_code == status.HTTP_401_UNAUTHORIZED
        assert response.json()["detail"] == "Refresh token is missing."
