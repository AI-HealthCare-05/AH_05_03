import secrets
import uuid

from fakeredis.aioredis import FakeRedis
from httpx import AsyncClient
from starlette import status

from app.services.invitation_store import InvitationStore


async def _login(client: AsyncClient, email: str) -> dict[str, str]:
    await client.post("/api/v1/auth/signup", json={"email": email, "password": "Password123!"})
    response = await client.post("/api/v1/auth/login", json={"email": email, "password": "Password123!"})
    return {"Authorization": f"Bearer {response.json()['data']['access_token']}"}


async def _create_household(client: AsyncClient, headers: dict[str, str]) -> str:
    response = await client.post("/api/v1/households", headers=headers)
    assert response.status_code == status.HTTP_201_CREATED
    return response.json()["data"]["id"]


async def _create_slot(client: AsyncClient, headers: dict[str, str], household_id: str, name: str = "배우자") -> str:
    created = await client.post(
        "/api/v1/profiles",
        headers=headers,
        json={"household_id": household_id, "display_name": name, "relationship": "배우자"},
    )
    assert created.status_code == status.HTTP_201_CREATED
    return created.json()["data"]["id"]


async def _accept_and_claim(
    client: AsyncClient,
    fake_redis: FakeRedis,
    master: dict[str, str],
    member: dict[str, str],
    household_id: str,
    member_email: str,
    profile_id: str,
) -> tuple[str, str]:
    profile_ref = secrets.token_urlsafe(32)
    invited = await client.post(
        "/api/v1/family-invitations",
        headers=master,
        json={
            "household_id": household_id,
            "invitee_email": member_email,
            "target_profile_ref": profile_ref,
            "target_profile_id": profile_id,
        },
    )
    assert invited.status_code == status.HTTP_201_CREATED, invited.text
    invitation_id = uuid.UUID(invited.json()["data"]["invitation"]["id"])
    delivery = await InvitationStore(fake_redis).take_delivery(invitation_id)
    assert delivery is not None
    accepted = await client.post(
        f"/api/v1/family-invitations/{invitation_id}/accept",
        headers=member,
        json={"token": delivery.token},
    )
    assert accepted.status_code == status.HTTP_200_OK
    linked = await client.post(
        "/api/v1/profile-links",
        headers=member,
        json={
            "invitation_id": str(invitation_id),
            "local_profile_ref": profile_ref,
            "profile_id": profile_id,
        },
    )
    assert linked.status_code == status.HTTP_201_CREATED, linked.text
    return str(invitation_id), profile_ref


class TestProfileClaimAndUnshare:
    async def test_claim_keeps_profile_id_and_records(self, client: AsyncClient, fake_redis: FakeRedis) -> None:
        master = await _login(client, "claim-master@example.com")
        member = await _login(client, "claim-adult@example.com")
        household_id = await _create_household(client, master)
        profile_id = await _create_slot(client, master, household_id)
        record = await client.post(
            "/api/v1/health-records",
            headers=master,
            json={
                "profile_id": profile_id,
                "record_type": "blood_pressure",
                "recorded_at": "2026-09-01T00:00:00Z",
                "source": "manual",
                "payload": {"systolic": 120, "diastolic": 80},
            },
        )
        assert record.status_code == status.HTTP_201_CREATED
        record_id = record.json()["data"]["id"]

        await _accept_and_claim(client, fake_redis, master, member, household_id, "claim-adult@example.com", profile_id)

        claimed = await client.get(f"/api/v1/profiles/{profile_id}", headers=member)
        assert claimed.status_code == status.HTTP_200_OK
        data = claimed.json()["data"]
        assert data["id"] == profile_id
        assert data["ownership_type"] == "claimed_adult"
        assert data["claimed_account_id"] is not None

        kept = await client.get(f"/api/v1/health-records/{record_id}", headers=member)
        assert kept.status_code == status.HTTP_200_OK
        assert kept.json()["data"]["profile_id"] == profile_id

        purge = await client.patch(
            f"/api/v1/profiles/{profile_id}",
            headers=master,
            json={"status": "deleted"},
        )
        assert purge.status_code == status.HTTP_403_FORBIDDEN
        assert purge.json()["error_code"] == "PROFILE_ACCESS_DENIED"

    async def test_invite_conflict_when_another_account_already_claimed(
        self, client: AsyncClient, fake_redis: FakeRedis
    ) -> None:
        master = await _login(client, "claim-conflict-master@example.com")
        adult = await _login(client, "claim-conflict-adult@example.com")
        other = await _login(client, "claim-conflict-other@example.com")
        household_id = await _create_household(client, master)
        profile_id = await _create_slot(client, master, household_id)
        await _accept_and_claim(
            client, fake_redis, master, adult, household_id, "claim-conflict-adult@example.com", profile_id
        )
        conflict = await client.post(
            "/api/v1/family-invitations",
            headers=master,
            json={
                "household_id": household_id,
                "invitee_email": "claim-conflict-other@example.com",
                "target_profile_ref": secrets.token_urlsafe(32),
                "target_profile_id": profile_id,
            },
        )
        assert conflict.status_code == status.HTTP_409_CONFLICT
        assert conflict.json()["error_code"] == "PROFILE_CLAIM_CONFLICT"
        assert other is not None

    async def test_unshare_keeps_account_and_records_but_revokes_membership(
        self, client: AsyncClient, fake_redis: FakeRedis
    ) -> None:
        master = await _login(client, "unshare-master@example.com")
        member = await _login(client, "unshare-adult@example.com")
        household_id = await _create_household(client, master)
        profile_id = await _create_slot(client, master, household_id, "김다원")
        await client.post(
            f"/api/v1/profiles/{profile_id}/pin-credentials",
            headers=master,
        )
        await _accept_and_claim(
            client, fake_redis, master, member, household_id, "unshare-adult@example.com", profile_id
        )

        wrong = await client.post(
            f"/api/v1/profiles/{profile_id}/household-unshares",
            headers=master,
            json={"password": "wrong-password"},
        )
        assert wrong.status_code == status.HTTP_401_UNAUTHORIZED

        unshared = await client.post(
            f"/api/v1/profiles/{profile_id}/household-unshares",
            headers=master,
            json={"password": "Password123!"},
        )
        assert unshared.status_code == status.HTTP_204_NO_CONTENT

        listed = await client.get(f"/api/v1/profiles?household_id={household_id}", headers=master)
        assert all(item["id"] != profile_id for item in listed.json()["data"]["items"])

        memberships = await client.get(f"/api/v1/households/{household_id}/memberships", headers=master)
        adult_row = next(
            item for item in memberships.json()["data"]["items"] if item["masked_email"] == "unshare-adult@example.com"
        )
        assert adult_row["status"] == "left"

        me = await client.get("/api/v1/account", headers=member)
        assert me.status_code == status.HTTP_200_OK
        own = await client.get(f"/api/v1/profiles/{profile_id}", headers=member)
        assert own.status_code == status.HTTP_200_OK
        assert own.json()["data"]["lifecycle_status"] == "unshared"

        pin = await client.post(
            f"/api/v1/profiles/{profile_id}/member-sessions",
            headers=member,
            json={"pin": "000000"},
        )
        assert pin.status_code in {status.HTTP_401_UNAUTHORIZED, status.HTTP_404_NOT_FOUND}

        household = await client.post("/api/v1/households", headers=member)
        assert household.status_code == status.HTTP_201_CREATED
