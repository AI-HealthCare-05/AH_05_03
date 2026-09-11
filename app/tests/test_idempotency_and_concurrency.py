"""`Idempotency-Key`·`If-Match` 배선 검증. docs/03_api_spec.md §2.4·§2.5.

둘 다 선택 헤더다 — 안 보내면 기존 동작 그대로임은 다른 테스트 파일 전체(헤더를
안 보내고도 통과한다)가 이미 증명한다. 여기서는 **보냈을 때** 실제로 재생·충돌
검사가 도는지만 확인한다.
"""

import secrets

from httpx import AsyncClient
from starlette import status


async def _signup_and_login(client: AsyncClient, email: str) -> dict[str, str]:
    await client.post("/api/v1/auth/signup", json={"email": email, "password": "Password123!"})
    response = await client.post("/api/v1/auth/login", json={"email": email, "password": "Password123!"})
    return {"Authorization": f"Bearer {response.json()['data']['access_token']}"}


class TestHouseholdIdempotencyAndVersion:
    async def test_create_replays_success_with_same_key(self, client: AsyncClient) -> None:
        headers = await _signup_and_login(client, "idem-household-create@example.com")
        key = secrets.token_urlsafe(24)

        first = await client.post("/api/v1/households", headers={**headers, "Idempotency-Key": key})
        assert first.status_code == status.HTTP_201_CREATED
        household_id = first.json()["data"]["id"]

        # 재시도. 키 없이 두 번째로 호출하면 "이미 소속된 가정이 있다" 409지만,
        # 같은 키로는 그 로직을 다시 타지 않고 첫 응답을 그대로 돌려받는다.
        second = await client.post("/api/v1/households", headers={**headers, "Idempotency-Key": key})
        assert second.status_code == status.HTTP_201_CREATED
        assert second.json()["data"]["id"] == household_id

    async def test_close_rejects_stale_if_match(self, client: AsyncClient) -> None:
        headers = await _signup_and_login(client, "idem-household-close-stale@example.com")
        created = await client.post("/api/v1/households", headers=headers)
        household_id = created.json()["data"]["id"]
        assert created.json()["data"]["row_version"] == 1

        stale = await client.delete(f"/api/v1/households/{household_id}", headers={**headers, "If-Match": '"99"'})
        assert stale.status_code == status.HTTP_412_PRECONDITION_FAILED
        assert stale.json()["error_code"] == "VERSION_MISMATCH"

        # 버전이 안 맞았을 뿐, 가정은 여전히 살아 있다.
        still_active = await client.get(f"/api/v1/households/{household_id}", headers=headers)
        assert still_active.status_code == status.HTTP_200_OK

    async def test_close_replays_success_with_same_key(self, client: AsyncClient) -> None:
        headers = await _signup_and_login(client, "idem-household-close-replay@example.com")
        created = await client.post("/api/v1/households", headers=headers)
        household_id = created.json()["data"]["id"]
        key = secrets.token_urlsafe(24)

        first = await client.delete(
            f"/api/v1/households/{household_id}",
            headers={**headers, "Idempotency-Key": key, "If-Match": '"1"'},
        )
        assert first.status_code == status.HTTP_204_NO_CONTENT

        # 이미 닫힌 가정을 같은 키 없이 다시 닫으면 409(HOUSEHOLD_STATE_CONFLICT)다.
        # 같은 키로는 그 실행을 다시 타지 않고 첫 성공(204)을 그대로 재생한다.
        second = await client.delete(
            f"/api/v1/households/{household_id}",
            headers={**headers, "Idempotency-Key": key, "If-Match": '"1"'},
        )
        assert second.status_code == status.HTTP_204_NO_CONTENT


class TestIdempotencyKeyReuseConflict:
    async def test_same_key_different_body_is_409(self, client: AsyncClient) -> None:
        headers = await _signup_and_login(client, "idem-key-reuse@example.com")
        key = secrets.token_urlsafe(24)

        first = await client.post(
            "/api/v1/subscription/change", json={"plan": "FAMILY"}, headers={**headers, "Idempotency-Key": key}
        )
        assert first.status_code == status.HTTP_200_OK

        second = await client.post(
            "/api/v1/subscription/change", json={"plan": "BASIC"}, headers={**headers, "Idempotency-Key": key}
        )
        assert second.status_code == status.HTTP_409_CONFLICT
        assert second.json()["error_code"] == "IDEMPOTENCY_KEY_REUSED"


class TestInvitationVersionMismatch:
    async def test_cancel_rejects_stale_if_match(self, client: AsyncClient) -> None:
        headers = await _signup_and_login(client, "idem-invitation-cancel@example.com")
        household_id = (await client.post("/api/v1/households", headers=headers)).json()["data"]["id"]
        created = await client.post(
            "/api/v1/family-invitations",
            headers=headers,
            json={
                "household_id": household_id,
                "invitee_email": "idem-invitation-recipient@example.com",
                "target_profile_ref": secrets.token_urlsafe(32),
            },
        )
        invitation = created.json()["data"]["invitation"]
        assert invitation["row_version"] == 1

        stale = await client.post(
            f"/api/v1/family-invitations/{invitation['id']}/cancel",
            headers={**headers, "If-Match": '"7"'},
        )
        assert stale.status_code == status.HTTP_412_PRECONDITION_FAILED
        assert stale.json()["error_code"] == "VERSION_MISMATCH"

        cancelled = await client.post(
            f"/api/v1/family-invitations/{invitation['id']}/cancel",
            headers={**headers, "If-Match": '"1"'},
        )
        assert cancelled.status_code == status.HTTP_200_OK
        assert cancelled.json()["data"]["status"] == "cancelled"
