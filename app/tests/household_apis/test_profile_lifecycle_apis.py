from datetime import datetime, timedelta, timezone

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from starlette import status

from app.models.profiles import FamilyProfile, LifecycleStatus


async def _login(client: AsyncClient, email: str) -> dict[str, str]:
    await client.post("/api/v1/auth/signup", json={"email": email, "password": "Password123!"})
    response = await client.post("/api/v1/auth/login", json={"email": email, "password": "Password123!"})
    return {"Authorization": f"Bearer {response.json()['data']['access_token']}"}


async def _household(client: AsyncClient, headers: dict[str, str]) -> str:
    created = await client.post("/api/v1/households", headers=headers)
    return created.json()["data"]["id"]


async def _slot(
    client: AsyncClient, headers: dict[str, str], household_id: str, *, name: str = "슬롯", relationship: str = "배우자"
) -> dict:
    created = await client.post(
        "/api/v1/profiles",
        headers=headers,
        json={"household_id": household_id, "display_name": name, "relationship": relationship},
    )
    assert created.status_code == status.HTTP_201_CREATED
    return created.json()["data"]


class TestProfileLifecycleAPIs:
    async def test_hide_keeps_membership_and_records_off_the_wall(self, client: AsyncClient) -> None:
        headers = await _login(client, "life-hide@example.com")
        household_id = await _household(client, headers)
        profile = await _slot(client, headers, household_id, name="숨김대상")
        hidden = await client.patch(
            f"/api/v1/profiles/{profile['id']}",
            headers=headers,
            json={"status": "hidden"},
        )
        assert hidden.status_code == status.HTTP_200_OK
        assert hidden.json()["data"]["lifecycle_status"] == "hidden"
        listed = await client.get(f"/api/v1/profiles?household_id={household_id}", headers=headers)
        assert listed.json()["data"]["items"] == []
        got = await client.get(f"/api/v1/profiles/{profile['id']}", headers=headers)
        assert got.status_code == status.HTTP_200_OK
        memberships = await client.get(f"/api/v1/households/{household_id}/memberships", headers=headers)
        assert memberships.json()["data"]["items"][0]["status"] == "active"

    async def test_archive_and_restore(self, client: AsyncClient) -> None:
        headers = await _login(client, "life-archive@example.com")
        household_id = await _household(client, headers)
        profile = await _slot(client, headers, household_id, name="보관대상")
        archived = await client.post(f"/api/v1/profiles/{profile['id']}/archives", headers=headers)
        assert archived.status_code == status.HTTP_201_CREATED
        assert archived.json()["data"]["lifecycle_status"] == "archived"
        listed = await client.get(f"/api/v1/profiles?household_id={household_id}", headers=headers)
        assert listed.json()["data"]["items"] == []
        restored = await client.post(f"/api/v1/profiles/{profile['id']}/restorations", headers=headers)
        assert restored.status_code == status.HTTP_201_CREATED
        assert restored.json()["data"]["lifecycle_status"] == "active"
        listed = await client.get(f"/api/v1/profiles?household_id={household_id}", headers=headers)
        assert listed.json()["data"]["items"][0]["id"] == profile["id"]

    async def test_empty_slot_is_purged_immediately(self, client: AsyncClient) -> None:
        headers = await _login(client, "life-empty@example.com")
        household_id = await _household(client, headers)
        profile = await _slot(client, headers, household_id, name="빈슬롯")
        preview = await client.get(f"/api/v1/profiles/{profile['id']}/deletion-preview", headers=headers)
        assert preview.json()["data"]["recommended_action"] == "purge_empty"
        deleted = await client.post(f"/api/v1/profiles/{profile['id']}/deletion-requests", headers=headers)
        assert deleted.status_code == status.HTTP_204_NO_CONTENT
        missing = await client.get(f"/api/v1/profiles/{profile['id']}", headers=headers)
        assert missing.status_code == status.HTTP_404_NOT_FOUND

    async def test_records_go_to_trash_and_restore(self, client: AsyncClient) -> None:
        headers = await _login(client, "life-trash@example.com")
        household_id = await _household(client, headers)
        profile = await _slot(client, headers, household_id, name="기록슬롯")
        rec = await client.post(
            "/api/v1/health-records",
            headers=headers,
            json={
                "profile_id": profile["id"],
                "record_type": "blood_pressure",
                "recorded_at": "2026-09-01T00:00:00Z",
                "source": "manual",
                "payload": {"systolic": 120, "diastolic": 80},
            },
        )
        assert rec.status_code == status.HTTP_201_CREATED
        preview = await client.get(f"/api/v1/profiles/{profile['id']}/deletion-preview", headers=headers)
        assert preview.json()["data"]["record_count"] == 1
        assert preview.json()["data"]["recommended_action"] == "trash"
        assert "내보내기" in preview.json()["data"]["backup_hint"]
        queued = await client.post(f"/api/v1/profiles/{profile['id']}/deletion-requests", headers=headers)
        assert queued.status_code == status.HTTP_202_ACCEPTED
        assert queued.json()["data"]["lifecycle_status"] == "pending_delete"
        kept = await client.get(f"/api/v1/health-records/{rec.json()['data']['id']}", headers=headers)
        assert kept.status_code == status.HTTP_200_OK
        restored = await client.post(f"/api/v1/profiles/{profile['id']}/restorations", headers=headers)
        assert restored.json()["data"]["lifecycle_status"] == "active"
        assert restored.json()["data"]["purge_after"] is None

    async def test_guardian_managed_cannot_be_deleted(self, client: AsyncClient) -> None:
        headers = await _login(client, "life-child@example.com")
        household_id = await _household(client, headers)
        profile = await _slot(client, headers, household_id, name="아이", relationship="자녀")
        preview = await client.get(f"/api/v1/profiles/{profile['id']}/deletion-preview", headers=headers)
        assert preview.json()["data"]["recommended_action"] == "forbidden"
        denied = await client.post(f"/api/v1/profiles/{profile['id']}/deletion-requests", headers=headers)
        assert denied.status_code == status.HTTP_403_FORBIDDEN

    async def test_purge_job_is_idempotent(self, client: AsyncClient, db_session: AsyncSession) -> None:
        headers = await _login(client, "life-purge@example.com")
        household_id = await _household(client, headers)
        profile = await _slot(client, headers, household_id, name="파기대상")
        rec = await client.post(
            "/api/v1/health-records",
            headers=headers,
            json={
                "profile_id": profile["id"],
                "record_type": "blood_pressure",
                "recorded_at": "2026-09-01T00:00:00Z",
                "source": "manual",
                "payload": {"systolic": 118, "diastolic": 76},
            },
        )
        assert rec.status_code == status.HTTP_201_CREATED
        queued = await client.post(f"/api/v1/profiles/{profile['id']}/deletion-requests", headers=headers)
        assert queued.status_code == status.HTTP_202_ACCEPTED
        row = await db_session.get(FamilyProfile, profile["id"])
        assert row is not None
        row.purge_after = datetime.now(tz=timezone.utc) - timedelta(days=1)
        row.lifecycle_status = LifecycleStatus.PENDING_DELETE
        await db_session.commit()

        first = await client.post("/api/v1/profile-purge-jobs", headers=headers)
        assert first.status_code == status.HTTP_202_ACCEPTED
        assert first.json()["data"]["purged_count"] == 1
        second = await client.post("/api/v1/profile-purge-jobs", headers=headers)
        assert second.json()["data"]["purged_count"] == 0
        missing = await client.get(f"/api/v1/profiles/{profile['id']}", headers=headers)
        assert missing.status_code == status.HTTP_404_NOT_FOUND

    async def test_purge_job_skips_legal_hold(self, client: AsyncClient, db_session: AsyncSession) -> None:
        headers = await _login(client, "life-hold@example.com")
        household_id = await _household(client, headers)
        profile = await _slot(client, headers, household_id, name="보류대상")
        rec = await client.post(
            "/api/v1/health-records",
            headers=headers,
            json={
                "profile_id": profile["id"],
                "record_type": "blood_pressure",
                "recorded_at": "2026-09-01T00:00:00Z",
                "source": "manual",
                "payload": {"systolic": 118, "diastolic": 76},
            },
        )
        assert rec.status_code == status.HTTP_201_CREATED
        queued = await client.post(f"/api/v1/profiles/{profile['id']}/deletion-requests", headers=headers)
        assert queued.status_code == status.HTTP_202_ACCEPTED
        row = await db_session.get(FamilyProfile, profile["id"])
        assert row is not None
        row.purge_after = datetime.now(tz=timezone.utc) - timedelta(days=1)
        row.purge_hold_reason = "legal_hold"
        await db_session.commit()
        held = await client.post("/api/v1/profile-purge-jobs", headers=headers)
        assert held.status_code == status.HTTP_202_ACCEPTED
        assert held.json()["data"]["purged_count"] == 0
        assert held.json()["data"]["skipped_count"] >= 1
        kept = await client.get(f"/api/v1/profiles/{profile['id']}", headers=headers)
        assert kept.status_code == status.HTTP_200_OK
