from fastapi import Request
from redis.asyncio import Redis

from app.core import config


def create_redis_pool() -> Redis:
    return Redis.from_url(
        config.REDIS_URL,
        decode_responses=True,
        max_connections=config.REDIS_MAX_CONNECTIONS,
        # 타임아웃을 짧게 잡아, 장애 시 매달리지 않고 빠르게 503으로 떨어지게 한다.
        socket_timeout=config.REDIS_SOCKET_TIMEOUT,
        socket_connect_timeout=config.REDIS_SOCKET_CONNECT_TIMEOUT,
        health_check_interval=30,
    )


async def close_redis_pool(client: Redis) -> None:
    await client.aclose()


async def get_redis(request: Request) -> Redis:
    """모듈 싱글턴이 아니라 의존성인 이유.

    httpx의 ASGITransport는 lifespan을 실행하지 않아 테스트에서는
    app.state.redis가 없다. 의존성이어야 dependency_overrides로
    fakeredis를 끼워 넣을 수 있다.
    """
    redis: Redis = request.app.state.redis
    return redis
