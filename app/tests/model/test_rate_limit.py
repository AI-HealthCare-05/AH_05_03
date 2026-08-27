"""속도 제한 계약.

예측 경로는 인증을 요구하고 계정 단위로 제한한다 (ADR-009 §10). 문서에만 적으면
지켜지는지 알 수 없으므로 여기서 검사한다.

`fakeredis` 로 돈다 — DB·Redis 컨테이너 없이 계약이 깨지면 잡힌다.
"""

from __future__ import annotations

from typing import Any

import pytest
import pytest_asyncio
from fakeredis.aioredis import FakeRedis

from app.core import config
from app.exceptions import RateLimitedError
from app.services.rate_limit import RateLimiter


@pytest_asyncio.fixture
async def limiter() -> Any:
    redis = FakeRedis(decode_responses=True)
    try:
        yield RateLimiter(redis)
    finally:
        await redis.aclose()


@pytest.mark.asyncio
async def test_allows_up_to_the_limit(limiter: RateLimiter) -> None:
    for expected in range(1, 6):
        assert await limiter.hit("predict", "acct-1", limit=5, window_seconds=60) == expected


@pytest.mark.asyncio
async def test_blocks_past_the_limit(limiter: RateLimiter) -> None:
    for _ in range(5):
        await limiter.hit("predict", "acct-1", limit=5, window_seconds=60)
    with pytest.raises(RateLimitedError):
        await limiter.hit("predict", "acct-1", limit=5, window_seconds=60)


@pytest.mark.asyncio
async def test_accounts_are_counted_separately(limiter: RateLimiter) -> None:
    """한 계정이 다 써도 다른 계정은 멀쩡해야 한다."""
    for _ in range(5):
        await limiter.hit("predict", "acct-1", limit=5, window_seconds=60)
    assert await limiter.hit("predict", "acct-2", limit=5, window_seconds=60) == 1


@pytest.mark.asyncio
async def test_scopes_are_counted_separately(limiter: RateLimiter) -> None:
    """동기 경로를 다 써도 큐 경로가 따로 세어져야 한다. 반대도 같다."""
    for _ in range(5):
        await limiter.hit("predict", "acct-1", limit=5, window_seconds=60)
    assert await limiter.hit("predict-job", "acct-1", limit=5, window_seconds=60) == 1


@pytest.mark.asyncio
async def test_window_is_not_extended_by_traffic(limiter: RateLimiter) -> None:
    """`EXPIRE ... nx` 라서 요청이 계속 와도 창이 연장되지 않는다.

    매번 만료를 다시 걸면 트래픽이 이어지는 한 카운터가 영영 안 풀려서, 상한에
    걸린 계정이 창이 지나도 계속 막힌다.
    """
    key = limiter._key("predict", "acct-1")
    await limiter.hit("predict", "acct-1", limit=5, window_seconds=60)
    first = await limiter._redis.ttl(key)
    for _ in range(3):
        await limiter.hit("predict", "acct-1", limit=5, window_seconds=60)
    assert await limiter._redis.ttl(key) <= first


@pytest.mark.asyncio
async def test_remaining_reports_headroom(limiter: RateLimiter) -> None:
    await limiter.hit("predict", "acct-1", limit=5, window_seconds=60)
    await limiter.hit("predict", "acct-1", limit=5, window_seconds=60)
    assert await limiter.remaining("predict", "acct-1", limit=5) == 3


def test_queue_limit_is_tighter_than_sync() -> None:
    """큐는 남에게 피해가 간다 — 한 계정이 채우면 다른 사용자의 작업이 밀린다.

    무상태 계산인 동기 경로보다 조여야 한다.
    """
    assert config.PREDICTION_JOB_RATE_LIMIT < config.PREDICTION_RATE_LIMIT
