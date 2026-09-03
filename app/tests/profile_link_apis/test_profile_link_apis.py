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


async def _household(client: AsyncClient, headers: dict[str, str]) -> str:
    response = await client.post("/api/v1/households", headers=headers)
    return str(response.json()["data"]["id"])


async def _invite(client: AsyncClient, headers: dict[str, str], household_id: str, email: str, profile_ref: str) -> str:
    response = await client.post(
        "/api/v1/family-invitations",
        headers=headers,
        json={"household_id": household_id, "invitee_email": email, "target_profile_ref": profile_ref},
    )
    assert response.status_code == status.HTTP_201_CREATED
    return str(response.json()["data"]["invitation"]["id"])


async def _accept(client: AsyncClient, redis: FakeRedis, invitation_id: str, recipient_headers: dict[str, str]) -> None:
    delivery = await InvitationStore(redis).take_delivery(uuid.UUID(invitation_id))
    assert delivery is not None
    response = await client.post(
        f"/api/v1/family-invitations/{invitation_id}/accept",
        headers=recipient_headers,
        json={"token": delivery.token},
    )
    assert response.status_code == status.HTTP_200_OK


async def _accepted_invitation(
    client: AsyncClient,
    redis: FakeRedis,
    inviter_headers: dict[str, str],
    household_id: str,
    invitee_email: str,
    recipient_headers: dict[str, str],
    profile_ref: str,
) -> str:
    invitation_id = await _invite(client, inviter_headers, household_id, invitee_email, profile_ref)
    await _accept(client, redis, invitation_id, recipient_headers)
    return invitation_id


async def _link(client: AsyncClient, headers: dict[str, str], invitation_id: str, profile_ref: str):
    return await client.post(
        "/api/v1/profile-links",
        headers=headers,
        json={"invitation_id": invitation_id, "local_profile_ref": profile_ref},
    )


