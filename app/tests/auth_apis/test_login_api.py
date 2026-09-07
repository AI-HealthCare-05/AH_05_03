import jwt as pyjwt
from httpx import AsyncClient
from starlette import status

from app.core import config


class TestLoginAPI:
    async def test_login_success(self, client: AsyncClient) -> None:
        email = "login_test@example.com"
        await client.post("/api/v1/auth/signup", json={"email": email, "password": "Password123!"})

        response = await client.post("/api/v1/auth/login", json={"email": email, "password": "Password123!"})

        assert response.status_code == status.HTTP_200_OK
        data = response.json()["data"]
        assert data["access_token"]
        assert data["token_type"] == "bearer"
        assert data["expires_in"] == 900
        assert "refresh_token" not in data

    async def test_login_sets_hardened_refresh_cookie(self, client: AsyncClient) -> None:
        email = "cookie@example.com"
        await client.post("/api/v1/auth/signup", json={"email": email, "password": "Password123!"})

        response = await client.post("/api/v1/auth/login", json={"email": email, "password": "Password123!"})

        assert response.cookies.get(config.REFRESH_COOKIE_NAME)
        set_cookie = response.headers["set-cookie"]
        assert "HttpOnly" in set_cookie
        assert "Secure" in set_cookie
        assert "SameSite=lax" in set_cookie
        assert "Path=/" in set_cookie
        assert f"Max-Age={14 * 24 * 3600}" in set_cookie

    async def test_untrusted_browser_origin_is_rejected(self, client: AsyncClient) -> None:
        response = await client.post(
            "/api/v1/auth/login",
            json={"email": "someone@example.com", "password": "Password123!"},
            headers={"Origin": "https://evil.example"},
        )

        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert response.json()["error_code"] == "ORIGIN_NOT_ALLOWED"

    async def test_same_origin_is_allowed_without_configuration(self, client: AsyncClient) -> None:
        """배포 도메인을 `CORS_ALLOW_ORIGINS` 에 안 적어도 로그인이 된다.

        SPA 를 FastAPI 가 직접 서빙하므로 프런트의 Origin 은 곧 요청이 도착한
        주소다. 이 통로가 없으면 새 도메인에 배포할 때마다 회원가입·로그인이
        전부 403 이 된다 — 2026-09-04 배포에서 실제로 그랬다.
        """
        email = "same-origin@example.com"
        await client.post("/api/v1/auth/signup", json={"email": email, "password": "Password123!"})
        own_origin = str(client.base_url)
        assert own_origin not in config.CORS_ALLOW_ORIGINS

        response = await client.post(
            "/api/v1/auth/login",
            json={"email": email, "password": "Password123!"},
            headers={"Origin": own_origin},
        )

        assert response.status_code == status.HTTP_200_OK

    async def test_tls_terminating_proxy_scheme_mismatch_still_passes(self, client: AsyncClient) -> None:
        """스킴이 어긋나도 호스트가 같으면 통과한다.

        Cloudflare 같은 앞단이 TLS 를 끊고 평문으로 넘기면 뒤쪽은 자기가 http 라고
        믿는다. 브라우저는 `https://` Origin 을 보내므로 스킴까지 맞추라고 하면 그
        배포에서는 로그인이 영영 안 된다. 2026-09-04 에 그 조합을 재현해 확인했다.
        """
        email = "proxy-scheme@example.com"
        await client.post("/api/v1/auth/signup", json={"email": email, "password": "Password123!"})

        response = await client.post(
            "/api/v1/auth/login",
            json={"email": email, "password": "Password123!"},
            headers={"Origin": "http://test"},  # 클라이언트는 https://test 로 붙어 있다
        )

        assert response.status_code == status.HTTP_200_OK

    async def test_a_different_port_is_a_different_origin(self, client: AsyncClient) -> None:
        """호스트 비교는 포트를 포함한다.

        스킴을 안 본다고 해서 아무 이웃이나 들어오면 안 된다. 같은 기계의 다른
        포트에서 도는 앱은 남이다.
        """
        response = await client.post(
            "/api/v1/auth/login",
            json={"email": "someone@example.com", "password": "Password123!"},
            headers={"Origin": "https://test:8443"},
        )

        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert response.json()["error_code"] == "ORIGIN_NOT_ALLOWED"

    async def test_trusted_browser_origin_receives_credentialed_cors_headers(self, client: AsyncClient) -> None:
        email = "trusted-origin@example.com"
        await client.post("/api/v1/auth/signup", json={"email": email, "password": "Password123!"})

        response = await client.post(
            "/api/v1/auth/login",
            json={"email": email, "password": "Password123!"},
            headers={"Origin": config.CORS_ALLOW_ORIGINS[0]},
        )

        assert response.status_code == status.HTTP_200_OK
        assert response.headers["access-control-allow-origin"] == config.CORS_ALLOW_ORIGINS[0]
        assert response.headers["access-control-allow-credentials"] == "true"

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
