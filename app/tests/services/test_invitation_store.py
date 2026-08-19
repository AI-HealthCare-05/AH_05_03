import uuid

import pytest
from fakeredis.aioredis import FakeRedis

from app.exceptions import InvitationTokenReusedError, RateLimitedError
from app.services.invitation_store import InvitationStore


class TestInvitationStore:
    async def test_delivery_and_token_are_single_use(self, fake_redis: FakeRedis) -> None:
        store = InvitationStore(fake_redis)
        invitation_id = uuid.uuid4()
        token = "a" * 43

        await store.register(invitation_id, "recipient@example.com", token, 300)
        delivery = await store.take_delivery(invitation_id)

        assert delivery is not None
        assert delivery.token == token
        assert await store.take_delivery(invitation_id) is None

        await store.consume(invitation_id, token)
        with pytest.raises(InvitationTokenReusedError):
            await store.consume(invitation_id, token)

    async def test_account_rate_limit_is_enforced(self, fake_redis: FakeRedis, monkeypatch: pytest.MonkeyPatch) -> None:
        store = InvitationStore(fake_redis)
        account_id = uuid.uuid4()
        monkeypatch.setattr("app.core.config.FAMILY_INVITATION_ACCOUNT_RATE_LIMIT", 2)

        await store.enforce_create_rate(account_id, "one@example.com")
        await store.enforce_create_rate(account_id, "two@example.com")
        with pytest.raises(RateLimitedError):
            await store.enforce_create_rate(account_id, "three@example.com")
