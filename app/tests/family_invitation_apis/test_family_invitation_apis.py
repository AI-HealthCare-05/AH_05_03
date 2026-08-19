import secrets
import uuid
from datetime import timedelta

from fakeredis.aioredis import FakeRedis
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from starlette import status

from app.models.family_invitations import FamilyInvitation
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


class TestFamilyInvitationAPI:
    async def test_invite_and_accept_connects_existing_household(
        self, client: AsyncClient, fake_redis: FakeRedis
    ) -> None:
        inviter_headers = await _login(client, "family-owner@example.com")
        recipient_headers = await _login(client, "family-member@example.com")
        household_id = await _household(client, inviter_headers)

        created = await _invite(client, inviter_headers, household_id, "family-member@example.com")

        assert created.status_code == status.HTTP_201_CREATED
        body = created.json()["data"]
        invitation_id = uuid.UUID(body["invitation"]["id"])
        assert body["delivery_queued"] is True
        assert "token" not in created.text

        delivery = await InvitationStore(fake_redis).take_delivery(invitation_id)
        assert delivery is not None
        accepted = await client.post(
            f"/api/v1/family-invitations/{invitation_id}/accept",
            headers=recipient_headers,
            json={"token": delivery.token},
        )

        assert accepted.status_code == status.HTTP_200_OK
        assert accepted.json()["data"]["status"] == "accepted"
        households = await client.get("/api/v1/households", headers=recipient_headers)
        assert household_id in {item["id"] for item in households.json()["data"]["items"]}

    async def test_non_member_cannot_invite(self, client: AsyncClient) -> None:
        owner_headers = await _login(client, "household-owner@example.com")
        stranger_headers = await _login(client, "household-stranger@example.com")
        household_id = await _household(client, owner_headers)

        response = await _invite(client, stranger_headers, household_id, "target-one@example.com")

        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert response.json()["error_code"] == "HOUSEHOLD_MEMBERSHIP_REQUIRED"

    async def test_duplicate_pending_invitation_conflicts(self, client: AsyncClient) -> None:
        headers = await _login(client, "duplicate-owner@example.com")
        household_id = await _household(client, headers)
        profile_ref = secrets.token_urlsafe(32)
        await _invite(client, headers, household_id, "duplicate-target@example.com", profile_ref)

        duplicate = await _invite(client, headers, household_id, "DUPLICATE-TARGET@example.com", profile_ref)

        assert duplicate.status_code == status.HTTP_409_CONFLICT
        assert duplicate.json()["error_code"] == "INVITATION_ALREADY_PENDING"

    async def test_self_invitation_is_rejected(self, client: AsyncClient) -> None:
        headers = await _login(client, "self-invite@example.com")
        household_id = await _household(client, headers)

        response = await _invite(client, headers, household_id, "SELF-INVITE@example.com")

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert response.json()["error_code"] == "INVITATION_SELF_NOT_ALLOWED"

    async def test_expired_invitation_requires_new_profile_reference(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        headers = await _login(client, "reissue-owner@example.com")
        household_id = await _household(client, headers)
        profile_ref = secrets.token_urlsafe(32)
        first = await _invite(client, headers, household_id, "reissue-target@example.com", profile_ref)
        first_id = uuid.UUID(first.json()["data"]["invitation"]["id"])
        invitation = await db_session.get(FamilyInvitation, first_id)
        assert invitation is not None
        invitation.expires_at = invitation.created_at + timedelta(microseconds=1)
        await db_session.commit()

        reused = await _invite(client, headers, household_id, "reissue-target@example.com", profile_ref)
        reissued = await _invite(client, headers, household_id, "reissue-target@example.com")

        assert reused.status_code == status.HTTP_409_CONFLICT
        assert reused.json()["error_code"] == "PROFILE_REFERENCE_ALREADY_USED"
        assert reissued.status_code == status.HTTP_201_CREATED
        assert reissued.json()["data"]["invitation"]["id"] != str(first_id)

    async def test_wrong_token_does_not_change_state(self, client: AsyncClient) -> None:
        inviter_headers = await _login(client, "wrong-token-owner@example.com")
        recipient_headers = await _login(client, "wrong-token-member@example.com")
        household_id = await _household(client, inviter_headers)
        created = await _invite(client, inviter_headers, household_id, "wrong-token-member@example.com")
        invitation_id = created.json()["data"]["invitation"]["id"]

        response = await client.post(
            f"/api/v1/family-invitations/{invitation_id}/accept",
            headers=recipient_headers,
            json={"token": "x" * 43},
        )

        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert response.json()["error_code"] == "INVITATION_TOKEN_INVALID"

    async def test_sender_can_cancel_but_recipient_cannot_accept_afterward(
        self, client: AsyncClient, fake_redis: FakeRedis
    ) -> None:
        inviter_headers = await _login(client, "cancel-owner@example.com")
        recipient_headers = await _login(client, "cancel-member@example.com")
        household_id = await _household(client, inviter_headers)
        created = await _invite(client, inviter_headers, household_id, "cancel-member@example.com")
        invitation_id = uuid.UUID(created.json()["data"]["invitation"]["id"])
        delivery = await InvitationStore(fake_redis).take_delivery(invitation_id)
        assert delivery is not None

        cancelled = await client.post(f"/api/v1/family-invitations/{invitation_id}/cancel", headers=inviter_headers)
        accepted = await client.post(
            f"/api/v1/family-invitations/{invitation_id}/accept",
            headers=recipient_headers,
            json={"token": delivery.token},
        )

        assert cancelled.status_code == status.HTTP_200_OK
        assert cancelled.json()["data"]["status"] == "cancelled"
        assert accepted.status_code == status.HTTP_409_CONFLICT
        assert accepted.json()["error_code"] == "INVITATION_STATE_CONFLICT"
