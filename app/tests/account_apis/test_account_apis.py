from httpx import AsyncClient
from starlette import status


async def _login(client: AsyncClient, email: str) -> dict:
    await client.post("/api/v1/auth/signup", json={"email": email, "password": "Password123!"})
    response = await client.post("/api/v1/auth/login", json={"email": email, "password": "Password123!"})
    return dict(response.json()["data"])


class TestGetAccount:
    async def test_returns_account_and_subscription_summary(self, client: AsyncClient) -> None:
        email = "summary@example.com"
        tokens = await _login(client, email)

        response = await client.get("/api/v1/account", headers={"Authorization": f"Bearer {tokens['access_token']}"})

        assert response.status_code == status.HTTP_200_OK
        data = response.json()["data"]
        assert data["account"]["email"] == email
        assert data["account"]["status"] == "active"
        assert data["subscription"]["plan"] == "FREE"
        assert data["subscription"]["status"] == "active"

    async def test_never_leaks_prohibited_profile_fields(self, client: AsyncClient) -> None:
        """docs/05_tech_architecture.md 4절 서버 금지 항목 확인."""
        tokens = await _login(client, "privacy@example.com")

        response = await client.get("/api/v1/account", headers={"Authorization": f"Bearer {tokens['access_token']}"})

        lowered = response.text.lower()
        for forbidden in ("name", "gender", "birth", "phone", "password_hash"):
            assert forbidden not in lowered

    async def test_requires_auth(self, client: AsyncClient) -> None:
        response = await client.get("/api/v1/account")

        assert response.status_code == status.HTTP_401_UNAUTHORIZED
        assert response.json()["error_code"] == "AUTH_REQUIRED"


class TestDeleteAccount:
    async def test_close_returns_200_with_body(self, client: AsyncClient) -> None:
        """204는 본문을 가질 수 없다. 봉투가 모든 응답에 필수라 200이어야 한다."""
        tokens = await _login(client, "close@example.com")

        response = await client.delete("/api/v1/account", headers={"Authorization": f"Bearer {tokens['access_token']}"})

        assert response.status_code == status.HTTP_200_OK
        data = response.json()["data"]
        assert data["status"] == "closed"
        assert data["subscription_status"] == "cancelled"
        assert data["local_data_deleted"] is False
        assert data["closed_at"]

    async def test_close_is_idempotent(self, client: AsyncClient) -> None:
        tokens = await _login(client, "idempotent@example.com")
        headers = {"Authorization": f"Bearer {tokens['access_token']}"}

        first = await client.delete("/api/v1/account", headers=headers)
        second = await client.delete("/api/v1/account", headers=headers)

        assert first.status_code == status.HTTP_200_OK
        assert second.status_code == status.HTTP_200_OK
        assert first.json()["data"]["closed_at"] == second.json()["data"]["closed_at"]

    async def test_closed_account_cannot_use_business_routes(self, client: AsyncClient) -> None:
        """해지 후 refresh 패밀리가 죽어 새 access를 못 만들지만, 이미 갖고
        있던 access token은 15분 내에는 살아 있다 — 그 창 안에서도 업무
        라우트는 403이어야 한다."""
        tokens = await _login(client, "post_close@example.com")
        headers = {"Authorization": f"Bearer {tokens['access_token']}"}
        await client.delete("/api/v1/account", headers=headers)

        response = await client.get("/api/v1/account", headers=headers)

        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert response.json()["error_code"] == "ACCOUNT_CLOSED"

    async def test_closed_account_refresh_token_is_dead(self, client: AsyncClient) -> None:
        tokens = await _login(client, "post_close_refresh@example.com")
        await client.delete("/api/v1/account", headers={"Authorization": f"Bearer {tokens['access_token']}"})

        response = await client.post("/api/v1/auth/refresh")

        assert response.status_code == status.HTTP_401_UNAUTHORIZED

    async def test_closed_account_cannot_login(self, client: AsyncClient) -> None:
        """해지 사실을 익명 로그인 시도자에게 알리지 않는다.

        예전에는 403 `ACCOUNT_CLOSED` 였다 — 그 이메일이 실제로 가입돼 있고
        지금 해지 상태라는 것을 로그인 실패 응답이 그대로 확인해 줬다.
        `test_login_api.py::test_wrong_password_and_unknown_email_look_identical`
        가 지키려던 것과 같은 경계인데 계정 상태 축만 비어 있었다. 지금은
        오답 로그인과 구분되지 않는다.
        """
        email = "post_close_login@example.com"
        tokens = await _login(client, email)
        await client.delete("/api/v1/account", headers={"Authorization": f"Bearer {tokens['access_token']}"})

        closed_login = await client.post("/api/v1/auth/login", json={"email": email, "password": "Password123!"})
        wrong_password = await client.post("/api/v1/auth/login", json={"email": email, "password": "WrongPassword123!"})

        assert closed_login.status_code == status.HTTP_401_UNAUTHORIZED
        assert closed_login.json()["error_code"] == "CREDENTIALS_INVALID"
        assert closed_login.json() == wrong_password.json()

    async def test_closed_email_can_re_signup_and_reactivates_account(self, client: AsyncClient) -> None:
        """결정 번복: 예전에는 이메일이 유예기간 동안 점유된 채로 남아 409였다
        (`test_closed_email_cannot_re_signup`). 재가입을 막아 둘 이유가 없다는
        판단으로 뒤집었다 — 같은 이메일로 재가입하면 새 행이 아니라 이 행을
        덮어써 되살린다. 상세한 비밀번호·구독 리셋 검증은
        `test_signup_api.py::test_signup_reactivates_closed_account` 참조."""
        email = "occupied@example.com"
        tokens = await _login(client, email)
        close_res = await client.delete(
            "/api/v1/account", headers={"Authorization": f"Bearer {tokens['access_token']}"}
        )
        closed_account_id = close_res.json()["data"]["account_id"]

        response = await client.post("/api/v1/auth/signup", json={"email": email, "password": "NewPassword456!"})

        assert response.status_code == status.HTTP_201_CREATED
        assert response.json()["data"]["account_id"] == closed_account_id
        assert response.json()["data"]["status"] == "active"

    async def test_requires_auth(self, client: AsyncClient) -> None:
        response = await client.delete("/api/v1/account")

        assert response.status_code == status.HTTP_401_UNAUTHORIZED