class TestProfileLinkAPI:
    async def test_accepted_invitation_links_existing_local_profile(
        self, client: AsyncClient, fake_redis: FakeRedis
    ) -> None:
        inviter = await _login(client, "link-owner@example.com")
        recipient = await _login(client, "link-member@example.com")
        household_id = await _household(client, inviter)
        profile_ref = secrets.token_urlsafe(32)
        invitation_id = await _accepted_invitation(
            client, fake_redis, inviter, household_id, "link-member@example.com", recipient, profile_ref
        )

        created = await _link(client, recipient, invitation_id, profile_ref)

        assert created.status_code == status.HTTP_201_CREATED
        data = created.json()["data"]
        assert data["household_id"] == household_id
        assert data["local_profile_ref"] == profile_ref
        assert data["status"] == "active"
        assert data["unlinked_at"] is None

        listed = await client.get("/api/v1/profile-links/me", headers=recipient)
        assert [item["id"] for item in listed.json()["data"]["items"]] == [data["id"]]

    async def test_profile_ref_must_match_the_invitation(self, client: AsyncClient, fake_redis: FakeRedis) -> None:
        inviter = await _login(client, "mismatch-owner@example.com")
        recipient = await _login(client, "mismatch-member@example.com")
        household_id = await _household(client, inviter)
        invitation_id = await _accepted_invitation(
            client,
            fake_redis,
            inviter,
            household_id,
            "mismatch-member@example.com",
            recipient,
            secrets.token_urlsafe(32),
        )

        response = await _link(client, recipient, invitation_id, secrets.token_urlsafe(32))

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert response.json()["error_code"] == "PROFILE_REF_INVALID"

    async def test_pending_invitation_cannot_be_linked(self, client: AsyncClient) -> None:
        inviter = await _login(client, "pending-link-owner@example.com")
        recipient = await _login(client, "pending-link-member@example.com")
        household_id = await _household(client, inviter)
        profile_ref = secrets.token_urlsafe(32)
        invitation_id = await _invite(client, inviter, household_id, "pending-link-member@example.com", profile_ref)

        response = await _link(client, recipient, invitation_id, profile_ref)

        # 수락 전에는 accepted_by_account_id가 비어 있어 초대의 존재도 알리지 않는다.
        assert response.status_code == status.HTTP_404_NOT_FOUND
        assert response.json()["error_code"] == "INVITATION_NOT_FOUND"

    async def test_third_party_cannot_link_someone_elses_invitation(
        self, client: AsyncClient, fake_redis: FakeRedis
    ) -> None:
        inviter = await _login(client, "third-party-owner@example.com")
        recipient = await _login(client, "third-party-member@example.com")
        stranger = await _login(client, "third-party-stranger@example.com")
        household_id = await _household(client, inviter)
        profile_ref = secrets.token_urlsafe(32)
        invitation_id = await _accepted_invitation(
            client, fake_redis, inviter, household_id, "third-party-member@example.com", recipient, profile_ref
        )

        response = await _link(client, stranger, invitation_id, profile_ref)

        assert response.status_code == status.HTTP_404_NOT_FOUND
        assert response.json()["error_code"] == "INVITATION_NOT_FOUND"

    async def test_account_holds_only_one_active_link_per_household(
        self, client: AsyncClient, fake_redis: FakeRedis
    ) -> None:
        inviter = await _login(client, "one-link-owner@example.com")
        recipient = await _login(client, "one-link-member@example.com")
        household_id = await _household(client, inviter)
        first_ref = secrets.token_urlsafe(32)
        second_ref = secrets.token_urlsafe(32)
        first_invitation = await _accepted_invitation(
            client, fake_redis, inviter, household_id, "one-link-member@example.com", recipient, first_ref
        )
        second_invitation = await _accepted_invitation(
            client, fake_redis, inviter, household_id, "one-link-member@example.com", recipient, second_ref
        )
        await _link(client, recipient, first_invitation, first_ref)

        response = await _link(client, recipient, second_invitation, second_ref)

        assert response.status_code == status.HTTP_409_CONFLICT
        assert response.json()["error_code"] == "PROFILE_ALREADY_LINKED"

    async def test_profile_ref_is_claimed_by_one_account_only(self, client: AsyncClient, fake_redis: FakeRedis) -> None:
        """한 참조값은 한 계정만 가져간다.

        **막는 자리가 앞으로 옮겨졌다.** 예전에는 같은 참조값으로 둘을 초대해 둘 다
        수락시킨 뒤 두 번째 `POST /profile-links` 를 `PROFILE_REF_ALREADY_CLAIMED`
        로 막았다. 지금은 참조값이 가구당 1회용이라
        (`uq_family_invitations_profile_ref_lifetime`) 두 번째 **초대**가 서지 않는다.

        연결 단계의 `PROFILE_REF_ALREADY_CLAIMED` 검사는 그대로 남아 있다. 다만 초대를
        거치는 이 경로로는 더 이상 닿지 않고, 받쳐 주는 것은
        `uq_profile_links_one_active_account_per_profile` 유니크 제약이다.
        """
        inviter = await _login(client, "claim-owner@example.com")
        first = await _login(client, "claim-first@example.com")
        household_id = await _household(client, inviter)
        shared_ref = secrets.token_urlsafe(32)
        first_invitation = await _accepted_invitation(
            client, fake_redis, inviter, household_id, "claim-first@example.com", first, shared_ref
        )
        await _link(client, first, first_invitation, shared_ref)

        response = await client.post(
            "/api/v1/family-invitations",
            headers=inviter,
            json={
                "household_id": household_id,
                "invitee_email": "claim-second@example.com",
                "target_profile_ref": shared_ref,
            },
        )

        assert response.status_code == status.HTTP_409_CONFLICT
        assert response.json()["error_code"] == "PROFILE_REFERENCE_ALREADY_USED"

    async def test_unlink_is_idempotent_and_keeps_local_data(self, client: AsyncClient, fake_redis: FakeRedis) -> None:
        inviter = await _login(client, "unlink-owner@example.com")
        recipient = await _login(client, "unlink-member@example.com")
        household_id = await _household(client, inviter)
        profile_ref = secrets.token_urlsafe(32)
        invitation_id = await _accepted_invitation(
            client, fake_redis, inviter, household_id, "unlink-member@example.com", recipient, profile_ref
        )
        link_id = (await _link(client, recipient, invitation_id, profile_ref)).json()["data"]["id"]

        first = await client.delete(f"/api/v1/profile-links/{link_id}", headers=recipient)
        second = await client.delete(f"/api/v1/profile-links/{link_id}", headers=recipient)

        assert first.status_code == status.HTTP_200_OK
        assert first.json()["data"]["status"] == "unlinked"
        assert first.json()["data"]["unlinked_at"] is not None
        assert second.status_code == status.HTTP_200_OK
        assert second.json()["data"]["row_version"] == first.json()["data"]["row_version"]

    async def test_other_account_cannot_unlink(self, client: AsyncClient, fake_redis: FakeRedis) -> None:
        inviter = await _login(client, "unlink-guard-owner@example.com")
        recipient = await _login(client, "unlink-guard-member@example.com")
        stranger = await _login(client, "unlink-guard-stranger@example.com")
        household_id = await _household(client, inviter)
        profile_ref = secrets.token_urlsafe(32)
        invitation_id = await _accepted_invitation(
            client, fake_redis, inviter, household_id, "unlink-guard-member@example.com", recipient, profile_ref
        )
        link_id = (await _link(client, recipient, invitation_id, profile_ref)).json()["data"]["id"]

        response = await client.delete(f"/api/v1/profile-links/{link_id}", headers=stranger)

        assert response.status_code == status.HTTP_404_NOT_FOUND
        assert response.json()["error_code"] == "PROFILE_LINK_NOT_FOUND"

    async def test_health_fields_are_rejected_at_the_boundary(self, client: AsyncClient, fake_redis: FakeRedis) -> None:
        inviter = await _login(client, "forbid-owner@example.com")
        recipient = await _login(client, "forbid-member@example.com")
        household_id = await _household(client, inviter)
        profile_ref = secrets.token_urlsafe(32)
        invitation_id = await _accepted_invitation(
            client, fake_redis, inviter, household_id, "forbid-member@example.com", recipient, profile_ref
        )

        response = await client.post(
            "/api/v1/profile-links",
            headers=recipient,
            json={
                "invitation_id": invitation_id,
                "local_profile_ref": profile_ref,
                "profile_name": "김이어",
                "birth_year": 1961,
            },
        )

        assert response.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT
        assert response.json()["error_code"] == "VALIDATION_ERROR"
