from httpx import AsyncClient
from starlette import status


async def _login(client: AsyncClient, email: str) -> dict[str, str]:
    await client.post("/api/v1/auth/signup", json={"email": email, "password": "Password123!"})
    response = await client.post("/api/v1/auth/login", json={"email": email, "password": "Password123!"})
    return {"Authorization": f"Bearer {response.json()['data']['access_token']}"}


async def _create_household(client: AsyncClient, headers: dict[str, str]) -> str:
    response = await client.post("/api/v1/households", headers=headers)
    assert response.status_code == status.HTTP_201_CREATED
    return response.json()["data"]["id"]


class TestProfileOwnershipAPIs:
    async def test_create_defaults_local_slot_adult_member(self, client: AsyncClient) -> None:
        headers = await _login(client, "own-default@example.com")
        household_id = await _create_household(client, headers)
        created = await client.post(
            "/api/v1/profiles",
            headers=headers,
            json={"household_id": household_id, "display_name": "본인", "relationship": "self"},
        )
        assert created.status_code == status.HTTP_201_CREATED
        data = created.json()["data"]
        assert data["ownership_type"] == "local_slot"
        assert data["lifecycle_status"] == "active"
        assert data["member_role"] == "adult_member"

    async def test_child_relationship_is_guardian_managed_self_only(self, client: AsyncClient) -> None:
        headers = await _login(client, "own-child@example.com")
        household_id = await _create_household(client, headers)
        created = await client.post(
            "/api/v1/profiles",
            headers=headers,
            json={
                "household_id": household_id,
                "display_name": "아이",
                "relationship": "자녀",
                "birth_date": "2020-03-01",
            },
        )
        data = created.json()["data"]
        assert data["ownership_type"] == "guardian_managed"
        assert data["member_role"] == "self_only"
        forbidden = await client.patch(
            f"/api/v1/profiles/{data['id']}",
            headers=headers,
            json={"status": "deleted"},
        )
        assert forbidden.status_code == status.HTTP_403_FORBIDDEN
        assert forbidden.json()["error_code"] == "PROFILE_ACCESS_DENIED"

    async def test_master_cannot_purge_claimed_adult_but_can_hide(self, client: AsyncClient) -> None:
        master = await _login(client, "own-master@example.com")
        adult = await _login(client, "own-adult@example.com")
        household_id = await _create_household(client, master)
        created = await client.post(
            "/api/v1/profiles",
            headers=adult,
            json={
                "household_id": household_id,
                "display_name": "배우자",
                "relationship": "배우자",
                "account_email": "own-adult@example.com",
            },
        )
        # 성인은 아직 이 집 멤버가 아니면 403. 마스터가 이메일을 붙여 슬롯만 만든다.
        assert created.status_code == status.HTTP_403_FORBIDDEN
        slot = await client.post(
            "/api/v1/profiles",
            headers=master,
            json={
                "household_id": household_id,
                "display_name": "배우자",
                "relationship": "배우자",
                "account_email": "own-adult@example.com",
            },
        )
        assert slot.status_code == status.HTTP_201_CREATED
        profile_id = slot.json()["data"]["id"]
        assert slot.json()["data"]["ownership_type"] == "claimed_adult"

        purge = await client.patch(
            f"/api/v1/profiles/{profile_id}",
            headers=master,
            json={"status": "deleted"},
        )
        assert purge.status_code == status.HTTP_403_FORBIDDEN
        assert purge.json()["error_code"] == "PROFILE_ACCESS_DENIED"

        hidden = await client.delete(f"/api/v1/profiles/{profile_id}", headers=master)
        assert hidden.status_code == status.HTTP_200_OK
        listed = await client.get(f"/api/v1/profiles?household_id={household_id}", headers=master)
        assert listed.json()["data"]["items"] == []

    async def test_cross_household_profile_id_is_blocked(self, client: AsyncClient) -> None:
        alice = await _login(client, "own-alice@example.com")
        bob = await _login(client, "own-bob@example.com")
        alice_hh = await _create_household(client, alice)
        await _create_household(client, bob)
        created = await client.post(
            "/api/v1/profiles",
            headers=alice,
            json={"household_id": alice_hh, "display_name": "Alice", "relationship": "self"},
        )
        profile_id = created.json()["data"]["id"]

        got = await client.get(f"/api/v1/profiles/{profile_id}", headers=bob)
        assert got.status_code == status.HTTP_403_FORBIDDEN
        assert got.json()["error_code"] == "HOUSEHOLD_MEMBERSHIP_REQUIRED"

        rec = await client.post(
            "/api/v1/health-records",
            headers=bob,
            json={
                "profile_id": profile_id,
                "record_type": "blood_pressure",
                "recorded_at": "2026-09-19T00:00:00Z",
                "source": "manual",
                "payload": {"systolic": 120, "diastolic": 80},
            },
        )
        assert rec.status_code == status.HTTP_403_FORBIDDEN
        assert rec.json()["error_code"] in {"HOUSEHOLD_MEMBERSHIP_REQUIRED", "PROFILE_ACCESS_DENIED"}

    async def test_relationship_change_updates_member_role(self, client: AsyncClient) -> None:
        headers = await _login(client, "own-role@example.com")
        household_id = await _create_household(client, headers)
        created = await client.post(
            "/api/v1/profiles",
            headers=headers,
            json={"household_id": household_id, "display_name": "가족", "relationship": "형제"},
        )
        profile_id = created.json()["data"]["id"]
        assert created.json()["data"]["member_role"] == "adult_member"
        updated = await client.patch(
            f"/api/v1/profiles/{profile_id}",
            headers=headers,
            json={"relationship": "자녀"},
        )
        assert updated.status_code == status.HTTP_200_OK
        assert updated.json()["data"]["member_role"] == "self_only"
        assert updated.json()["data"]["ownership_type"] == "guardian_managed"

    async def test_stale_if_match_is_version_mismatch(self, client: AsyncClient) -> None:
        headers = await _login(client, "own-version@example.com")
        household_id = await _create_household(client, headers)
        created = await client.post(
            "/api/v1/profiles",
            headers=headers,
            json={"household_id": household_id, "display_name": "버전", "relationship": "self"},
        )
        profile_id = created.json()["data"]["id"]
        stale = await client.patch(
            f"/api/v1/profiles/{profile_id}",
            headers={**headers, "If-Match": '"99"'},
            json={"display_name": "실패"},
        )
        assert stale.status_code == status.HTTP_412_PRECONDITION_FAILED
        assert stale.json()["error_code"] == "VERSION_MISMATCH"
