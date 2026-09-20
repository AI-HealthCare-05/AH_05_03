import asyncio
import secrets

from httpx import AsyncClient
from starlette import status


async def _login(client: AsyncClient, email: str, password: str = "Password123!") -> dict[str, str]:
    await client.post("/api/v1/auth/signup", json={"email": email, "password": password})
    response = await client.post("/api/v1/auth/login", json={"email": email, "password": password})
    return {"Authorization": f"Bearer {response.json()['data']['access_token']}"}


async def _household_and_profile(client: AsyncClient, headers: dict[str, str], name: str = "자녀") -> tuple[str, str]:
    household_id = (await client.post("/api/v1/households", headers=headers)).json()["data"]["id"]
    profile = await client.post(
        "/api/v1/profiles",
        headers=headers,
        json={"household_id": household_id, "display_name": name, "relationship": "자녀", "birth_date": "2018-01-01"},
    )
    return household_id, profile.json()["data"]["id"]


def _device_ref() -> str:
    return secrets.token_urlsafe(32)


class TestAccountSecurityGate:
    async def test_login_failure_is_audited_without_password(self, client: AsyncClient) -> None:
        headers = await _login(client, "gate-login@example.com")
        household_id, _ = await _household_and_profile(client, headers)
        denied = await client.post(
            "/api/v1/auth/login", json={"email": "gate-login@example.com", "password": "WrongPass1!"}
        )
        assert denied.status_code == status.HTTP_401_UNAUTHORIZED
        ok = await client.post(
            "/api/v1/auth/login", json={"email": "gate-login@example.com", "password": "Password123!"}
        )
        assert ok.status_code == status.HTTP_200_OK
        listed = await client.get(f"/api/v1/households/{household_id}/audit-events", headers=headers)
        assert listed.status_code == status.HTTP_200_OK
        body = listed.text
        assert "WrongPass1!" not in body
        assert "Password123!" not in body
        types = {item["event_type"] for item in listed.json()["data"]["items"]}
        assert "auth.login_failed" in types
        assert "auth.login_succeeded" in types

    async def test_pin_lock_alert_and_audit_never_echo_pin(self, client: AsyncClient) -> None:
        headers = await _login(client, "gate-pin@example.com")
        household_id, profile_id = await _household_and_profile(client, headers)
        issued = await client.post(f"/api/v1/profiles/{profile_id}/pin-credentials", headers=headers)
        pin = issued.json()["data"]["temporary_pin"]
        for _ in range(5):
            await client.post(
                f"/api/v1/profiles/{profile_id}/member-sessions",
                headers=headers,
                json={"pin": "111111" if pin != "111111" else "222222"},
            )
        alerts = await client.get(f"/api/v1/households/{household_id}/pin-lock-alerts", headers=headers)
        assert alerts.status_code == status.HTTP_200_OK
        items = alerts.json()["data"]["items"]
        assert len(items) == 1
        assert pin not in alerts.text
        ack = await client.post(
            f"/api/v1/households/{household_id}/pin-lock-alerts/{items[0]['id']}/acknowledgements",
            headers=headers,
        )
        assert ack.status_code == status.HTTP_201_CREATED
        assert ack.headers["location"].endswith("/acknowledgements")
        empty = await client.get(f"/api/v1/households/{household_id}/pin-lock-alerts", headers=headers)
        assert empty.json()["data"]["items"] == []
        listed = await client.get(f"/api/v1/households/{household_id}/audit-events", headers=headers)
        assert pin not in listed.text
        assert "pin_hash" not in listed.text

    async def test_idor_and_privilege_escalation_are_denied(self, client: AsyncClient) -> None:
        alice = await _login(client, "gate-alice@example.com")
        bob = await _login(client, "gate-bob@example.com")
        alice_hh, alice_profile = await _household_and_profile(client, alice, "앨리스자녀")
        bob_hh, bob_profile = await _household_and_profile(client, bob, "밥자녀")

        stolen_profile = await client.get(f"/api/v1/profiles/{bob_profile}", headers=alice)
        assert stolen_profile.status_code in (status.HTTP_403_FORBIDDEN, status.HTTP_404_NOT_FOUND)

        stolen_audit = await client.get(f"/api/v1/households/{bob_hh}/audit-events", headers=alice)
        assert stolen_audit.status_code in (status.HTTP_403_FORBIDDEN, status.HTTP_404_NOT_FOUND)

        pairing = await client.post(
            f"/api/v1/households/{alice_hh}/device-pairings",
            headers=alice,
            json={"password": "000000"},
        )
        assert pairing.status_code == status.HTTP_401_UNAUTHORIZED

        emergency = await client.post(
            f"/api/v1/households/{alice_hh}/emergency-device-revocations",
            headers=bob,
            json={"password": "Password123!"},
        )
        assert emergency.status_code in (status.HTTP_403_FORBIDDEN, status.HTTP_404_NOT_FOUND)

        record = await client.post(
            "/api/v1/health-records",
            headers=bob,
            json={
                "profile_id": alice_profile,
                "record_type": "note",
                "recorded_at": "2026-09-19T00:00:00+00:00",
                "payload": {"note": "침입"},
            },
        )
        assert record.status_code in (status.HTTP_403_FORBIDDEN, status.HTTP_404_NOT_FOUND)

    async def test_pairing_replay_and_revoke_beats_next_request(self, client: AsyncClient) -> None:
        headers = await _login(client, "gate-replay@example.com")
        household_id, _ = await _household_and_profile(client, headers)
        pairing = await client.post(
            f"/api/v1/households/{household_id}/device-pairings",
            headers=headers,
            json={"password": "Password123!"},
        )
        code = pairing.json()["data"]["code"]
        claimed = await client.post(
            "/api/v1/household-devices",
            json={
                "pairing_code": code,
                "household_id": household_id,
                "display_name": "거실",
                "device_ref": _device_ref(),
            },
        )
        token = claimed.json()["data"]["device_token"]
        device_id = claimed.json()["data"]["id"]
        replay = await client.post(
            "/api/v1/household-devices",
            json={
                "pairing_code": code,
                "household_id": household_id,
                "display_name": "재사용",
                "device_ref": _device_ref(),
            },
        )
        assert replay.status_code == status.HTTP_409_CONFLICT

        device_headers = {"Authorization": f"Bearer {token}"}
        ok = await client.get("/api/v1/household-devices/me/profiles", headers=device_headers)
        assert ok.status_code == status.HTTP_200_OK

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

        second = await client.post(
            f"/api/v1/households/{household_id}/device-pairings",
            headers=headers,
            json={"password": "Password123!"},
        )
        claimed_two = await client.post(
            "/api/v1/household-devices",
            json={
                "pairing_code": second.json()["data"]["code"],
                "household_id": household_id,
                "display_name": "서재",
                "device_ref": _device_ref(),
            },
        )
        token_two = claimed_two.json()["data"]["device_token"]
        emergency = await client.post(
            f"/api/v1/households/{household_id}/emergency-device-revocations",
            headers=headers,
            json={"password": "Password123!"},
        )
        assert emergency.status_code == status.HTTP_201_CREATED
        assert emergency.json()["data"]["revoked_device_count"] >= 1
        dead = await client.get(
            "/api/v1/household-devices/me/profiles",
            headers={"Authorization": f"Bearer {token_two}"},
        )
        assert dead.status_code == status.HTTP_403_FORBIDDEN
        assert dead.json()["error_code"] == "DEVICE_REVOKED"

        events = await client.get(
            f"/api/v1/households/{household_id}/audit-events?event_type=household_device.emergency_revoked",
            headers=headers,
        )
        assert events.json()["data"]["items"][0]["event_type"] == "household_device.emergency_revoked"

        again = await client.post(
            f"/api/v1/households/{household_id}/emergency-device-revocations",
            headers=headers,
            json={"password": "Password123!"},
        )
        assert again.status_code == status.HTTP_201_CREATED
        assert again.json()["data"]["revoked_device_count"] == 0

    async def test_member_cannot_read_other_household_audit(self, client: AsyncClient) -> None:
        master = await _login(client, "gate-audit-master@example.com")
        member = await _login(client, "gate-audit-member@example.com")
        household_id, _ = await _household_and_profile(client, master)
        listed = await client.get(f"/api/v1/households/{household_id}/audit-events", headers=member)
        assert listed.status_code in (status.HTTP_403_FORBIDDEN, status.HTTP_404_NOT_FOUND)
        pin_alerts = await client.get(f"/api/v1/households/{household_id}/pin-lock-alerts", headers=member)
        assert pin_alerts.status_code in (status.HTTP_403_FORBIDDEN, status.HTTP_404_NOT_FOUND)

    async def test_concurrent_revoke_and_wall_read(self, client: AsyncClient) -> None:
        headers = await _login(client, "gate-race@example.com")
        household_id, _ = await _household_and_profile(client, headers)
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
                "display_name": "복도",
                "device_ref": _device_ref(),
            },
        )
        token = claimed.json()["data"]["device_token"]
        device_id = claimed.json()["data"]["id"]
        device_headers = {"Authorization": f"Bearer {token}"}

        revoke, wall = await asyncio.gather(
            client.request(
                "DELETE",
                f"/api/v1/households/{household_id}/devices/{device_id}",
                headers=headers,
                json={"password": "Password123!"},
            ),
            client.get("/api/v1/household-devices/me/profiles", headers=device_headers),
        )
        assert revoke.status_code == status.HTTP_204_NO_CONTENT
        assert wall.status_code in (status.HTTP_200_OK, status.HTTP_403_FORBIDDEN)
        after = await client.get("/api/v1/household-devices/me/profiles", headers=device_headers)
        assert after.status_code == status.HTTP_403_FORBIDDEN
        assert after.json()["error_code"] == "DEVICE_REVOKED"
