from uuid import uuid4

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

    async def test_signup_reactivates_closed_account(self, client: AsyncClient) -> None:
        """탈퇴(CLOSED)한 계정과 같은 이메일로 재가입하면 기존 행을 덮어써 되살린다.

        email이 unique라 새 행을 못 만든다 — 재가입은 새 비밀번호로 기존 계정을
        ACTIVE로 되돌리고, 옛 비밀번호는 더 이상 통하지 않아야 한다.
        """
        email = f"reactivate-{uuid4().hex[:8]}@example.com"

        signup_res = await client.post("/api/v1/auth/signup", json={"email": email, "password": "OldPassword1!"})
        assert signup_res.status_code == status.HTTP_201_CREATED
        original_account_id = signup_res.json()["data"]["account_id"]

        login_res = await client.post("/api/v1/auth/login", json={"email": email, "password": "OldPassword1!"})
        headers = {"Authorization": f"Bearer {login_res.json()['data']['access_token']}"}

        close_res = await client.delete("/api/v1/account", headers=headers)
        assert close_res.status_code == status.HTTP_200_OK

        # 탈퇴 직후에는 같은 이메일로 로그인이 통하지 않는다.
        blocked_login = await client.post("/api/v1/auth/login", json={"email": email, "password": "OldPassword1!"})
        assert blocked_login.status_code == status.HTTP_401_UNAUTHORIZED

        resignup_res = await client.post("/api/v1/auth/signup", json={"email": email, "password": "NewPassword2!"})

        assert resignup_res.status_code == status.HTTP_201_CREATED
        resignup_data = resignup_res.json()["data"]
        assert resignup_data["email"] == email
        assert resignup_data["status"] == "active"
        assert resignup_data["account_id"] == original_account_id

        old_password_login = await client.post("/api/v1/auth/login", json={"email": email, "password": "OldPassword1!"})
        assert old_password_login.status_code == status.HTTP_401_UNAUTHORIZED

        new_password_login = await client.post("/api/v1/auth/login", json={"email": email, "password": "NewPassword2!"})
        assert new_password_login.status_code == status.HTTP_200_OK

        sub_res = await client.get(
            "/api/v1/subscription",
            headers={"Authorization": f"Bearer {new_password_login.json()['data']['access_token']}"},
        )
        assert sub_res.status_code == status.HTTP_200_OK
        assert sub_res.json()["data"]["plan"] == "FREE"

    async def test_signup_duplicate_active_account_still_conflicts(self, client: AsyncClient) -> None:
        """탈퇴하지 않은(ACTIVE) 계정은 재가입 우회 대상이 아니다 — 기존 회귀다."""
        email = f"still-active-{uuid4().hex[:8]}@example.com"
        signup_data = {"email": email, "password": "Password123!"}
        await client.post("/api/v1/auth/signup", json=signup_data)

        response = await client.post("/api/v1/auth/signup", json=signup_data)

        assert response.status_code == status.HTTP_409_CONFLICT
        assert response.json()["error_code"] == "EMAIL_ALREADY_REGISTERED"
