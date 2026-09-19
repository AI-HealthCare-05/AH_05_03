import secrets
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import status
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.household_devices import HouseholdDevicePairing


async def _login(client: AsyncClient, email: str) -> dict[str, str]:
    await client.post("/api/v1/auth/signup", json={"email": email, "password": "Password123!"})
    response = await client.post("/api/v1/auth/login", json={"email": email, "password": "Password123!"})
    return {"Authorization": f"Bearer {response.json()['data']['access_token']}"}


async def _household(client: AsyncClient, headers: dict[str, str]) -> str:
    response = await client.post("/api/v1/households", headers=headers)
    return response.json()["data"]["id"]


def _device_ref() -> str:
    return secrets.token_urlsafe(32)


class TestHouseholdDeviceAPIs:
    async def test_pin_cannot_create_pairing(self, client: AsyncClient) -> None:
        headers = await _login(client, "wall-master@example.com")
        household_id = await _household(client, headers)
        denied = await client.post(
            f"/api/v1/households/{household_id}/device-pairings",
            headers=headers,
            json={"password": "000000"},
        )
        assert denied.status_code == status.HTTP_401_UNAUTHORIZED
        assert denied.json()["error_code"] == "CREDENTIALS_INVALID"

    async def test_claim_list_revoke_and_block_token(self, client: AsyncClient) -> None:
        headers = await _login(client, "wall-claim@example.com")
        household_id = await _household(client, headers)
        pairing = await client.post(
            f"/api/v1/households/{household_id}/device-pairings",
            headers=headers,
            json={"password": "Password123!"},
        )
        assert pairing.status_code == status.HTTP_201_CREATED
        assert pairing.headers["location"].startswith(f"/api/v1/households/{household_id}/device-pairings/")
        code = pairing.json()["data"]["code"]
        assert len(code) == 8

        claimed = await client.post(
            "/api/v1/household-devices",
            json={
                "pairing_code": code,
                "household_id": household_id,
                "display_name": "거실 벽",
                "device_ref": _device_ref(),
            },
        )
        assert claimed.status_code == status.HTTP_201_CREATED
        token = claimed.json()["data"]["device_token"]
        device_id = claimed.json()["data"]["id"]
        device_headers = {"Authorization": f"Bearer {token}"}

        overview = await client.get("/api/v1/household-devices/me/profiles", headers=device_headers)
        assert overview.status_code == status.HTTP_200_OK
        assert overview.json()["data"]["household_id"] == household_id

        reuse = await client.post(
            "/api/v1/household-devices",
            json={
                "pairing_code": code,
                "household_id": household_id,
                "display_name": "다른 벽",
                "device_ref": _device_ref(),
            },
        )
        assert reuse.status_code == status.HTTP_409_CONFLICT
        assert reuse.json()["error_code"] == "PAIRING_CONSUMED"

        listed = await client.get(f"/api/v1/households/{household_id}/devices", headers=headers)
        assert listed.status_code == status.HTTP_200_OK
        assert listed.json()["data"]["items"][0]["display_name"] == "거실 벽"
        assert "device_token" not in listed.json()["data"]["items"][0]

        revoked = await client.request(
            "DELETE",
            f"/api/v1/households/{household_id}/devices/{device_id}",
            headers=headers,
            json={"password": "Password123!"},
        )
        assert revoked.status_code == status.HTTP_204_NO_CONTENT

        blocked = await client.get("/api/v1/household-devices/me/profiles", headers=device_headers)
        assert blocked.status_code == status.HTTP_403_FORBIDDEN
        assert blocked.json()["error_code"] == "DEVICE_REVOKED"

    async def test_expired_and_cross_household_pairing(self, client: AsyncClient, db_session: AsyncSession) -> None:
        alice = await _login(client, "wall-alice@example.com")
        bob = await _login(client, "wall-bob@example.com")
        alice_hh = await _household(client, alice)
        bob_hh = await _household(client, bob)

        pairing = await client.post(
            f"/api/v1/households/{alice_hh}/device-pairings",
            headers=alice,
            json={"password": "Password123!"},
        )
        code = pairing.json()["data"]["code"]
        pairing_id = pairing.json()["data"]["pairing_id"]

        cross = await client.post(
            "/api/v1/household-devices",
            json={
                "pairing_code": code,
                "household_id": bob_hh,
                "display_name": "침입",
                "device_ref": _device_ref(),
            },
        )
        assert cross.status_code == status.HTTP_404_NOT_FOUND
        assert cross.json()["error_code"] == "PAIRING_NOT_FOUND"

        row = await db_session.get(HouseholdDevicePairing, UUID(pairing_id))
        assert row is not None
        row.expires_at = datetime.now(tz=timezone.utc) - timedelta(seconds=1)
        await db_session.commit()

        expired = await client.post(
            "/api/v1/household-devices",
            json={
                "pairing_code": code,
                "household_id": alice_hh,
                "display_name": "늦은 벽",
                "device_ref": _device_ref(),
            },
        )
        assert expired.status_code == status.HTTP_410_GONE
        assert expired.json()["error_code"] == "PAIRING_EXPIRED"

    async def test_unregistered_device_cannot_run_pin_challenge(self, client: AsyncClient) -> None:
        missing = await client.post(
            "/api/v1/household-devices/me/pin-challenges",
            json={"profile_id": "11111111-1111-1111-1111-111111111111"},
        )
        assert missing.status_code == status.HTTP_401_UNAUTHORIZED

        headers = await _login(client, "wall-pin@example.com")
        household_id = await _household(client, headers)
        profile = await client.post(
            "/api/v1/profiles",
            headers=headers,
            json={"household_id": household_id, "display_name": "벽", "relationship": "self"},
        )
        profile_id = profile.json()["data"]["id"]
        pairing = await client.post(
            f"/api/v1/households/{household_id}/device-pairings",
            headers=headers,
            json={"password": "Password123!"},
        )
        claimed = await client.post(
            "/api/v1/household-devices",
            json={
                "pairing_code": pairing.json()["data"]["code"],
                "household_id": household_id,
                "display_name": "거실",
                "device_ref": _device_ref(),
            },
        )
        token = claimed.json()["data"]["device_token"]
        allowed = await client.post(
            "/api/v1/household-devices/me/pin-challenges",
            headers={"Authorization": f"Bearer {token}"},
            json={"profile_id": profile_id},
        )
        assert allowed.status_code == status.HTTP_204_NO_CONTENT

        other = await _login(client, "wall-other@example.com")
        other_hh = await _household(client, other)
        foreign = await client.post(
            "/api/v1/profiles",
            headers=other,
            json={"household_id": other_hh, "display_name": "남", "relationship": "self"},
        )
        denied = await client.post(
            "/api/v1/household-devices/me/pin-challenges",
            headers={"Authorization": f"Bearer {token}"},
            json={"profile_id": foreign.json()["data"]["id"]},
        )
        assert denied.status_code == status.HTTP_404_NOT_FOUND

    async def test_member_cannot_issue_pairing(self, client: AsyncClient) -> None:
        # 마스터가 아닌 계정은 자기 집만 만들 수 있으므로 다른 집 페어링은 마스터 검사에서 막힌다.
        master = await _login(client, "wall-owner@example.com")
        stranger = await _login(client, "wall-stranger@example.com")
        household_id = await _household(client, master)
        denied = await client.post(
            f"/api/v1/households/{household_id}/device-pairings",
            headers=stranger,
            json={"password": "Password123!"},
        )
        assert denied.status_code == status.HTTP_403_FORBIDDEN
        assert denied.json()["error_code"] == "HOUSEHOLD_MASTER_REQUIRED"
