import secrets
import uuid

from fakeredis.aioredis import FakeRedis
from httpx import AsyncClient
from starlette import status

from app.services.invitation_store import InvitationStore


async def _login(client: AsyncClient, email: str) -> dict[str, str]:
    await client.post("/api/v1/auth/signup", json={"email": email, "password": "Password123!"})
    response = await client.post("/api/v1/auth/login", json={"email": email, "password": "Password123!"})
    token = response.json()["data"]["access_token"]
    return {"Authorization": f"Bearer {token}"}


async def _household(client: AsyncClient, headers: dict[str, str]) -> str:
    response = await client.post("/api/v1/households", headers=headers)
    assert response.status_code == status.HTTP_201_CREATED
    return str(response.json()["data"]["id"])


async def _invite(
    client: AsyncClient,
    headers: dict[str, str],
    household_id: str,
    email: str,
    profile_ref: str | None = None,
):
    return await client.post(
        "/api/v1/family-invitations",
        headers=headers,
        json={
            "household_id": household_id,
            "invitee_email": email,
            "target_profile_ref": profile_ref or secrets.token_urlsafe(32),
        },
    )


class TestInvitationSmartMove:
    async def test_solo_household_automatically_closed_when_accepting_new_invitation(
        self, client: AsyncClient, fake_redis: FakeRedis
    ) -> None:
        # 1. 사용자 A (혼자 단독 가정 생성)
        user_a_headers = await _login(client, "solo-user@example.com")
        solo_household_id = await _household(client, user_a_headers)

        # 사용자 A의 활성 가정 확인: 1개 (단독 가정)
        a_households = await client.get("/api/v1/households", headers=user_a_headers)
        assert len(a_households.json()["data"]["items"]) == 1
        assert a_households.json()["data"]["items"][0]["id"] == solo_household_id

        # 2. 사용자 B (가족 가정 생성 후 사용자 A에게 초대 발송)
        user_b_headers = await _login(client, "family-creator@example.com")
        family_household_id = await _household(client, user_b_headers)

        created = await _invite(client, user_b_headers, family_household_id, "solo-user@example.com")
        assert created.status_code == status.HTTP_201_CREATED
        invitation_id = uuid.UUID(created.json()["data"]["invitation"]["id"])

        delivery = await InvitationStore(fake_redis).take_delivery(invitation_id)
        assert delivery is not None

        # 3. 사용자 A가 초대 수락
        accepted = await client.post(
            f"/api/v1/family-invitations/{invitation_id}/accept",
            headers=user_a_headers,
            json={"token": delivery.token},
        )
        assert accepted.status_code == status.HTTP_200_OK

        # 4. 사용자 A의 활성 가정이 사용자 B의 가족 가정 1개만 남아있는지 확인
        updated_a_households = await client.get("/api/v1/households", headers=user_a_headers)
        items = updated_a_households.json()["data"]["items"]
        assert len(items) == 1
        assert items[0]["id"] == family_household_id

        # 이전 단독 가정은 closed 상태로 조회 불가하거나 상태가 closed 여야 함
        solo_detail = await client.get(f"/api/v1/households/{solo_household_id}", headers=user_a_headers)
        assert solo_detail.status_code == status.HTTP_404_NOT_FOUND

    async def test_multi_member_household_is_blocked_from_accepting_another_invitation(
        self, client: AsyncClient, fake_redis: FakeRedis
    ) -> None:
        # 1. 가정 1: 사용자 A와 사용자 C가 함께 소속됨 (다인 가족)
        user_a_headers = await _login(client, "multi-user-a@example.com")
        user_c_headers = await _login(client, "multi-user-c@example.com")
        household_1_id = await _household(client, user_a_headers)

        # C를 초대하여 수락하게 함
        invite_c = await _invite(client, user_a_headers, household_1_id, "multi-user-c@example.com")
        inv_c_id = uuid.UUID(invite_c.json()["data"]["invitation"]["id"])
        delivery_c = await InvitationStore(fake_redis).take_delivery(inv_c_id)
        assert delivery_c is not None
        await client.post(
            f"/api/v1/family-invitations/{inv_c_id}/accept",
            headers=user_c_headers,
            json={"token": delivery_c.token},
        )

        # 2. 제3자 사용자 B가 새 가정을 만들고 사용자 A를 초대
        user_b_headers = await _login(client, "third-party-b@example.com")
        household_2_id = await _household(client, user_b_headers)

        invite_a = await _invite(client, user_b_headers, household_2_id, "multi-user-a@example.com")
        inv_a_id = uuid.UUID(invite_a.json()["data"]["invitation"]["id"])
        delivery_a = await InvitationStore(fake_redis).take_delivery(inv_a_id)
        assert delivery_a is not None

        # 3. 사용자 A가 수락 시도 -> 다인 가정이므로 임의 종료 불가, 409 Conflict 차단
        accept_attempt = await client.post(
            f"/api/v1/family-invitations/{inv_a_id}/accept",
            headers=user_a_headers,
            json={"token": delivery_a.token},
        )
        assert accept_attempt.status_code == status.HTTP_409_CONFLICT
        assert accept_attempt.json()["error_code"] == "HOUSEHOLD_STATE_CONFLICT"

        # 사용자 A의 소속 가정은 기존 household_1_id 1개로 온전히 유지
        a_households = await client.get("/api/v1/households", headers=user_a_headers)
        items = a_households.json()["data"]["items"]
        assert len(items) == 1
        assert items[0]["id"] == household_1_id
