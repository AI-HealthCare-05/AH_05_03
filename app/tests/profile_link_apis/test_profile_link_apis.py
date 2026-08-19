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


async def _accept_invitation(
    client: AsyncClient,
    fake_redis: FakeRedis,
    inviter_headers: dict[str, str],
    recipient_headers: dict[str, str],
    household_id: str,
    recipient_email: str,
    profile_ref: str,
) -> str:
    response = await client.post(
        "/api/v1/family-invitations",
        headers=inviter_headers,
        json={
            "household_id": household_id,
            "invitee_email": recipient_email,
            "target_profile_ref": profile_ref,
        },
    )
    invitation_id = uuid.UUID(response.json()["data"]["invitation"]["id"])
    delivery = await InvitationStore(fake_redis).take_delivery(invitation_id)
    assert delivery is not None
    accepted = await client.post(
        f"/api/v1/family-invitations/{invitation_id}/accept",
        headers=recipient_headers,
        json={"token": delivery.token},
    )
    assert accepted.status_code == status.HTTP_200_OK
    return str(invitation_id)


class TestProfileLinkAPI:
    async def test_accepted_invitation_can_create_and_unlink_profile_link(
        self, client: AsyncClient, fake_redis: FakeRedis
    ) -> None:
        owner_headers = await _login(client, "profile-owner@example.com")
        member_headers = await _login(client, "profile-member@example.com")
        household_id = await _create_household(client, owner_headers)
        profile_ref = secrets.token_urlsafe(32)
        invitation_id = await _accept_invitation(
            client,
            fake_redis,
            owner_headers,
            member_headers,
            household_id,
            "profile-member@example.com",
            profile_ref,
        )

        linked = await client.post(
            "/api/v1/profile-links",
            headers=member_headers,
            json={"invitation_id": invitation_id, "local_profile_ref": profile_ref},
        )

        assert linked.status_code == status.HTTP_201_CREATED
        assert linked.json()["data"]["status"] == "active"
        assert linked.json()["data"]["local_profile_ref"] == profile_ref

        link_id = linked.json()["data"]["id"]
        unlinked = await client.post(f"/api/v1/profile-links/{link_id}/unlink", headers=member_headers)
        assert unlinked.status_code == status.HTTP_200_OK
        assert unlinked.json()["data"]["status"] == "unlinked"

    async def test_profile_link_requires_matching_accepted_invitation(
        self, client: AsyncClient, fake_redis: FakeRedis
    ) -> None:
        owner_headers = await _login(client, "mismatch-owner@example.com")
        member_headers = await _login(client, "mismatch-member@example.com")
        household_id = await _create_household(client, owner_headers)
        profile_ref = secrets.token_urlsafe(32)
        invitation_id = await _accept_invitation(
            client,
            fake_redis,
            owner_headers,
            member_headers,
            household_id,
            "mismatch-member@example.com",
            profile_ref,
        )

        response = await client.post(
            "/api/v1/profile-links",
            headers=member_headers,
            json={"invitation_id": invitation_id, "local_profile_ref": secrets.token_urlsafe(32)},
        )

        assert response.status_code == status.HTTP_409_CONFLICT
        assert response.json()["error_code"] == "PROFILE_LINK_INVITATION_MISMATCH"

    async def test_member_can_leave_and_profile_link_is_unlinked(
        self, client: AsyncClient, fake_redis: FakeRedis
    ) -> None:
        owner_headers = await _login(client, "leave-owner@example.com")
        member_headers = await _login(client, "leave-member@example.com")
        household_id = await _create_household(client, owner_headers)
        profile_ref = secrets.token_urlsafe(32)
        invitation_id = await _accept_invitation(
            client,
            fake_redis,
            owner_headers,
            member_headers,
            household_id,
            "leave-member@example.com",
            profile_ref,
        )
        await client.post(
            "/api/v1/profile-links",
            headers=member_headers,
            json={"invitation_id": invitation_id, "local_profile_ref": profile_ref},
        )

        left = await client.post(f"/api/v1/households/{household_id}/leave", headers=member_headers)

        assert left.status_code == status.HTTP_200_OK
        assert left.json()["data"]["status"] == "left"
        links = await client.get("/api/v1/profile-links", headers=member_headers)
        assert links.json()["data"]["items"][0]["status"] == "unlinked"

    async def test_household_can_close_only_without_other_active_members(
        self, client: AsyncClient, fake_redis: FakeRedis
    ) -> None:
        owner_headers = await _login(client, "close-owner@example.com")
        member_headers = await _login(client, "close-member@example.com")
        household_id = await _create_household(client, owner_headers)
        await _accept_invitation(
            client,
            fake_redis,
            owner_headers,
            member_headers,
            household_id,
            "close-member@example.com",
            secrets.token_urlsafe(32),
        )

        conflict = await client.delete(f"/api/v1/households/{household_id}", headers=owner_headers)
        assert conflict.status_code == status.HTTP_409_CONFLICT
        assert conflict.json()["error_code"] == "ACTIVE_MEMBERS_REMAIN"

        await client.post(f"/api/v1/households/{household_id}/leave", headers=member_headers)
        closed = await client.delete(f"/api/v1/households/{household_id}", headers=owner_headers)
        assert closed.status_code == status.HTTP_204_NO_CONTENT
