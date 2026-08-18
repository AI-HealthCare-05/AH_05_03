from httpx import AsyncClient
from starlette import status


class TestLoginAPI:
    async def test_login_success(self, client: AsyncClient) -> None:
        email = "login_test@example.com"
        await client.post("/api/v1/auth/signup", json={"email": email, "password": "Password123!"})

        response = await client.post("/api/v1/auth/login", json={"email": email, "password": "Password123!"})

        assert response.status_code == status.HTTP_200_OK
        assert "access_token" in response.json()
        assert any("refresh_token" in header for header in response.headers.get_list("set-cookie"))

    async def test_login_invalid_credentials(self, client: AsyncClient) -> None:
        response = await client.post(
            "/api/v1/auth/login",
            json={"email": "nonexistent@example.com", "password": "WrongPassword123!"},
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST

    async def test_login_wrong_password(self, client: AsyncClient) -> None:
        email = "wrongpw@example.com"
        await client.post("/api/v1/auth/signup", json={"email": email, "password": "Password123!"})

        response = await client.post("/api/v1/auth/login", json={"email": email, "password": "Different123!"})

        assert response.status_code == status.HTTP_400_BAD_REQUEST
