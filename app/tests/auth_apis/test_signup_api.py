from httpx import AsyncClient
from starlette import status


class TestSignupAPI:
    async def test_signup_success(self, client: AsyncClient) -> None:
        signup_data = {"email": "test@example.com", "password": "Password123!"}

        response = await client.post("/api/v1/auth/signup", json=signup_data)

        assert response.status_code == status.HTTP_201_CREATED
        assert response.json() == {"detail": "회원가입이 성공적으로 완료되었습니다."}

    async def test_signup_invalid_email(self, client: AsyncClient) -> None:
        signup_data = {"email": "invalid-email", "password": "Password123!"}

        response = await client.post("/api/v1/auth/signup", json=signup_data)

        assert response.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT

    async def test_signup_duplicate_email_conflicts(self, client: AsyncClient) -> None:
        signup_data = {"email": "dup@example.com", "password": "Password123!"}
        await client.post("/api/v1/auth/signup", json=signup_data)

        response = await client.post("/api/v1/auth/signup", json=signup_data)

        assert response.status_code == status.HTTP_409_CONFLICT

    async def test_signup_never_echoes_password(self, client: AsyncClient) -> None:
        response = await client.post(
            "/api/v1/auth/signup", json={"email": "quiet@example.com", "password": "Password123!"}
        )

        assert "password123" not in response.text.lower()
