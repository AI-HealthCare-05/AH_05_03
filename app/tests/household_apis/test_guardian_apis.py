import secrets
import uuid
from collections.abc import Iterator
from datetime import date

import pytest
from fakeredis.aioredis import FakeRedis
from httpx import AsyncClient
from starlette import status

from app.main import app
from app.models.guardians import GuardianVerificationStatus
from app.services.invitation_store import InvitationStore
from app.services.legal_guardian_adapter import MemoryLegalGuardianAdapter, get_legal_guardian_adapter
from app.services.minor_policy import CIVIL_MAJORITY_AGE_YEARS, PRIVACY_SELF_DETERMINATION_AGE_YEARS


@pytest.fixture
def legal_adapter() -> Iterator[MemoryLegalGuardianAdapter]:
    adapter = MemoryLegalGuardianAdapter()
    app.dependency_overrides[get_legal_guardian_adapter] = lambda: adapter
    yield adapter
    app.dependency_overrides.pop(get_legal_guardian_adapter, None)


async def _login(client: AsyncClient, email: str) -> dict[str, str]:
    await client.post("/api/v1/auth/signup", json={"email": email, "password": "Password123!"})
    response = await client.post("/api/v1/auth/login", json={"email": email, "password": "Password123!"})
    return {"Authorization": f"Bearer {response.json()['data']['access_token']}"}


async def _household(client: AsyncClient, headers: dict[str, str]) -> str:
    created = await client.post("/api/v1/households", headers=headers)
    return created.json()["data"]["id"]


async def _child(
    client: AsyncClient,
    headers: dict[str, str],
    household_id: str,
    *,
    birth_date: str | None = "2020-01-15",
) -> dict:
    created = await client.post(
        "/api/v1/profiles",
        headers=headers,
        json={
            "household_id": household_id,
            "display_name": "아이",
            "relationship": "자녀",
            "birth_date": birth_date,
        },
    )
    assert created.status_code == status.HTTP_201_CREATED
    return created.json()["data"]


async def _invite_member(
    client: AsyncClient,
    fake_redis: FakeRedis,
    master: dict[str, str],
    member: dict[str, str],
    household_id: str,
    member_email: str,
) -> str:
    invited = await client.post(
        "/api/v1/family-invitations",
        headers=master,
        json={
            "household_id": household_id,
            "invitee_email": member_email,
            "target_profile_ref": secrets.token_urlsafe(32),
        },
    )
    invitation_id = uuid.UUID(invited.json()["data"]["invitation"]["id"])
    delivery = await InvitationStore(fake_redis).take_delivery(invitation_id)
    assert delivery is not None
    accepted = await client.post(
        f"/api/v1/family-invitations/{invitation_id}/accept",
        headers=member,
        json={"token": delivery.token},
    )
    assert accepted.status_code == status.HTTP_200_OK
    return (await client.get("/api/v1/account", headers=member)).json()["data"]["account"]["id"]


async def _claim_profile(
    client: AsyncClient,
    fake_redis: FakeRedis,
    master: dict[str, str],
    member: dict[str, str],
    household_id: str,
    member_email: str,
    profile_id: str,
) -> None:
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


