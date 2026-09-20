import secrets

from httpx import AsyncClient


async def _login(client: AsyncClient, email: str) -> dict[str, str]:
    await client.post("/api/v1/auth/signup", json={"email": email, "password": "Password123!"})
    response = await client.post("/api/v1/auth/login", json={"email": email, "password": "Password123!"})
    return {"Authorization": f"Bearer {response.json()['data']['access_token']}"}


async def _household_and_profile(client: AsyncClient, headers: dict[str, str], name: str = "벽") -> tuple[str, str]:
    household_id = (await client.post("/api/v1/households", headers=headers)).json()["data"]["id"]
    profile = await client.post(
        "/api/v1/profiles",
        headers=headers,
        json={"household_id": household_id, "display_name": name, "relationship": "자녀"},
    )
    return household_id, profile.json()["data"]["id"]


def _device_ref() -> str:
    return secrets.token_urlsafe(32)


class TestMemberPinAPIs:
    async def test_plaintext_never_returns_after_issue(self, client: AsyncClient) -> None:
        headers = await _login(client, "pin-master@example.com")
        household_id, profile_id = await _household_and_profile(client, headers)
        created = await client.get(f"/api/v1/profiles/{profile_id}", headers=headers)
        assert created.json()["data"]["pin_configured"] is False
        issued = await client.post(f"/api/v1/profiles/{profile_id}/pin-credentials", headers=headers)
        assert issued.status_code == 201
        pin = issued.json()["data"]["temporary_pin"]
        assert pin.isdigit()
        listed = await client.get(f"/api/v1/profiles/{profile_id}", headers=headers)
        body = listed.text
        assert pin not in body
        assert "pin_hash" not in listed.json()["data"]
        assert listed.json()["data"]["pin_configured"] is True
        listed_all = await client.get(f"/api/v1/profiles?household_id={household_id}", headers=headers)
        assert listed_all.json()["data"]["items"][0]["pin_configured"] is True

    async def test_hashes_are_independent_and_wrong_household_is_rejected(self, client: AsyncClient) -> None:
        alice = await _login(client, "pin-alice@example.com")
        bob = await _login(client, "pin-bob@example.com")
        _, alice_profile = await _household_and_profile(client, alice, "앨리스")
        bob_hh, bob_profile = await _household_and_profile(client, bob, "밥")
        first = (await client.post(f"/api/v1/profiles/{alice_profile}/pin-credentials", headers=alice)).json()["data"]
        second = (await client.post(f"/api/v1/profiles/{bob_profile}/pin-credentials", headers=bob)).json()["data"]
        assert first["temporary_pin"] != second["temporary_pin"] or first["profile_id"] != second["profile_id"]

        stolen = await client.post(
            f"/api/v1/profiles/{bob_profile}/member-sessions",
            headers=alice,
            json={"pin": second["temporary_pin"]},
        )
        assert stolen.status_code == 404

        wall_code = (
            await client.post(
                f"/api/v1/households/{bob_hh}/device-pairings",
                headers=bob,
                json={"password": "Password123!"},
            )
        ).json()["data"]["code"]
        claimed = await client.post(
            "/api/v1/household-devices",
            json={
                "pairing_code": wall_code,
                "household_id": bob_hh,
                "display_name": "거실",
                "device_ref": _device_ref(),
            },
        )
        token = claimed.json()["data"]["device_token"]
        reuse = await client.post(
            "/api/v1/household-devices/me/member-sessions",
            headers={"Authorization": f"Bearer {token}"},
            json={"profile_id": alice_profile, "pin": first["temporary_pin"]},
        )
        assert reuse.status_code == 404

    async def test_lock_after_failures_and_reissue_revokes_session(self, client: AsyncClient) -> None:
        headers = await _login(client, "pin-lock@example.com")
        household_id, profile_id = await _household_and_profile(client, headers)
        pin = (await client.post(f"/api/v1/profiles/{profile_id}/pin-credentials", headers=headers)).json()["data"][
            "temporary_pin"
        ]
        for _ in range(5):
            denied = await client.post(
                f"/api/v1/profiles/{profile_id}/member-sessions",
                headers=headers,
                json={"pin": "482913" if pin != "482913" else "715204"},
            )
        assert denied.status_code == 429
        assert denied.json()["error_code"] == "PIN_LOCKED"

        locked = await client.post(
            f"/api/v1/profiles/{profile_id}/member-sessions",
            headers=headers,
            json={"pin": pin},
        )
        assert locked.status_code == 429

        opened = await client.post(
            f"/api/v1/profiles/{profile_id}/member-sessions",
            headers=headers,
            json={"pin": pin},
        )
        assert opened.status_code == 429

        reissued = await client.post(f"/api/v1/profiles/{profile_id}/pin-credentials", headers=headers)
        new_pin = reissued.json()["data"]["temporary_pin"]
        old = await client.post(
            f"/api/v1/profiles/{profile_id}/member-sessions",
            headers=headers,
            json={"pin": pin},
        )
        assert old.status_code == 401
        fresh = await client.post(
            f"/api/v1/profiles/{profile_id}/member-sessions",
            headers=headers,
            json={"pin": new_pin},
        )
        assert fresh.status_code == 201
        assert "session_token" in fresh.json()["data"]
        first_token = (
            await client.post(
                f"/api/v1/profiles/{profile_id}/member-sessions",
                headers=headers,
                json={"pin": new_pin},
            )
        ).json()["data"]["session_token"]

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
                "display_name": "벽",
                "device_ref": _device_ref(),
            },
        )
        device_headers = {"Authorization": f"Bearer {claimed.json()['data']['device_token']}"}
        wall_session = await client.post(
            "/api/v1/household-devices/me/member-sessions",
            headers=device_headers,
            json={"profile_id": profile_id, "pin": new_pin},
        )
        assert wall_session.status_code == 201

        again = await client.post(f"/api/v1/profiles/{profile_id}/pin-credentials", headers=headers)
        assert again.status_code == 201
        assert first_token != again.json()["data"]["temporary_pin"]

        member = await _login(client, "pin-stranger@example.com")
        forbidden = await client.post(f"/api/v1/profiles/{profile_id}/pin-credentials", headers=member)
        assert forbidden.status_code == 403
        assert forbidden.json()["error_code"] == "HOUSEHOLD_MASTER_REQUIRED"

    async def test_reissue_invalidates_previous_pin_under_back_to_back_calls(self, client: AsyncClient) -> None:
        headers = await _login(client, "pin-race@example.com")
        _, profile_id = await _household_and_profile(client, headers)
        first = (await client.post(f"/api/v1/profiles/{profile_id}/pin-credentials", headers=headers)).json()["data"][
            "temporary_pin"
        ]
        second = (await client.post(f"/api/v1/profiles/{profile_id}/pin-credentials", headers=headers)).json()["data"][
            "temporary_pin"
        ]
        stale = await client.post(
            f"/api/v1/profiles/{profile_id}/member-sessions",
            headers=headers,
            json={"pin": first},
        )
        assert stale.status_code == 401
        fresh = await client.post(
            f"/api/v1/profiles/{profile_id}/member-sessions",
            headers=headers,
            json={"pin": second},
        )
        assert fresh.status_code == 201

    async def test_weak_replacement_rejected_and_change_works(self, client: AsyncClient) -> None:
        headers = await _login(client, "pin-change@example.com")
        _, profile_id = await _household_and_profile(client, headers)
        pin = (await client.post(f"/api/v1/profiles/{profile_id}/pin-credentials", headers=headers)).json()["data"][
            "temporary_pin"
        ]
        weak = await client.post(
            f"/api/v1/profiles/{profile_id}/pin-replacements",
            headers=headers,
            json={"current_pin": pin, "new_pin": "123456"},
        )
        assert weak.status_code == 422
        assert weak.json()["error_code"] == "PIN_WEAK"

        changed = await client.post(
            f"/api/v1/profiles/{profile_id}/pin-replacements",
            headers=headers,
            json={"current_pin": pin, "new_pin": "482913"},
        )
        assert changed.status_code == 204
        old = await client.post(
            f"/api/v1/profiles/{profile_id}/member-sessions",
            headers=headers,
            json={"pin": pin},
        )
        assert old.status_code == 401
        ok = await client.post(
            f"/api/v1/profiles/{profile_id}/member-sessions",
            headers=headers,
            json={"pin": "482913"},
        )
        assert ok.status_code == 201
        assert ok.json()["data"]["must_change"] is False
        unregistered = await client.post(
            "/api/v1/household-devices/me/member-sessions",
            json={"profile_id": profile_id, "pin": "482913"},
        )
        assert unregistered.status_code == 401
