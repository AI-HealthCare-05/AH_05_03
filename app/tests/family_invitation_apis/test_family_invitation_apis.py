from httpx import ASGITransport, AsyncClient
from starlette import status

from app.main import app


async def signup_and_login(client: AsyncClient, email: str, phone_number: str) -> str:
    await client.post(
        "/api/v1/auth/signup",
        json={
            "email": email,
            "password": "Password123!",
            "name": "가족테스터",
            "gender": "FEMALE",
            "birth_date": "1990-01-01",
            "phone_number": phone_number,
        },
    )
    response = await client.post("/api/v1/auth/login", json={"email": email, "password": "Password123!"})
    return response.json()["access_token"]


async def test_family_invitation_full_flow():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        inviter_token = await signup_and_login(client, "inviter@example.com", "01011112222")
        invitee_token = await signup_and_login(client, "invitee@example.com", "01033334444")
        create_response = await client.post(
            "/api/v1/family-invitations",
            headers={"Authorization": f"Bearer {inviter_token}"},
            json={
                "invitee_email": "invitee@example.com",
                "household_ref": "household-ref-0001",
                "target_profile_ref": "profile-ref-000001",
            },
        )
        assert create_response.status_code == status.HTTP_201_CREATED
        invitation_id = create_response.json()["id"]

        received = await client.get(
            "/api/v1/family-invitations", headers={"Authorization": f"Bearer {invitee_token}"}
        )
        assert received.status_code == status.HTTP_200_OK
        assert len(received.json()["received"]) == 1

        accepted = await client.post(
            f"/api/v1/family-invitations/{invitation_id}/accept",
            headers={"Authorization": f"Bearer {invitee_token}"},
        )
        assert accepted.status_code == status.HTTP_200_OK
        assert accepted.json()["status"] == "accepted"


async def test_duplicate_pending_invitation_is_rejected():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        token = await signup_and_login(client, "owner@example.com", "01055556666")
        payload = {
            "invitee_email": "family@example.com",
            "household_ref": "household-ref-0002",
            "target_profile_ref": "profile-ref-000002",
        }
        headers = {"Authorization": f"Bearer {token}"}
        assert (await client.post("/api/v1/family-invitations", headers=headers, json=payload)).status_code == 201
        duplicate = await client.post("/api/v1/family-invitations", headers=headers, json=payload)
        assert duplicate.status_code == status.HTTP_409_CONFLICT
