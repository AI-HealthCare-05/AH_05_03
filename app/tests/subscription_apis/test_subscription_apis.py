from httpx import AsyncClient
from starlette import status


async def _login(client: AsyncClient, email: str) -> dict:
    await client.post("/api/v1/auth/signup", json={"email": email, "password": "Password123!"})
    response = await client.post("/api/v1/auth/login", json={"email": email, "password": "Password123!"})
    return dict(response.json()["data"])


class TestGetSubscription:
    async def test_new_account_has_a_free_active_subscription(self, client: AsyncClient) -> None:
        tokens = await _login(client, "freeplan@example.com")

        response = await client.get(
            "/api/v1/subscription", headers={"Authorization": f"Bearer {tokens['access_token']}"}
        )

        assert response.status_code == status.HTTP_200_OK
        data = response.json()["data"]
        assert data["plan"] == "FREE"
        assert data["status"] == "active"
        assert data["license_valid"] is True
        assert data["renewed_at"] is None

    async def test_requires_auth(self, client: AsyncClient) -> None:
        response = await client.get("/api/v1/subscription")

        assert response.status_code == status.HTTP_401_UNAUTHORIZED


class TestChangeSubscription:
    async def test_change_plan_succeeds(self, client: AsyncClient) -> None:
        tokens = await _login(client, "upgrade@example.com")
        headers = {"Authorization": f"Bearer {tokens['access_token']}"}

        response = await client.post("/api/v1/subscription/change", json={"plan": "FAMILY"}, headers=headers)

        assert response.status_code == status.HTTP_200_OK
        data = response.json()["data"]
        assert data["plan"] == "FAMILY"
        assert data["previous_plan"] == "FREE"
        assert data["applied"] is True
        assert data["renewed_at"]

    async def test_change_reflected_on_next_get(self, client: AsyncClient) -> None:
        tokens = await _login(client, "reflect@example.com")
        headers = {"Authorization": f"Bearer {tokens['access_token']}"}
        await client.post("/api/v1/subscription/change", json={"plan": "BASIC"}, headers=headers)

        response = await client.get("/api/v1/subscription", headers=headers)

        assert response.json()["data"]["plan"] == "BASIC"

    async def test_same_plan_is_conflict_not_silent_success(self, client: AsyncClient) -> None:
        """DELETE /account와 달리 여기서는 조용한 200이 클라이언트 버그를
        숨긴다 — 그래서 비대칭적으로 409를 택했다."""
        tokens = await _login(client, "noop@example.com")
        headers = {"Authorization": f"Bearer {tokens['access_token']}"}

        response = await client.post("/api/v1/subscription/change", json={"plan": "FREE"}, headers=headers)

        assert response.status_code == status.HTTP_409_CONFLICT
        assert response.json()["error_code"] == "PLAN_CHANGE_NOT_ALLOWED"

    async def test_unknown_plan_is_validation_error(self, client: AsyncClient) -> None:
        tokens = await _login(client, "unknownplan@example.com")
        headers = {"Authorization": f"Bearer {tokens['access_token']}"}

        response = await client.post("/api/v1/subscription/change", json={"plan": "ENTERPRISE"}, headers=headers)

        assert response.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT

    async def test_missing_plan_is_validation_error(self, client: AsyncClient) -> None:
        tokens = await _login(client, "missingplan@example.com")
        headers = {"Authorization": f"Bearer {tokens['access_token']}"}

        response = await client.post("/api/v1/subscription/change", json={}, headers=headers)

        assert response.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT

    async def test_requires_auth(self, client: AsyncClient) -> None:
        response = await client.post("/api/v1/subscription/change", json={"plan": "BASIC"})

        assert response.status_code == status.HTTP_401_UNAUTHORIZED
