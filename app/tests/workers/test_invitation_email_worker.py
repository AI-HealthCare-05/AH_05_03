import uuid
from typing import Any, cast

from fakeredis.aioredis import FakeRedis

from app.services.invitation_store import InvitationDelivery, InvitationStore
from app.workers.invitation_email_worker import (
    InvitationEmailWorker,
    build_invitation_message,
    build_invitation_url,
)


class RecordingSender:
    def __init__(self) -> None:
        self.deliveries: list[InvitationDelivery] = []

    async def send(self, delivery: InvitationDelivery) -> None:
        self.deliveries.append(delivery)


class TestInvitationEmailWorker:
    def test_invitation_link_keeps_token_in_fragment(self, monkeypatch) -> None:
        monkeypatch.setattr("app.core.config.INVITATION_WEB_ORIGIN", "http://127.0.0.1:4173")
        delivery = InvitationDelivery(uuid.uuid4(), "recipient@example.com", "a" * 43)

        url = build_invitation_url(delivery)
        message = build_invitation_message(delivery)

        assert url.startswith("http://127.0.0.1:4173/account#invitation=")
        assert "?" not in url
        assert delivery.token in url
        assert "email=recipient%40example.com" in url
        assert message["To"] == delivery.invitee_email
        plain_body = message.get_body(preferencelist=("plain",))
        assert plain_body is not None
        assert url in plain_body.get_content()

    def test_invitation_link_uses_the_origin_the_invite_came_from(self, monkeypatch) -> None:
        """배포 도메인을 설정에 안 적어도 열리는 링크가 나간다.

        메일은 요청 문맥이 없는 워커가 보내므로, 초대를 만든 요청의 오리진을 실어
        보내지 않으면 설정 기본값(`localhost:5173`)이 그대로 메일에 박힌다.
        """
        monkeypatch.setattr("app.core.config.INVITATION_WEB_ORIGIN", "http://localhost:5173")
        delivery = InvitationDelivery(
            uuid.uuid4(), "recipient@example.com", "a" * 43, web_origin="https://ieobom.example"
        )

        url = build_invitation_url(delivery)

        assert url.startswith("https://ieobom.example/account#invitation=")
        assert "localhost" not in url

    async def test_delivery_origin_survives_the_redis_round_trip(self, fake_redis: FakeRedis) -> None:
        """워커가 읽어 갈 때까지 오리진이 살아 있어야 링크가 맞다."""
        invitation_id = uuid.uuid4()
        store = InvitationStore(fake_redis)

        await store.register(invitation_id, "recipient@example.com", "a" * 43, 300, "https://ieobom.example")
        delivery = await store.take_delivery(invitation_id)

        assert delivery is not None
        assert delivery.web_origin == "https://ieobom.example"

        # SMTP 실패 뒤 재시도해도 첫 메일과 같은 주소로 가야 한다.
        await store.requeue_delivery(delivery, 300)
        requeued = await store.take_delivery(invitation_id)

        assert requeued is not None
        assert requeued.web_origin == "https://ieobom.example"

    async def test_stream_event_is_sent_and_acknowledged(self, fake_redis: FakeRedis) -> None:
        invitation_id = uuid.uuid4()
        store = InvitationStore(fake_redis)
        await store.register(invitation_id, "recipient@example.com", "a" * 43, 300)
        sender = RecordingSender()
        worker = InvitationEmailWorker(fake_redis, sender)
        await worker._ensure_group()
        streams = cast(
            list[tuple[str, list[tuple[str, dict[str, str]]]]],
            await cast(Any, fake_redis).xreadgroup(
                worker.group,
                worker.consumer,
                {worker.stream: ">"},
                count=1,
            ),
        )

        _, messages = streams[0]
        message_id, fields = messages[0]
        await worker._process(message_id, fields)

        assert len(sender.deliveries) == 1
        assert sender.deliveries[0].invitation_id == invitation_id
        pending = await fake_redis.xpending(worker.stream, worker.group)
        assert pending["pending"] == 0
        assert await store.take_delivery(invitation_id) is None
