import uuid
from datetime import datetime, timezone

from redis.asyncio import Redis
from redis.exceptions import RedisError

from app.core import config, default_logger
from app.exceptions import (
    TokenReuseDetectedError,
    TokenRevokedError,
    TokenStoreUnavailableError,
)

# 만료 시각을 모를 때 쓰는 상한 (refresh 전체 수명)
_FULL_REFRESH_TTL = config.REFRESH_TOKEN_EXPIRE_MINUTES * 60
_FULL_ACCESS_TTL = config.ACCESS_TOKEN_EXPIRE_MINUTES * 60


class TokenStore:
    """refresh 토큰 allowlist + access 토큰 denylist.

    denylist가 아니라 allowlist인 이유: 회전을 쓰면 계정당 살아 있는 refresh는
    몇 개뿐이라 크기가 유계다. 그리고 키가 없으면 곧 거부이므로 구조적으로
    fail-closed다. denylist는 eviction이 일어나면 조용히 무효화가 풀린다.
    """

    def __init__(self, redis: Redis) -> None:
        self._redis = redis
        self._prefix = config.REDIS_KEY_PREFIX

    # --- 키 --------------------------------------------------------
    def _rt(self, account_id: uuid.UUID, jti: str) -> str:
        return f"{self._prefix}:rt:{account_id}:{jti}"

    def _rt_used(self, jti: str) -> str:
        return f"{self._prefix}:rt:used:{jti}"

    def _rt_index(self, account_id: uuid.UUID) -> str:
        return f"{self._prefix}:rt:acct:{account_id}"

    def _at_denied(self, jti: str) -> str:
        return f"{self._prefix}:at:denied:{jti}"

    @staticmethod
    def _ttl(exp: int | None, fallback: int) -> int:
        if exp is None:
            return fallback
        remaining = exp - int(datetime.now(tz=timezone.utc).timestamp())
        return max(remaining, 1)

    # --- refresh ---------------------------------------------------
    async def register_refresh(self, account_id: uuid.UUID, jti: str, exp: int | None = None) -> None:
        ttl = self._ttl(exp, _FULL_REFRESH_TTL)
        try:
            async with self._redis.pipeline(transaction=True) as pipe:
                pipe.set(self._rt(account_id, jti), "1", ex=ttl)
                pipe.sadd(self._rt_index(account_id), jti)
                pipe.expire(self._rt_index(account_id), _FULL_REFRESH_TTL + 60)
                await pipe.execute()
        except RedisError as err:
            raise TokenStoreUnavailableError() from err

    async def consume_refresh(self, account_id: uuid.UUID, jti: str, exp: int | None = None) -> None:
        """회전 시 refresh 토큰을 원자적으로 소비한다.

        GETDEL 하나로 단일 소비자 의미가 보장되어 Lua 스크립트가 필요 없다.
        탭 두 개가 동시에 갱신하면 하나만 성공하고 나머지는 401을 받는다.
        """
        try:
            if await self._redis.getdel(self._rt(account_id, jti)) is None:
                if await self._redis.exists(self._rt_used(jti)):
                    # 이미 회전에 쓰인 토큰이 다시 왔다 = 탈취 정황.
                    # 해당 계정의 refresh 패밀리를 통째로 무효화한다.
                    default_logger.warning("refresh token reuse detected for account %s", account_id)
                    await self.revoke_all_refresh(account_id)
                    raise TokenReuseDetectedError()
                raise TokenRevokedError()

            # GETDEL 이후의 기록은 원자적일 필요가 없다. 중간에 죽어도
            # 토큰이 무효화된 상태로 남을 뿐이라 안전한 방향이다.
            async with self._redis.pipeline(transaction=True) as pipe:
                pipe.srem(self._rt_index(account_id), jti)
                pipe.set(self._rt_used(jti), str(account_id), ex=self._ttl(exp, _FULL_REFRESH_TTL))
                await pipe.execute()
        except RedisError as err:
            raise TokenStoreUnavailableError() from err

    async def revoke_all_refresh(self, account_id: uuid.UUID) -> None:
        try:
            jtis = await self._redis.smembers(self._rt_index(account_id))
            async with self._redis.pipeline(transaction=True) as pipe:
                for jti in jtis:
                    pipe.delete(self._rt(account_id, jti))
                    # used 마커를 남겨 두면, 대량 무효화 이후의 재사용이
                    # 단순 REVOKED가 아니라 REUSE_DETECTED로 잡힌다.
                    pipe.set(self._rt_used(jti), str(account_id), ex=_FULL_REFRESH_TTL)
                pipe.delete(self._rt_index(account_id))
                await pipe.execute()
        except RedisError as err:
            raise TokenStoreUnavailableError() from err

    # --- access ----------------------------------------------------
    async def deny_access(self, jti: str, exp: int | None = None) -> None:
        try:
            await self._redis.set(self._at_denied(jti), "1", ex=self._ttl(exp, _FULL_ACCESS_TTL))
        except RedisError as err:
            raise TokenStoreUnavailableError() from err

    async def assert_access_active(self, jti: str) -> None:
        try:
            if await self._redis.exists(self._at_denied(jti)):
                raise TokenRevokedError()
        except RedisError as err:
            # 비상 스위치는 여기에만 적용된다. 노출 창은 access 수명(15분)으로
            # 묶인다. 회전·등록·무효화는 항상 fail-closed다.
            if config.AUTH_FAIL_OPEN_ON_REDIS_ERROR:
                default_logger.error("token store unavailable; failing open on access check")
                return
            raise TokenStoreUnavailableError() from err
