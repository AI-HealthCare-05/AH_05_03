import secrets
import uuid

import pytest
from fakeredis.aioredis import FakeRedis
from httpx import AsyncClient
from starlette import status

from app.services.invitation_store import InvitationStore


async def _signup_and_login(client: AsyncClient, email: str) -> tuple[dict[str, str], str]:
    signup_res = await client.post("/api/v1/auth/signup", json={"email": email, "password": "Password123!"})
    account_id = signup_res.json()["data"]["account_id"]
    response = await client.post("/api/v1/auth/login", json={"email": email, "password": "Password123!"})
    headers = {"Authorization": f"Bearer {response.json()['data']['access_token']}"}
    return headers, account_id


async def _create_household(client: AsyncClient, headers: dict[str, str]) -> str:
    response = await client.post("/api/v1/households", headers=headers)
    assert response.status_code == status.HTTP_201_CREATED
    return response.json()["data"]["id"]


async def _invite_and_accept(
    client: AsyncClient,
    fake_redis: FakeRedis,
    inviter_headers: dict[str, str],
    invitee_headers: dict[str, str],
    household_id: str,
    invitee_email: str,
) -> None:
    profile_ref = secrets.token_urlsafe(32)
    response = await client.post(
        "/api/v1/family-invitations",
        headers=inviter_headers,
        json={
            "household_id": household_id,
            "invitee_email": invitee_email,
            "target_profile_ref": profile_ref,
        },
    )
    invitation_id = uuid.UUID(response.json()["data"]["invitation"]["id"])
    delivery = await InvitationStore(fake_redis).take_delivery(invitation_id)
    assert delivery is not None
    accept_res = await client.post(
        f"/api/v1/family-invitations/{invitation_id}/accept",
        headers=invitee_headers,
        json={"token": delivery.token},
    )
    assert accept_res.status_code == status.HTTP_200_OK


@pytest.mark.asyncio
class TestHouseholdPolicyAPI:
    async def test_single_household_policy_cannot_create_multiple_households(self, client: AsyncClient) -> None:
        headers, _ = await _signup_and_login(client, "single-household-owner@example.com")
        household_id = await _create_household(client, headers)
        assert household_id is not None

        # 이미 속한 가정이 있는 상태에서 또 생성을 시도하면 409 Conflict
        second_attempt = await client.post("/api/v1/households", headers=headers)
        assert second_attempt.status_code == status.HTTP_409_CONFLICT
        assert "이미 소속된 가정이 있어" in second_attempt.json()["message"]

    async def test_invited_member_cannot_create_household(self, client: AsyncClient, fake_redis: FakeRedis) -> None:
        owner_headers, _ = await _signup_and_login(client, "inv-owner@example.com")
        member_headers, _ = await _signup_and_login(client, "inv-member@example.com")
        household_id = await _create_household(client, owner_headers)

        await _invite_and_accept(
            client, fake_redis, owner_headers, member_headers, household_id, "inv-member@example.com"
        )

        # 초대받아 합류한 멤버도 이미 활성 가정이 있으므로 가정 생성 불가
        create_attempt = await client.post("/api/v1/households", headers=member_headers)
        assert create_attempt.status_code == status.HTTP_409_CONFLICT

    async def test_transfer_master_and_leave(self, client: AsyncClient, fake_redis: FakeRedis) -> None:
        owner_headers, owner_id = await _signup_and_login(client, "transfer-owner@example.com")
        member_headers, member_id = await _signup_and_login(client, "transfer-member@example.com")
        household_id = await _create_household(client, owner_headers)

        await _invite_and_accept(
            client, fake_redis, owner_headers, member_headers, household_id, "transfer-member@example.com"
        )

        # 일반 멤버는 마스터 권한을 위임할 수 없음
        non_master_transfer = await client.post(
            f"/api/v1/households/{household_id}/transfer-master",
            headers=member_headers,
            json={"target_account_id": owner_id},
        )
        assert non_master_transfer.status_code == status.HTTP_409_CONFLICT

        # 마스터(owner)는 다른 멤버가 있는 동안 가정 나가기 불가
        owner_leave_failed = await client.post(f"/api/v1/households/{household_id}/leave", headers=owner_headers)
        assert owner_leave_failed.status_code == status.HTTP_409_CONFLICT

        # 마스터 권한을 member에게 정상 위임
        transfer_res = await client.post(
            f"/api/v1/households/{household_id}/transfer-master",
            headers=owner_headers,
            json={"target_account_id": member_id},
        )
        assert transfer_res.status_code == status.HTTP_200_OK
        assert transfer_res.json()["data"]["master_account_id"] == member_id

        # 위임 후 이전 마스터(owner)는 일반 멤버가 되었으므로 가정 나가기 성공
        owner_leave_success = await client.post(f"/api/v1/households/{household_id}/leave", headers=owner_headers)
        assert owner_leave_success.status_code == status.HTTP_200_OK

    async def test_master_account_close_auto_succession(self, client: AsyncClient, fake_redis: FakeRedis) -> None:
        owner_headers, _ = await _signup_and_login(client, "auto-succ-owner@example.com")
        member_headers, member_id = await _signup_and_login(client, "auto-succ-member@example.com")
        household_id = await _create_household(client, owner_headers)

        await _invite_and_accept(
            client, fake_redis, owner_headers, member_headers, household_id, "auto-succ-member@example.com"
        )

        # 마스터가 계정을 탈퇴함
        close_res = await client.delete("/api/v1/account", headers=owner_headers)
        assert close_res.status_code == status.HTTP_200_OK

        # 가정이 닫히지 않고, 남은 member가 마스터로 자동 승계되었는지 확인
        hh_res = await client.get(f"/api/v1/households/{household_id}", headers=member_headers)
        assert hh_res.status_code == status.HTTP_200_OK
        assert hh_res.json()["data"]["status"] == "active"
        assert hh_res.json()["data"]["master_account_id"] == member_id
