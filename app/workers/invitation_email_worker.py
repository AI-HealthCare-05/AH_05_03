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
from redis.exceptions import ConnectionError as RedisConnectionError
from redis.exceptions import ResponseError, TimeoutError

from app.core import config, default_logger
from app.core.redis.resilience import ensure_group_with_retry, is_missing_group
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
        # SIGTERM 을 받으면 선다. Redis 를 기다리는 중에도 즉시 깨어나 나가야
        # `docker compose down` 이 타임아웃까지 매달리지 않는다.
        self._stopping = asyncio.Event()

    def request_stop(self) -> None:
        self._stopping.set()

    async def run_forever(self) -> None:
        # 예측·문서 인식 소비자와 **같은 이유로** 루프 안에서 재시도한다. 그냥 await
        # 하면 기동 순간 Redis 가 아직 안 떴거나 잠깐 끊긴 것만으로 워커가 죽고,
        # `restart: always` 가 되살려 같은 자리에서 또 죽는다.
        # `app/core/redis/resilience.py` 참조.
        if not await ensure_group_with_retry(self._ensure_group, self._stopping, default_logger):
            return
        default_logger.info("invitation email worker started: group=%s consumer=%s", self.group, self.consumer)
        while not self._stopping.is_set():
            try:
                # **죽은 소비자 몫을 먼저 회수한다.** 이게 없어서 워커가 `XACK` 전에
                # 죽으면 그 초대 메일이 영구 유실됐다 — 새 워커는 pid 가 달라 이름이
                # 바뀌고 `>` 로만 읽으므로 남의 PEL 을 못 본다. 예측·문서 인식 소비자는
                # 처음부터 `XAUTOCLAIM` 을 쓰고 있었는데 여기만 빠져 있었다.
                await self._drain_stale()
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
            except RedisConnectionError:
                # **이 갈래가 없어서 Redis 순단 한 번에 워커가 죽었다.** 위 `TimeoutError`
                # 만 잡고 있었는데, 연결이 끊기는 것과 읽기가 오래 걸리는 것은 다른 예외다.
                default_logger.warning("Redis connection lost; retrying in 2s")
                await asyncio.sleep(2.0)
                continue
            except ResponseError as error:
                # Redis 는 지속화를 꺼 두어서 재시작하면 그룹이 통째로 사라진다.
                if not is_missing_group(error):
                    raise
                default_logger.warning("consumer group vanished (Redis restart?); recreating")
                await ensure_group_with_retry(self._ensure_group, self._stopping, default_logger)
                continue
            for _, messages in streams:
                for message_id, fields in messages:
                    await self._process(message_id, fields)

    async def _drain_stale(self) -> None:
        """회수한 건을 그 자리에서 처리한다. 호출부를 한 줄로 두려고 나눠 놨다."""
        reclaimed = await self._reclaim_stale()
        if not reclaimed:
            return
        default_logger.info("reclaimed %d stale invitation deliveries", len(reclaimed))
        for message_id, fields in reclaimed:
            await self._process(message_id, fields)

    async def _reclaim_stale(self) -> list[tuple[str, dict[str, str]]]:
        """죽은 소비자가 물고 있던 배달 건을 넘겨받는다.

        `min_idle_time` 이 지난 것만 가져오므로 정상 처리 중인 건을 뺏지 않는다.
        회수한 뒤 `_process` 를 그대로 태우면 되는데, 이미 보낸 건이면
        `take_delivery()` 가 `None` 을 주고 그쪽이 `XACK` 만 하고 끝난다 —
        중복 발송이 되지 않는 이유다.
        """
        try:
            result = await cast(Any, self.redis).xautoclaim(
                name=self.stream,
                groupname=self.group,
                consumername=self.consumer,
                min_idle_time=config.INVITATION_EMAIL_RECLAIM_IDLE_MS,
                count=10,
            )
        except ResponseError:
            # 그룹이 아직 없거나 사라졌다. 다음 바퀴의 `xreadgroup` 이 같은 상황을
            # `is_missing_group` 으로 잡아 다시 만든다.
            return []
        # redis-py 는 (next_cursor, messages) 또는 (next_cursor, messages, deleted) 를 준다.
        messages = result[1] if len(result) > 1 else []
        return [(message_id, fields) for message_id, fields in messages if fields]

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
