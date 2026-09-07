from unittest.mock import patch

from httpx import AsyncClient
from redis.asyncio import Redis
from starlette import status

from app.core import config
from app.services.password_reset import PASSWORD_RESET_TOKEN_PREFIX


class TestPasswordResetAPI:
    async def test_request_password_reset_for_existing_account(self, client: AsyncClient, fake_redis: Redis) -> None:
        email = "reset_user@example.com"
        await client.post("/api/v1/auth/signup", json={"email": email, "password": "Password123!"})

        with patch("app.services.password_reset.send_smtp_message_sync") as mock_send:
            response = await client.post(
                "/api/v1/auth/password-reset/request",
                json={"email": email},
            )
            assert response.status_code == status.HTTP_200_OK
            assert response.json()["message"] == "입력하신 이메일로 비밀번호 재설정 안내를 전송했습니다."
            assert mock_send.called
            sent_msg = mock_send.call_args[0][0]
            assert sent_msg["To"] == email
            assert "[이어봄] 비밀번호 재설정 링크" in sent_msg["Subject"]

    async def test_request_password_reset_nonexistent_account_returns_200_without_sending(
        self, client: AsyncClient
    ) -> None:
        with patch("app.services.password_reset.send_smtp_message_sync") as mock_send:
            response = await client.post(
                "/api/v1/auth/password-reset/request",
                json={"email": "nonexistent@example.com"},
            )
            assert response.status_code == status.HTTP_200_OK
            assert response.json()["message"] == "입력하신 이메일로 비밀번호 재설정 안내를 전송했습니다."
            assert not mock_send.called

    async def test_confirm_password_reset_success_and_login_with_new_password(
        self, client: AsyncClient, fake_redis: Redis
    ) -> None:
        email = "change_me@example.com"
        old_password = "OldPassword123!"
        new_password = "NewPassword456!"

        signup_resp = await client.post("/api/v1/auth/signup", json={"email": email, "password": old_password})
        account_id = signup_resp.json()["data"]["account_id"]

        test_token = "valid_test_token_1234567890"
        await fake_redis.set(f"{PASSWORD_RESET_TOKEN_PREFIX}{test_token}", str(account_id), ex=900)

        # 1. Confirm reset with new password
        confirm_resp = await client.post(
            "/api/v1/auth/password-reset/confirm",
            json={"token": test_token, "new_password": new_password},
        )
        assert confirm_resp.status_code == status.HTTP_200_OK
        assert confirm_resp.json()["message"] == "비밀번호가 성공적으로 변경되었습니다."

        # 2. Token is consumed (one-time use)
        assert await fake_redis.get(f"{PASSWORD_RESET_TOKEN_PREFIX}{test_token}") is None

        # 3. Old password should fail
        fail_login = await client.post("/api/v1/auth/login", json={"email": email, "password": old_password})
        assert fail_login.status_code == status.HTTP_401_UNAUTHORIZED

        # 4. New password should succeed
        success_login = await client.post("/api/v1/auth/login", json={"email": email, "password": new_password})
        assert success_login.status_code == status.HTTP_200_OK
        assert success_login.json()["data"]["access_token"]

    async def test_confirm_password_reset_invalid_or_expired_token(self, client: AsyncClient) -> None:
        response = await client.post(
            "/api/v1/auth/password-reset/confirm",
            json={"token": "invalid_or_expired_token_12345", "new_password": "NewPassword456!"},
        )
        assert response.status_code == status.HTTP_401_UNAUTHORIZED
        assert response.json()["error_code"] == "TOKEN_INVALID"

    async def test_confirm_password_reset_revokes_existing_refresh_sessions(
        self, client: AsyncClient, fake_redis: Redis
    ) -> None:
        email = "session_kill@example.com"
        signup_resp = await client.post("/api/v1/auth/signup", json={"email": email, "password": "Password123!"})
        account_id = signup_resp.json()["data"]["account_id"]

        # Login to get refresh token cookie
        login_resp = await client.post("/api/v1/auth/login", json={"email": email, "password": "Password123!"})
        assert login_resp.status_code == status.HTTP_200_OK
        refresh_cookie = login_resp.cookies.get(config.REFRESH_COOKIE_NAME)
        assert refresh_cookie

        # Reset password
        token = "session_token_1234567890"
        await fake_redis.set(f"{PASSWORD_RESET_TOKEN_PREFIX}{token}", str(account_id), ex=900)
        await client.post(
            "/api/v1/auth/password-reset/confirm",
            json={"token": token, "new_password": "NewPassword456!"},
        )

        # Attempt to refresh using the old refresh cookie -> should be revoked/fail
        refresh_resp = await client.post(
            "/api/v1/auth/refresh",
            cookies={config.REFRESH_COOKIE_NAME: refresh_cookie},
        )
        assert refresh_resp.status_code == status.HTTP_401_UNAUTHORIZED
