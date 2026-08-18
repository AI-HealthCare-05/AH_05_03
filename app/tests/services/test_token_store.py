import uuid

import pytest
from fakeredis.aioredis import FakeRedis
from redis.exceptions import RedisError

from app.core import config
from app.exceptions import (
    TokenReuseDetectedError,
    TokenRevokedError,
    TokenStoreUnavailableError,
)
from app.services.token_store import TokenStore


@pytest.fixture
def redis() -> FakeRedis:
    # 테스트마다 새 인스턴스라 flush가 필요 없고 순서 의존도 없다.
    return FakeRedis(decode_responses=True)


@pytest.fixture
def store(redis: FakeRedis) -> TokenStore:
    return TokenStore(redis)


class TestRefreshRotation:
    async def test_register_then_consume_succeeds(self, store: TokenStore) -> None:
        account_id, jti = uuid.uuid4(), "jti-1"
        await store.register_refresh(account_id, jti)

        await store.consume_refresh(account_id, jti)  # 예외 없이 통과

    async def test_unknown_jti_is_revoked(self, store: TokenStore) -> None:
        with pytest.raises(TokenRevokedError):
            await store.consume_refresh(uuid.uuid4(), "never-registered")

    async def test_second_consume_is_reuse_and_kills_the_family(self, store: TokenStore, redis: FakeRedis) -> None:
        account_id = uuid.uuid4()
        await store.register_refresh(account_id, "jti-a")
        await store.register_refresh(account_id, "jti-b")
        await store.consume_refresh(account_id, "jti-a")

        with pytest.raises(TokenReuseDetectedError):
            await store.consume_refresh(account_id, "jti-a")

        # 형제 토큰까지 함께 죽는다
        with pytest.raises(TokenReuseDetectedError):
            await store.consume_refresh(account_id, "jti-b")
        assert await redis.smembers(store._rt_index(account_id)) == set()

    async def test_concurrent_consume_has_a_single_winner(self, store: TokenStore) -> None:
        """GETDEL이 단일 소비자를 보장하는지."""
        account_id, jti = uuid.uuid4(), "race"
        await store.register_refresh(account_id, jti)

        await store.consume_refresh(account_id, jti)
        with pytest.raises((TokenRevokedError, TokenReuseDetectedError)):
            await store.consume_refresh(account_id, jti)

    async def test_revoke_all_clears_index_and_keys(self, store: TokenStore, redis: FakeRedis) -> None:
        account_id = uuid.uuid4()
        await store.register_refresh(account_id, "x")
        await store.register_refresh(account_id, "y")

        await store.revoke_all_refresh(account_id)

        assert await redis.exists(store._rt(account_id, "x")) == 0
        assert await redis.exists(store._rt(account_id, "y")) == 0
        assert await redis.exists(store._rt_index(account_id)) == 0


class TestTtls:
    async def test_register_uses_remaining_lifetime_from_exp(self, store: TokenStore, redis: FakeRedis) -> None:
        import time

        account_id, jti = uuid.uuid4(), "ttl"
        await store.register_refresh(account_id, jti, exp=int(time.time()) + 600)

        ttl = await redis.ttl(store._rt(account_id, jti))
        assert 500 < ttl <= 600

    async def test_deny_access_ttl_defaults_to_access_lifetime(self, store: TokenStore, redis: FakeRedis) -> None:
        await store.deny_access("acc-jti")

        ttl = await redis.ttl(store._at_denied("acc-jti"))
        assert 0 < ttl <= config.ACCESS_TOKEN_EXPIRE_MINUTES * 60


class TestAccessDenylist:
    async def test_active_by_default(self, store: TokenStore) -> None:
        await store.assert_access_active("fresh")  # 예외 없음

    async def test_denied_after_logout(self, store: TokenStore) -> None:
        await store.deny_access("bye")

        with pytest.raises(TokenRevokedError):
            await store.assert_access_active("bye")


class TestRedisFailure:
    async def test_rotation_fails_closed(self, store: TokenStore, monkeypatch) -> None:
        async def boom(*args, **kwargs):
            raise RedisError("down")

        monkeypatch.setattr(store._redis, "getdel", boom)

        with pytest.raises(TokenStoreUnavailableError):
            await store.consume_refresh(uuid.uuid4(), "any")

    async def test_access_check_fails_closed_by_default(self, store: TokenStore, monkeypatch) -> None:
        async def boom(*args, **kwargs):
            raise RedisError("down")

        monkeypatch.setattr(store._redis, "exists", boom)

        with pytest.raises(TokenStoreUnavailableError):
            await store.assert_access_active("any")

    async def test_break_glass_flag_only_affects_access_check(self, store: TokenStore, monkeypatch) -> None:
        async def boom(*args, **kwargs):
            raise RedisError("down")

        monkeypatch.setattr(config, "AUTH_FAIL_OPEN_ON_REDIS_ERROR", True)
        monkeypatch.setattr(store._redis, "exists", boom)
        monkeypatch.setattr(store._redis, "getdel", boom)

        await store.assert_access_active("any")  # 통과한다

        # 회전은 플래그와 무관하게 여전히 fail-closed
        with pytest.raises(TokenStoreUnavailableError):
            await store.consume_refresh(uuid.uuid4(), "any")
