import asyncio
import html
import os
import smtplib
import socket
import uuid
from email.message import EmailMessage
from typing import Any, Protocol, cast
from urllib.parse import urlencode

from redis.asyncio import Redis
from redis.exceptions import ResponseError, TimeoutError

from app.core import config, default_logger
from app.services.invitation_store import InvitationDelivery, InvitationStore


class InvitationSender(Protocol):
    async def send(self, delivery: InvitationDelivery) -> None: ...


class SmtpInvitationSender:
    async def send(self, delivery: InvitationDelivery) -> None:
        message = build_invitation_message(delivery)
        await asyncio.to_thread(self._send_sync, message)

    @staticmethod
    def _send_sync(message: EmailMessage) -> None:
        smtp_class = smtplib.SMTP_SSL if config.SMTP_USE_TLS else smtplib.SMTP
        with smtp_class(config.SMTP_HOST, config.SMTP_PORT, timeout=10) as client:
            if config.SMTP_USE_STARTTLS:
                client.starttls()
            if config.SMTP_USERNAME and config.SMTP_PASSWORD:
                client.login(config.SMTP_USERNAME, config.SMTP_PASSWORD)
            client.send_message(message)


def build_invitation_url(delivery: InvitationDelivery) -> str:
    fragment = urlencode(
        {
            "invitation": str(delivery.invitation_id),
            "token": delivery.token,
            "email": delivery.invitee_email,
        }
    )
    return f"{config.INVITATION_WEB_ORIGIN.rstrip('/')}/account#{fragment}"


def build_invitation_message(delivery: InvitationDelivery) -> EmailMessage:
    url = build_invitation_url(delivery)
    message = EmailMessage()
    message["Subject"] = "[이어봄] 가족 건강기록 연결 초대"
    message["From"] = f"{config.SMTP_FROM_NAME} <{config.SMTP_FROM_EMAIL}>"
    message["To"] = delivery.invitee_email
    message.set_content(
        "이어봄 가족 연결 초대가 도착했습니다.\n\n"
        f"초대 확인: {url}\n\n"
        "이 링크는 초대받은 이메일의 서비스 계정으로 로그인한 뒤 사용할 수 있습니다.\n"
        "건강기록은 이 메일이나 이어봄 서버에 포함되지 않습니다.\n"
        "본인이 요청하지 않았다면 이 메일을 무시하세요."
    )
    safe_url = html.escape(url, quote=True)
    message.add_alternative(
        "<html><body>"
        "<h2>이어봄 가족 연결 초대</h2>"
        "<p>가족 건강기록 연결 초대가 도착했습니다.</p>"
        f'<p><a href="{safe_url}">초대 확인하기</a></p>'
        "<p>초대받은 이메일의 서비스 계정으로 로그인한 뒤 사용할 수 있습니다.</p>"
        "<p>건강기록은 이 메일이나 이어봄 서버에 포함되지 않습니다.</p>"
        "<p>본인이 요청하지 않았다면 이 메일을 무시하세요.</p>"
        "</body></html>",
        subtype="html",
    )
    return message


class InvitationEmailWorker:
    def __init__(self, redis: Redis, sender: InvitationSender) -> None:
        self.redis = redis
        self.store = InvitationStore(redis)
        self.sender = sender
        self.stream = f"{config.REDIS_KEY_PREFIX}:invite:delivery:stream"
        self.group = config.INVITATION_EMAIL_STREAM_GROUP
        self.consumer = f"{socket.gethostname()}-{os.getpid()}"

    async def run_forever(self) -> None:
        await self._ensure_group()
        default_logger.info("invitation email worker started: group=%s consumer=%s", self.group, self.consumer)
        while True:
            try:
                streams = cast(
                    list[tuple[str, list[tuple[str, dict[str, str]]]]],
                    await cast(Any, self.redis).xreadgroup(
                        groupname=self.group,
                        consumername=self.consumer,
                        streams={self.stream: ">"},
                        count=10,
                        block=config.INVITATION_EMAIL_STREAM_BLOCK_MS,
                    ),
                )
            except TimeoutError:
                default_logger.warning("Redis delivery stream read timed out; retrying")
                continue
            for _, messages in streams:
                for message_id, fields in messages:
                    await self._process(message_id, fields)

    async def _ensure_group(self) -> None:
        try:
            await self.redis.xgroup_create(self.stream, self.group, id="0", mkstream=True)
        except ResponseError as err:
            if "BUSYGROUP" not in str(err):
                raise

    async def _process(self, message_id: str, fields: dict[str, str]) -> None:
        raw_invitation_id = fields.get("invitation_id")
        if raw_invitation_id is None:
            await self.redis.xack(self.stream, self.group, message_id)
            default_logger.warning("discarded invitation delivery without invitation_id")
            return
        try:
            invitation_id = uuid.UUID(raw_invitation_id)
        except ValueError:
            await self.redis.xack(self.stream, self.group, message_id)
            default_logger.warning("discarded malformed invitation delivery id")
            return

        delivery = await self.store.take_delivery(invitation_id)
        if delivery is None:
            await self.redis.xack(self.stream, self.group, message_id)
            default_logger.info("invitation delivery expired or already handled: %s", invitation_id)
            return

        try:
            await self.sender.send(delivery)
        except (OSError, smtplib.SMTPException):
            default_logger.exception("SMTP delivery failed; invitation requeued: %s", invitation_id)
            await self.store.requeue_delivery(delivery, config.FAMILY_INVITATION_DELIVERY_TTL_SECONDS)
            await self.redis.xack(self.stream, self.group, message_id)
            await asyncio.sleep(config.INVITATION_EMAIL_RETRY_DELAY_SECONDS)
            return

        await self.redis.xack(self.stream, self.group, message_id)
        default_logger.info("invitation email delivered: %s", invitation_id)


async def main() -> None:
    block_seconds = config.INVITATION_EMAIL_STREAM_BLOCK_MS / 1_000
    redis = Redis.from_url(
        config.REDIS_URL,
        encoding="utf-8",
        decode_responses=True,
        socket_timeout=block_seconds + 5,
        socket_connect_timeout=config.REDIS_SOCKET_CONNECT_TIMEOUT,
    )
    try:
        await InvitationEmailWorker(redis, SmtpInvitationSender()).run_forever()
    finally:
        await redis.aclose()


if __name__ == "__main__":
    asyncio.run(main())
