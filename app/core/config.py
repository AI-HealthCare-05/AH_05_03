import os
import uuid
import zoneinfo
from dataclasses import field
from pathlib import Path
from typing import Literal

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.core.utils.enums import StrEnum


class Env(StrEnum):
    LOCAL = "local"
    DEV = "dev"
    PROD = "prod"


class Config(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="allow")

    ENV: Env = Env.LOCAL
    SECRET_KEY: str = f"default-secret-key{uuid.uuid4().hex}"
    TIMEZONE: zoneinfo.ZoneInfo = field(default_factory=lambda: zoneinfo.ZoneInfo("Asia/Seoul"))
    TEMPLATE_DIR: str = os.path.join(Path(__file__).resolve().parent.parent, "templates")

    DB_HOST: str = "localhost"
    DB_PORT: int = 5432
    DB_USER: str = "postgres"
    DB_PASSWORD: str = "pw1234"
    DB_NAME: str = "ai_health"
    DB_TEST_NAME: str = "ai_health_test"
    # 전체 DSN 재정의. 값이 있으면 위 항목보다 우선한다 (CI·스테이징용)
    DB_URL: str | None = None
    DB_CONNECT_TIMEOUT: int = 5
    DB_CONNECTION_POOL_MAXSIZE: int = 10
    DB_POOL_RECYCLE: int = 1800

    # --- redis / token store -----------------------------------------
    REDIS_URL: str = "redis://localhost:6379/0"
    REDIS_KEY_PREFIX: str = "ieobom"
    REDIS_MAX_CONNECTIONS: int = 20
    # 짧게 잡아 장애 시 매달리지 않고 빠르게 503으로 떨어지게 한다.
    REDIS_SOCKET_TIMEOUT: float = 0.5
    REDIS_SOCKET_CONNECT_TIMEOUT: float = 0.5

    JWT_ALGORITHM: str = "HS256"
    # docs/05_tech_architecture.md 7절 "Access Token은 짧게 유지".
    # Redis 장애 시 fail-open 브레이크글래스의 노출 창을 15분으로 묶는 값이기도 하다.
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_MINUTES: int = 14 * 24 * 60
    JWT_LEEWAY: int = 5
    # access 토큰 denylist 조회에만 적용되는 비상 스위치.
    # 회전·등록·무효화는 이 값과 무관하게 항상 fail-closed다.
    AUTH_FAIL_OPEN_ON_REDIS_ERROR: bool = False

    # --- family invitations -----------------------------------------
    FAMILY_INVITATION_EXPIRE_DAYS: int = 7
    FAMILY_INVITATION_TOKEN_BYTES: int = 32
    FAMILY_INVITATION_DELIVERY_TTL_SECONDS: int = 5 * 60
    FAMILY_INVITATION_DELIVERY_STREAM_MAXLEN: int = 10_000
    INVITATION_EMAIL_STREAM_GROUP: str = "ieobom_email_worker_group"
    INVITATION_WEB_ORIGIN: str = "http://localhost:5173"
    FAMILY_INVITATION_USED_TOKEN_TTL_SECONDS: int = 7 * 24 * 60 * 60
    FAMILY_INVITATION_ACCOUNT_RATE_LIMIT: int = 10
    FAMILY_INVITATION_ACCOUNT_RATE_WINDOW_SECONDS: int = 60
    FAMILY_INVITATION_EMAIL_RATE_LIMIT: int = 20
    FAMILY_INVITATION_EMAIL_RATE_WINDOW_SECONDS: int = 60 * 60
    FAMILY_INVITATION_TRANSITION_RATE_LIMIT: int = 20
    FAMILY_INVITATION_TRANSITION_RATE_WINDOW_SECONDS: int = 60

    # --- api ----------------------------------------------------------
    # 오류 응답의 details는 비규격 필드다. 운영에서는 끈다.
    API_ERROR_INCLUDE_DETAILS: bool = False
    CORS_ALLOW_ORIGINS: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]

    # --- local OCR development bridge -------------------------------
    # ocr.py는 현재 Naver OCR로 원본을 전송한다. 로컬 우선 정책과 충돌하므로
    # 운영 기능이 아니라 명시적으로 켠 개발 환경에서만 노출한다.
    ENABLE_DEV_OCR_BRIDGE: bool = False
    DEV_OCR_MAX_FILE_BYTES: int = 20 * 1024 * 1024

    # --- Gemini OCR 프록시 ------------------------------------------
    # 클라우드 OCR 통신 테스트를 위한 임시 키. 운영 환경이 아닌 개발 환경에서만 사용.
    GEMINI_API_KEY: str | None = None

    # --- OpenAI 대화형 통증 기록 --------------------------------------
    # 키는 서버 환경변수에만 두고, 브라우저로 전달하지 않는다.
    OPENAI_KEY: str | None = None
    OPENAI_PAIN_CHAT_MODEL: str = "gpt-4o-mini"
    # 대화형 기록은 즉시 반응해야 하므로, 느린 외부 AI 호출을 오래 기다리지 않는다.
    OPENAI_PAIN_CHAT_TIMEOUT_SECONDS: float = 2.2

    # Refresh Token은 JavaScript에 노출하지 않고 host 전용 쿠키로만 전달한다.
    # __Host- 접두사는 Secure + Path=/ + Domain 미지정을 브라우저가 강제한다.
    REFRESH_COOKIE_NAME: str = "__Host-ieobom_refresh"
    REFRESH_COOKIE_PATH: str = "/"
    REFRESH_COOKIE_SECURE: bool = True
    REFRESH_COOKIE_SAMESITE: Literal["lax", "strict", "none"] = "lax"

    @model_validator(mode="after")
    def validate_browser_security(self) -> "Config":
        if "*" in self.CORS_ALLOW_ORIGINS:
            raise ValueError("credentialed CORS requires explicit origins")
        if self.REFRESH_COOKIE_NAME.startswith("__Host-") and (
            not self.REFRESH_COOKIE_SECURE or self.REFRESH_COOKIE_PATH != "/"
        ):
            raise ValueError("__Host- cookies require Secure and Path=/")
        if self.REFRESH_COOKIE_SAMESITE == "none" and not self.REFRESH_COOKIE_SECURE:
            raise ValueError("SameSite=None cookies require Secure")
        return self
