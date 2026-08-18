from httpx import AsyncClient
from starlette import status


class TestSignupAPI:
    async def test_signup_success(self, client: AsyncClient) -> None:
        response = await client.post(
            "/api/v1/auth/signup",
            json={"email": "test@example.com", "password": "Password123!"},
        )

        assert response.status_code == status.HTTP_201_CREATED
        body = response.json()
        assert body["success"] is True
        assert body["data"]["email"] == "test@example.com"
        assert body["data"]["status"] == "active"
        assert "account_id" in body["data"]
        assert body["message"]

    async def test_signup_invalid_email(self, client: AsyncClient) -> None:
        response = await client.post("/api/v1/auth/signup", json={"email": "invalid-email", "password": "Password123!"})

        assert response.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT
        assert response.json()["error_code"] == "VALIDATION_ERROR"

    async def test_signup_weak_password(self, client: AsyncClient) -> None:
        response = await client.post(
            "/api/v1/auth/signup", json={"email": "weak@example.com", "password": "alllowercase1"}
        )

        assert response.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT

    async def test_signup_duplicate_email_conflicts(self, client: AsyncClient) -> None:
        signup_data = {"email": "dup@example.com", "password": "Password123!"}
        await client.post("/api/v1/auth/signup", json=signup_data)

        response = await client.post("/api/v1/auth/signup", json=signup_data)

        assert response.status_code == status.HTTP_409_CONFLICT
        assert response.json()["error_code"] == "EMAIL_ALREADY_REGISTERED"

    async def test_signup_never_echoes_password(self, client: AsyncClient) -> None:
        response = await client.post(
            "/api/v1/auth/signup", json={"email": "quiet@example.com", "password": "Password123!"}
        )

        assert "password123" not in response.text.lower()

    async def test_signup_rejects_legacy_profile_fields(self, client: AsyncClient) -> None:
        """docs/03_api_spec.md 2절: 프로필 이름·생년을 요청에 담지 못한다."""
        response = await client.post(
            "/api/v1/auth/signup",
            json={
                "email": "legacy@example.com",
                "password": "Password123!",
                "name": "테스터",
                "phone_number": "01012345678",
            },
        )

        assert response.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT

    async def test_signup_creates_a_free_subscription(self, client: AsyncClient) -> None:
        email = "withsub@example.com"
        await client.post("/api/v1/auth/signup", json={"email": email, "password": "Password123!"})
        login = await client.post("/api/v1/auth/login", json={"email": email, "password": "Password123!"})
        token = login.json()["data"]["access_token"]

        response = await client.get("/api/v1/subscription", headers={"Authorization": f"Bearer {token}"})

        assert response.status_code == status.HTTP_200_OK
        assert response.json()["data"]["plan"] == "FREE"
