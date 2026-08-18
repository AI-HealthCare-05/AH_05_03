from httpx import AsyncClient
from starlette import status


async def _signup_and_token(client: AsyncClient, email: str) -> str:
    await client.post("/api/v1/auth/signup", json={"email": email, "password": "Password123!"})
    login_response = await client.post("/api/v1/auth/login", json={"email": email, "password": "Password123!"})
    return str(login_response.json()["access_token"])


class TestUserMeApis:
    async def test_get_user_me_success(self, client: AsyncClient) -> None:
        email = "me@example.com"
        token = await _signup_and_token(client, email)

        response = await client.get("/api/v1/users/me", headers={"Authorization": f"Bearer {token}"})

        assert response.status_code == status.HTTP_200_OK
        body = response.json()
        assert body["email"] == email
        assert body["status"] == "active"

    async def test_get_user_me_never_leaks_prohibited_fields(self, client: AsyncClient) -> None:
        """docs/05_tech_architecture.md 4절 서버 금지 항목이 응답에 없어야 한다."""
        token = await _signup_and_token(client, "privacy@example.com")

        response = await client.get("/api/v1/users/me", headers={"Authorization": f"Bearer {token}"})

        lowered = response.text.lower()
        for forbidden in ("name", "gender", "birth", "phone", "password"):
            assert forbidden not in lowered

    async def test_update_user_me_success(self, client: AsyncClient) -> None:
        token = await _signup_and_token(client, "update_me@example.com")

        response = await client.patch(
            "/api/v1/users/me",
            json={"email": "updated@example.com"},
            headers={"Authorization": f"Bearer {token}"},
        )

        assert response.status_code == status.HTTP_200_OK
        assert response.json()["email"] == "updated@example.com"

    async def test_get_user_me_unauthorized(self, client: AsyncClient) -> None:
        response = await client.get("/api/v1/users/me")

        assert response.status_code == status.HTTP_401_UNAUTHORIZED
