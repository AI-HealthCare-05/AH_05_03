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
        email = "post_close_login@example.com"
        tokens = await _login(client, email)
        await client.delete("/api/v1/account", headers={"Authorization": f"Bearer {tokens['access_token']}"})

        response = await client.post("/api/v1/auth/login", json={"email": email, "password": "Password123!"})

        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert response.json()["error_code"] == "ACCOUNT_CLOSED"

    async def test_closed_email_cannot_re_signup(self, client: AsyncClient) -> None:
        """의도된 귀결: 재가입을 여는 별도 엔드포인트는 스펙에 없어 만들지
        않았다. 이메일은 유예기간 동안 점유된 채로 남는다."""
        email = "occupied@example.com"
        tokens = await _login(client, email)
        await client.delete("/api/v1/account", headers={"Authorization": f"Bearer {tokens['access_token']}"})

        response = await client.post("/api/v1/auth/signup", json={"email": email, "password": "Password123!"})

        assert response.status_code == status.HTTP_409_CONFLICT

    async def test_requires_auth(self, client: AsyncClient) -> None:
        response = await client.delete("/api/v1/account")

        assert response.status_code == status.HTTP_401_UNAUTHORIZED
