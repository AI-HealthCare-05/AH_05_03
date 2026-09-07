import asyncio
import secrets
import smtplib
import uuid
from email.message import EmailMessage
from typing import Annotated
from urllib.parse import urlencode

from fastapi import Depends
from redis.asyncio import Redis

from app.core import config, default_logger
from app.core.db.session import SessionDep
from app.core.redis.client import get_redis
from app.core.utils.security import hash_password_async
from app.dependencies.services import get_token_store
from app.exceptions import AccountClosedError, AccountNotFoundError, TokenInvalidError
from app.models.service_accounts import ServiceAccountStatus
from app.repositories.service_account_repository import ServiceAccountRepository
from app.services.auth import get_account_repository
from app.services.token_store import TokenStore

PASSWORD_RESET_TOKEN_PREFIX = "ieobom:pwd_reset:"
PASSWORD_RESET_TTL_SECONDS = 900  # 15분


def build_password_reset_url(token: str, email: str, web_origin: str | None = None) -> str:
    origin = web_origin or config.INVITATION_WEB_ORIGIN
    fragment = urlencode({"reset_token": token, "email": email})
    return f"{origin.rstrip('/')}/account#{fragment}"


def build_password_reset_message(email: str, reset_url: str) -> EmailMessage:
    message = EmailMessage()
    message["Subject"] = "[이어봄] 비밀번호 재설정 링크"
    message["From"] = f"{config.SMTP_FROM_NAME} <{config.SMTP_FROM_EMAIL}>"
    message["To"] = email
    body_text = f"""안녕하세요. 이어봄입니다.

비밀번호 재설정 요청이 접수되었습니다. 아래 링크를 눌러 새 비밀번호를 설정하세요 (15분간 유효):
{reset_url}

본인이 요청하지 않았다면 이 메일을 무시하세요. 기존 비밀번호는 안전하게 유지됩니다.
"""
    message.set_content(body_text)
    return message


def send_smtp_message_sync(message: EmailMessage) -> None:
    smtp_class = smtplib.SMTP_SSL if config.SMTP_USE_TLS else smtplib.SMTP
    with smtp_class(config.SMTP_HOST, config.SMTP_PORT, timeout=10) as client:
        if config.SMTP_USE_STARTTLS:
            client.starttls()
        if config.SMTP_USERNAME and config.SMTP_PASSWORD:
            client.login(config.SMTP_USERNAME, config.SMTP_PASSWORD)
        client.send_message(message)


class PasswordResetService:
    def __init__(
        self,
        session: SessionDep,
        account_repo: Annotated[ServiceAccountRepository, Depends(get_account_repository)],
        token_store: Annotated[TokenStore, Depends(get_token_store)],
        redis: Annotated[Redis, Depends(get_redis)],
    ) -> None:
        self.session = session
        self.account_repo = account_repo
        self.token_store = token_store
        self.redis = redis

    async def request_reset(self, email: str, web_origin: str | None = None) -> None:
        account = await self.account_repo.get_by_email(email)
        if account is None or account.status is not ServiceAccountStatus.ACTIVE:
            # 이메일 열거 방지: 계정이 없거나 비활성이어도 에러를 내지 않고 종료
            default_logger.info("비밀번호 재설정 요청 건너뜀 (존재하지 않거나 비활성 계정): %s", email)
            return

        token = secrets.token_urlsafe(32)
        redis_key = f"{PASSWORD_RESET_TOKEN_PREFIX}{token}"
        await self.redis.set(redis_key, str(account.id), ex=PASSWORD_RESET_TTL_SECONDS)

        reset_url = build_password_reset_url(token, email, web_origin)
        message = build_password_reset_message(email, reset_url)

        try:
            await asyncio.to_thread(send_smtp_message_sync, message)
            default_logger.info("비밀번호 재설정 메일 발송 완료: %s", email)
        except Exception as err:
            default_logger.warning("비밀번호 재설정 메일 발송 실패 (%s): %s", email, err)

    async def confirm_reset(self, token: str, new_password: str) -> None:
        redis_key = f"{PASSWORD_RESET_TOKEN_PREFIX}{token}"
        account_id_bytes = await self.redis.getdel(redis_key)
        if not account_id_bytes:
            raise TokenInvalidError("유효하지 않거나 만료된 재설정 토큰입니다.")

        account_id_str = account_id_bytes.decode() if isinstance(account_id_bytes, bytes) else str(account_id_bytes)
        try:
            account_id = uuid.UUID(account_id_str)
        except ValueError as err:
            raise TokenInvalidError("유효하지 않은 토큰 데이터입니다.") from err

        account = await self.account_repo.get_by_id(account_id)
        if account is None:
            raise AccountNotFoundError()
        if account.status is ServiceAccountStatus.CLOSED:
            raise AccountClosedError()

        new_password_hash = await hash_password_async(new_password)
        account.password_hash = new_password_hash
        await self.session.commit()

        # 기존 발급된 모든 세션/리프레시 토큰 폐기 (보안)
        await self.token_store.revoke_all_refresh(account.id)
        default_logger.info("비밀번호 재설정 완료 및 세션 무효화: account_id=%s", account.id)
