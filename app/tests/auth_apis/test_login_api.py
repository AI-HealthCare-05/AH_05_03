import jwt as pyjwt
from httpx import AsyncClient
from starlette import status


class TestLoginAPI:
    async def test_login_success(self, client: AsyncClient) -> None:
        email = "login_test@example.com"
        await client.post("/api/v1/auth/signup", json={"email": email, "password": "Password123!"})

        response = await client.post("/api/v1/auth/login", json={"email": email, "password": "Password123!"})

        assert response.status_code == status.HTTP_200_OK
        data = response.json()["data"]
        assert data["access_token"]
        assert data["refresh_token"]
        assert data["token_type"] == "bearer"
        assert data["expires_in"] == 900
        assert data["refresh_expires_in"] == 14 * 24 * 3600

    async def test_login_never_sets_a_cookie(self, client: AsyncClient) -> None:
        """refresh token은 본문으로만 전달한다. 예전 쿠키는 만료·시크어 설정이
        세 군데나 깨져 있었다 (계획서 참조) — 고치는 대신 아예 없앴다."""
        email = "no_cookie@example.com"
        await client.post("/api/v1/auth/signup", json={"email": email, "password": "Password123!"})

        response = await client.post("/api/v1/auth/login", json={"email": email, "password": "Password123!"})

        assert not response.headers.get_list("set-cookie")

    async def test_login_invalid_credentials(self, client: AsyncClient) -> None:
        response = await client.post(
            "/api/v1/auth/login",
            json={"email": "nonexistent@example.com", "password": "WrongPassword123!"},
        )

        assert response.status_code == status.HTTP_401_UNAUTHORIZED
        assert response.json()["error_code"] == "CREDENTIALS_INVALID"

    async def test_wrong_password_and_unknown_email_look_identical(self, client: AsyncClient) -> None:
        """계정 존재 여부가 응답 바디로 새면 안 된다."""
        email = "enumcheck@example.com"
        await client.post("/api/v1/auth/signup", json={"email": email, "password": "Password123!"})

        wrong_password = await client.post("/api/v1/auth/login", json={"email": email, "password": "Different123!"})
        unknown_email = await client.post(
            "/api/v1/auth/login",
            json={"email": "never-signed-up@example.com", "password": "Different123!"},
        )

        assert wrong_password.status_code == unknown_email.status_code == status.HTTP_401_UNAUTHORIZED
        assert wrong_password.json() == unknown_email.json()

    async def test_login_rejects_short_password_as_credentials_not_validation(self, client: AsyncClient) -> None:
        """min_length를 두면 짧은 오답이 422로 새서 비밀번호 정책이 노출된다."""
        response = await client.post("/api/v1/auth/login", json={"email": "short@example.com", "password": "x"})

        assert response.status_code == status.HTTP_401_UNAUTHORIZED

    async def test_access_token_has_no_nine_hour_skew(self, client: AsyncClient) -> None:
        import time

        email = "skewcheck@example.com"
        await client.post("/api/v1/auth/signup", json={"email": email, "password": "Password123!"})
        response = await client.post("/api/v1/auth/login", json={"email": email, "password": "Password123!"})

        token = response.json()["data"]["access_token"]
        payload = pyjwt.decode(token, options={"verify_signature": False})

        assert abs(payload["exp"] - (int(time.time()) + 900)) <= 5
        assert payload["sub"]
        assert payload["sid"]