class TestGuardianAPIs:
    async def test_child_create_attaches_unverified_product_guardian(self, client: AsyncClient) -> None:
        headers = await _login(client, "guard-create@example.com")
        household_id = await _household(client, headers)
        profile = await _child(client, headers, household_id)
        assert profile["ownership_type"] == "guardian_managed"
        links = await client.get(f"/api/v1/profiles/{profile['id']}/guardian-links", headers=headers)
        assert links.status_code == status.HTTP_200_OK
        items = links.json()["data"]["items"]
        assert len(items) == 1
        assert items[0]["kind"] == "product_guardian"
        assert items[0]["verification_status"] == "unverified"

    async def test_self_attested_never_verifies_legal_status(self, client: AsyncClient) -> None:
        headers = await _login(client, "guard-attest@example.com")
        household_id = await _household(client, headers)
        profile = await _child(client, headers, household_id)
        account_id = (await client.get("/api/v1/account", headers=headers)).json()["data"]["account"]["id"]
        assigned = await client.post(
            f"/api/v1/profiles/{profile['id']}/guardian-links",
            headers=headers,
            json={"account_id": account_id, "self_attested": True},
        )
        assert assigned.status_code == status.HTTP_201_CREATED
        assert assigned.json()["data"]["verification_status"] == "unverified"
        preview = await client.get(f"/api/v1/profiles/{profile['id']}/deletion-preview", headers=headers)
        assert preview.json()["data"]["recommended_action"] == "forbidden"
        denied = await client.post(
            f"/api/v1/profiles/{profile['id']}/minor-deletion-requests", headers=headers, json={}
        )
        assert denied.status_code == status.HTTP_403_FORBIDDEN
        assert denied.json()["error_code"] == "LEGAL_GUARDIAN_REQUIRED"

    async def test_unavailable_adapter_stays_pending(self, client: AsyncClient) -> None:
        headers = await _login(client, "guard-pending@example.com")
        household_id = await _household(client, headers)
        profile = await _child(client, headers, household_id)
        started = await client.post(
            f"/api/v1/profiles/{profile['id']}/legal-guardian-verifications",
            headers=headers,
        )
        assert started.status_code == status.HTTP_202_ACCEPTED
        assert started.json()["data"]["kind"] == "legal_representative"
        assert started.json()["data"]["verification_status"] == "pending"
        refreshed = await client.post(
            f"/api/v1/legal-guardian-verifications/{started.json()['data']['id']}/refreshes",
            headers=headers,
        )
        assert refreshed.json()["data"]["verification_status"] == "pending"

    async def test_verified_legal_can_request_deletion_then_trash(
        self, client: AsyncClient, legal_adapter: MemoryLegalGuardianAdapter
    ) -> None:
        headers = await _login(client, "guard-delete@example.com")
        household_id = await _household(client, headers)
        profile = await _child(client, headers, household_id)
        started = await client.post(
            f"/api/v1/profiles/{profile['id']}/legal-guardian-verifications",
            headers=headers,
        )
        link_id = uuid.UUID(started.json()["data"]["id"])
        legal_adapter.outcomes[link_id] = GuardianVerificationStatus.VERIFIED
        refreshed = await client.post(f"/api/v1/legal-guardian-verifications/{link_id}/refreshes", headers=headers)
        assert refreshed.json()["data"]["verification_status"] == "verified"
        preview = await client.get(f"/api/v1/profiles/{profile['id']}/deletion-preview", headers=headers)
        assert preview.json()["data"]["recommended_action"] == "minor_review"
        submitted = await client.post(
            f"/api/v1/profiles/{profile['id']}/minor-deletion-requests",
            headers=headers,
            json={"note": "검토 요청"},
        )
        assert submitted.status_code == status.HTTP_201_CREATED
        assert submitted.json()["data"]["status"] == "submitted"
        duplicate = await client.post(
            f"/api/v1/profiles/{profile['id']}/minor-deletion-requests",
            headers=headers,
            json={},
        )
        assert duplicate.status_code == status.HTTP_409_CONFLICT
        request_id = submitted.json()["data"]["id"]
        approved = await client.post(
            f"/api/v1/minor-deletion-requests/{request_id}/reviews",
            headers=headers,
            json={"decision": "approved", "legal_hold": False},
        )
        assert approved.json()["data"]["status"] == "approved"
        got = await client.get(f"/api/v1/profiles/{profile['id']}", headers=headers)
        assert got.json()["data"]["lifecycle_status"] == "pending_delete"
        assert got.json()["data"]["purge_after"] is not None

    async def test_reject_then_appeal(self, client: AsyncClient, legal_adapter: MemoryLegalGuardianAdapter) -> None:
        headers = await _login(client, "guard-appeal@example.com")
        household_id = await _household(client, headers)
        profile = await _child(client, headers, household_id)
        started = await client.post(
            f"/api/v1/profiles/{profile['id']}/legal-guardian-verifications",
            headers=headers,
        )
        link_id = uuid.UUID(started.json()["data"]["id"])
        legal_adapter.outcomes[link_id] = GuardianVerificationStatus.VERIFIED
        await client.post(f"/api/v1/legal-guardian-verifications/{link_id}/refreshes", headers=headers)
        submitted = await client.post(
            f"/api/v1/profiles/{profile['id']}/minor-deletion-requests",
            headers=headers,
            json={},
        )
        request_id = submitted.json()["data"]["id"]
        rejected = await client.post(
            f"/api/v1/minor-deletion-requests/{request_id}/reviews",
            headers=headers,
            json={"decision": "rejected", "note": "근거 부족"},
        )
        assert rejected.json()["data"]["status"] == "rejected"
        appealed = await client.post(f"/api/v1/minor-deletion-requests/{request_id}/appeals", headers=headers)
        assert appealed.status_code == status.HTTP_202_ACCEPTED
        assert appealed.json()["data"]["status"] == "appealed"

    async def test_product_guardian_can_issue_pin_without_legal(
        self, client: AsyncClient, fake_redis: FakeRedis
    ) -> None:
        master = await _login(client, "guard-pin-master@example.com")
        member = await _login(client, "guard-pin-member@example.com")
        household_id = await _household(client, master)
        profile = await _child(client, master, household_id)
        member_id = await _invite_member(
            client, fake_redis, master, member, household_id, "guard-pin-member@example.com"
        )
        assigned = await client.post(
            f"/api/v1/profiles/{profile['id']}/guardian-links",
            headers=master,
            json={"account_id": member_id, "self_attested": False},
        )
        assert assigned.status_code == status.HTTP_201_CREATED
        issued = await client.post(f"/api/v1/profiles/{profile['id']}/pin-credentials", headers=member)
        assert issued.status_code == status.HTTP_201_CREATED
        outsider = await _login(client, "guard-pin-out@example.com")
        denied = await client.post(f"/api/v1/profiles/{profile['id']}/pin-credentials", headers=outsider)
        assert denied.status_code == status.HTTP_403_FORBIDDEN

    async def test_civil_majority_requires_claim_and_password(self, client: AsyncClient, fake_redis: FakeRedis) -> None:
        master = await _login(client, "guard-adult@example.com")
        member = await _login(client, "guard-adult-self@example.com")
        household_id = await _household(client, master)
        majority_birth = date(date.today().year - CIVIL_MAJORITY_AGE_YEARS - 1, 1, 15).isoformat()
        profile = await _child(client, master, household_id, birth_date=majority_birth)
        got = await client.get(f"/api/v1/profiles/{profile['id']}", headers=master)
        assert got.json()["data"]["adult_transition_pending_at"] is not None
        assert got.json()["data"]["ownership_type"] == "guardian_managed"
        pin = await client.post(f"/api/v1/profiles/{profile['id']}/pin-credentials", headers=master)
        assert pin.status_code == status.HTTP_403_FORBIDDEN
        checkbox = await client.post(
            f"/api/v1/profiles/{profile['id']}/civil-majority-transitions",
            headers=master,
            json={"password": "Password123!"},
        )
        assert checkbox.status_code == status.HTTP_409_CONFLICT
        assert checkbox.json()["error_code"] == "PROFILE_CLAIM_REQUIRED"

        await _claim_profile(
            client, fake_redis, master, member, household_id, "guard-adult-self@example.com", profile["id"]
        )
        too_young_api = await client.post(
            f"/api/v1/profiles/{profile['id']}/civil-majority-transitions",
            headers=member,
            json={"password": "WrongPass1!"},
        )
        assert too_young_api.status_code == status.HTTP_401_UNAUTHORIZED
        moved = await client.post(
            f"/api/v1/profiles/{profile['id']}/civil-majority-transitions",
            headers=member,
            json={"password": "Password123!"},
        )
        assert moved.status_code == status.HTTP_201_CREATED
        data = moved.json()["data"]
        assert data["adult_transitioned_at"] is not None
        assert data["adult_transition_pending_at"] is None
        assert data["ownership_type"] == "claimed_adult"
        patch = await client.patch(
            f"/api/v1/profiles/{profile['id']}",
            headers=member,
            json={"relationship": "자녀"},
        )
        assert patch.json()["data"]["ownership_type"] == "claimed_adult"
        master_id = (await client.get("/api/v1/account", headers=master)).json()["data"]["account"]["id"]
        reapproved = await client.post(
            f"/api/v1/profiles/{profile['id']}/guardian-share-reapprovals",
            headers=member,
            json={"account_id": master_id, "password": "Password123!"},
        )
        assert reapproved.status_code == status.HTTP_201_CREATED

    async def test_privacy_self_determination_is_not_civil_majority(
        self, client: AsyncClient, fake_redis: FakeRedis
    ) -> None:
        master = await _login(client, "guard-privacy@example.com")
        member = await _login(client, "guard-privacy-self@example.com")
        household_id = await _household(client, master)
        privacy_birth = date(date.today().year - PRIVACY_SELF_DETERMINATION_AGE_YEARS - 1, 6, 1).isoformat()
        profile = await _child(client, master, household_id, birth_date=privacy_birth)
        await _claim_profile(
            client, fake_redis, master, member, household_id, "guard-privacy-self@example.com", profile["id"]
        )
        marked = await client.post(
            f"/api/v1/profiles/{profile['id']}/privacy-self-determinations",
            headers=member,
            json={"password": "Password123!"},
        )
        assert marked.status_code == status.HTTP_201_CREATED
        data = marked.json()["data"]
        assert data["privacy_self_determined_at"] is not None
        assert data["adult_transitioned_at"] is None
        assert data["ownership_type"] == "guardian_managed"
        civil = await client.post(
            f"/api/v1/profiles/{profile['id']}/civil-majority-transitions",
            headers=member,
            json={"password": "Password123!"},
        )
        assert civil.status_code == status.HTTP_409_CONFLICT

    async def test_birth_date_correction_is_audited_and_does_not_complete_majority(self, client: AsyncClient) -> None:
        headers = await _login(client, "guard-birth@example.com")
        household_id = await _household(client, headers)
        profile = await _child(client, headers, household_id, birth_date="2020-01-15")
        rec = await client.post(
            "/api/v1/health-records",
            headers=headers,
            json={
                "profile_id": profile["id"],
                "record_type": "blood_pressure",
                "recorded_at": "2026-09-01T00:00:00Z",
                "source": "manual",
                "payload": {"systolic": 110, "diastolic": 70},
            },
        )
        assert rec.status_code == status.HTTP_201_CREATED
        majority_birth = date(date.today().year - CIVIL_MAJORITY_AGE_YEARS - 1, 1, 15).isoformat()
        corrected = await client.post(
            f"/api/v1/profiles/{profile['id']}/birth-date-corrections",
            headers=headers,
            json={"birth_date": majority_birth, "reason": "입력 오류"},
        )
        assert corrected.status_code == status.HTTP_201_CREATED
        assert corrected.json()["data"]["previous_birth_date"] == "2020-01-15"
        got = await client.get(f"/api/v1/profiles/{profile['id']}", headers=headers)
        assert got.json()["data"]["adult_transition_pending_at"] is not None
        assert got.json()["data"]["adult_transitioned_at"] is None
        kept = await client.get(f"/api/v1/health-records/{rec.json()['data']['id']}", headers=headers)
        assert kept.status_code == status.HTTP_403_FORBIDDEN

    async def test_adult_transition_blocked_before_majority(self, client: AsyncClient) -> None:
        headers = await _login(client, "guard-young@example.com")
        household_id = await _household(client, headers)
        profile = await _child(client, headers, household_id, birth_date="2020-01-15")
        denied = await client.post(
            f"/api/v1/profiles/{profile['id']}/civil-majority-transitions",
            headers=headers,
            json={"password": "Password123!"},
        )
        assert denied.status_code == status.HTTP_409_CONFLICT
        assert denied.json()["error_code"] == "ADULT_TRANSITION_NOT_DUE"

    async def test_guardian_cannot_expand_own_share_and_ops_can_invalidate(
        self, client: AsyncClient, fake_redis: FakeRedis, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        master = await _login(client, "guard-ops-master@example.com")
        member = await _login(client, "guard-ops-self@example.com")
        household_id = await _household(client, master)
        majority_birth = date(date.today().year - CIVIL_MAJORITY_AGE_YEARS - 1, 1, 15).isoformat()
        profile = await _child(client, master, household_id, birth_date=majority_birth)
        await _claim_profile(
            client, fake_redis, master, member, household_id, "guard-ops-self@example.com", profile["id"]
        )
        moved = await client.post(
            f"/api/v1/profiles/{profile['id']}/civil-majority-transitions",
            headers=member,
            json={"password": "Password123!"},
        )
        assert moved.status_code == status.HTTP_201_CREATED
        master_id = (await client.get("/api/v1/account", headers=master)).json()["data"]["account"]["id"]
        stolen = await client.post(
            f"/api/v1/profiles/{profile['id']}/guardian-share-reapprovals",
            headers=master,
            json={
                "account_id": master_id,
                "password": "Password123!",
                "capabilities": ["view_sensitive_records", "write_sensitive_records"],
            },
        )
        assert stolen.status_code == status.HTTP_403_FORBIDDEN
        from app.core import config as app_config

        monkeypatch.setattr(app_config, "OPS_RECOVERY_ENABLED", True)
        monkeypatch.setattr(app_config, "OPS_CIVIL_MAJORITY_RECOVERY_KEY", "ops-test-key")
        payload = {
            "profile_id": profile["id"],
            "reason": "생년월일 오입력",
            "operator_id": "ops-oncall",
            "ticket_ref": "INC-194-1",
            "previous_birth_date": majority_birth,
            "new_birth_date": "2020-01-15",
            "idempotency_key": "ops-inv-1",
        }
        denied_master = await client.post(
            "/api/v1/ops/civil-majority-invalidations",
            headers=master,
            json=payload,
        )
        assert denied_master.status_code == status.HTTP_403_FORBIDDEN
        first = await client.post(
            "/api/v1/ops/civil-majority-invalidations",
            headers={"X-Ops-Recovery-Key": "ops-test-key"},
            json=payload,
        )
        assert first.status_code == status.HTTP_201_CREATED
        assert first.json()["data"]["review_status"] == "invalidated"
        second = await client.post(
            "/api/v1/ops/civil-majority-invalidations",
            headers={"X-Ops-Recovery-Key": "ops-test-key"},
            json=payload,
        )
        assert second.status_code == status.HTTP_201_CREATED
        assert second.json()["data"]["id"] == first.json()["data"]["id"]
        got = await client.get(f"/api/v1/profiles/{profile['id']}", headers=member)
        assert got.json()["data"]["adult_transitioned_at"] is None
        from app.core.config import Env

        monkeypatch.setattr(app_config, "ENV", Env.PROD)
        monkeypatch.setattr(app_config, "OPS_RECOVERY_ENABLED", True)
        prod_closed = await client.post(
            "/api/v1/ops/civil-majority-invalidations",
            headers={"X-Ops-Recovery-Key": "ops-test-key"},
            json={**payload, "idempotency_key": "ops-inv-prod"},
        )
        assert prod_closed.status_code == status.HTTP_403_FORBIDDEN
        assert prod_closed.json()["error_code"] == "OPS_RECOVERY_FORBIDDEN"
