import uuid

import pytest
from fastapi import status
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.profiles import FamilyProfile


async def _signup_and_login(client: AsyncClient, email: str) -> tuple[dict[str, str], str]:
    res = await client.post(
        "/api/v1/auth/signup",
        json={"email": email, "password": "Password123!"},
    )
    assert res.status_code == status.HTTP_201_CREATED
    account_id = res.json()["data"]["account_id"]

    login_res = await client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": "Password123!"},
    )
    token = login_res.json()["data"]["access_token"]
    return {"Authorization": f"Bearer {token}"}, account_id


async def _create_household(client: AsyncClient, headers: dict[str, str]) -> str:
    res = await client.post("/api/v1/households", headers=headers)
    assert res.status_code == status.HTTP_201_CREATED
    return res.json()["data"]["id"]


@pytest.mark.asyncio
class TestAccountPurgeAPI:
    async def test_close_account_without_purge(self, client: AsyncClient) -> None:
        headers, _ = await _signup_and_login(client, f"no-purge-{uuid.uuid4().hex[:6]}@example.com")
        close_res = await client.delete("/api/v1/account", headers=headers)
        assert close_res.status_code == status.HTTP_200_OK
        data = close_res.json()["data"]
        assert data["health_data_purged"] is False

    async def test_close_account_with_purge_health_data(self, client: AsyncClient, db_session: AsyncSession) -> None:
        headers, account_id = await _signup_and_login(client, f"purge-{uuid.uuid4().hex[:6]}@example.com")
        household_id = await _create_household(client, headers)

        # 프로필 생성
        profile_res = await client.post(
            "/api/v1/profiles",
            headers=headers,
            json={
                "household_id": household_id,
                "display_name": "폐기대상자",
                "relationship": "본인",
            },
        )
        assert profile_res.status_code == status.HTTP_201_CREATED

        # purge_health_data=True로 탈퇴
        close_res = await client.delete("/api/v1/account?purge_health_data=true", headers=headers)
        assert close_res.status_code == status.HTTP_200_OK
        assert close_res.json()["data"]["health_data_purged"] is True

        # DB에서 해당 계정이 생성한 프로필이 실제로 영구 삭제되었는지 확인
        stmt = select(FamilyProfile).where(FamilyProfile.created_by_account_id == uuid.UUID(account_id))
        result = await db_session.execute(stmt)
        assert result.scalar_one_or_none() is None
