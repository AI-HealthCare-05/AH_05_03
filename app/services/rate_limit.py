"""Redis 고정창 속도 제한.

`invitation_store.py` 가 초대에 쓰던 `INCR` + `EXPIRE nx` 패턴을 재사용 가능한 모양으로
뽑았다. 예측 경로가 같은 것을 필요로 하는데, 거기서 다시 쓰면 두 벌이 된다.

**고정창을 쓰는 이유.** 슬라이딩 윈도우가 더 정확하지만 정렬 집합과 정리 작업이 붙는다.
이 제품이 막으려는 것은 정밀한 초당 제어가 아니라 **한 계정이 큐를 채워 다른 사용자의
작업을 밀어내는 것**이다. 고정창은 경계에서 최대 2 배까지 통과시키지만 그 정도는 상한을
절반으로 잡으면 흡수된다.

**Redis 가 죽으면 막는다(fail-closed).** 토큰 denylist 는 `AUTH_FAIL_OPEN_ON_REDIS_ERROR`
로 열어 둘 수 있지만 속도 제한은 반대다 — 열어 두면 Redis 장애가 곧 무제한 요청이 되고,
큐가 채워지면 Redis 복구 뒤에도 한동안 밀린다.
"""

from __future__ import annotations

from redis.asyncio import Redis
from redis.exceptions import RedisError

from app.core import config
from app.exceptions import RateLimitedError, TokenStoreUnavailableError


class RateLimiter:
    def __init__(self, redis: Redis) -> None:
        self._redis = redis

    def _key(self, scope: str, identity: str) -> str:
        return f"{config.REDIS_KEY_PREFIX}:rate:{scope}:{identity}"

    async def hit(self, scope: str, identity: str, limit: int, window_seconds: int) -> int:
        """호출 수를 세고 상한을 넘으면 `RateLimitedError`. 현재 카운트를 돌려준다.

        `EXPIRE ... nx` 가 중요하다. 매번 만료를 다시 걸면 요청이 계속 들어오는 한
        창이 끝나지 않아 카운터가 영영 안 풀린다.
        """
        key = self._key(scope, identity)
        try:
            async with self._redis.pipeline(transaction=True) as pipe:
                pipe.incr(key)
                pipe.expire(key, window_seconds, nx=True)
                # 남은 창 길이. **같은 파이프라인에 넣는다** — 막힌 뒤에 따로 물으면
                # 왕복이 한 번 더 늘고, 그 사이 창이 바뀌어 값이 어긋날 수도 있다.
                pipe.ttl(key)
                current, _, ttl = await pipe.execute()
        except RedisError as err:
            # 열어 두지 않는다. 위 모듈 설명 참조.
            raise TokenStoreUnavailableError() from err

        count = int(current)
        if count > limit:
            # **`Retry-After` 를 준다.** 없으면 클라이언트가 언제 다시 걸어야 하는지
            # 알 수 없어 되는대로 재시도하고, 그게 다시 상한에 걸려 창이 끝나도
            # 계속 429 를 맞는다. RFC 6585 도 429 에 이 헤더를 권한다.
            # TTL 이 음수면(-1 만료없음 / -2 키없음) 창 길이로 되돌린다.
            retry_after = int(ttl) if isinstance(ttl, int) and ttl > 0 else window_seconds
            raise RateLimitedError(
                f"요청이 너무 잦습니다. {window_seconds}초 안에 {limit}회까지 가능합니다.",
                headers={"Retry-After": str(retry_after)},
            )
        return count

    async def remaining(self, scope: str, identity: str, limit: int) -> int:
        """남은 횟수. 관측용이라 실패해도 예외를 올리지 않는다."""
        try:
            current = await self._redis.get(self._key(scope, identity))
        except RedisError:
            return limit
        return max(0, limit - int(current or 0))
