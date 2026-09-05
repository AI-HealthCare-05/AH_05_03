from fastapi import Request
from redis.asyncio import BlockingConnectionPool, Redis

from app.core import config


def create_redis_pool() -> Redis:
    """**`BlockingConnectionPool` 이어야 한다.**

    기본 `ConnectionPool` 은 `max_connections` 에 닿는 순간 기다리지 않고
    `MaxConnectionsError` 를 던진다(redis-py `get_available_connection`). 그 예외는
    `RedisError` 라서 `TokenStoreUnavailableError` 로 잡히고 사용자에게 503 이 나간다.
    Redis 는 멀쩡한데 "일시적으로 서비스를 이용할 수 없습니다" 를 보는 것이다.

    2026-08-27 에 다중 유저 부하로 재현했다 — 동시 로그인 10 건 중 1~4 건이 503 이었고,
    같은 설정을 직접 두드리니 동시 40 건에서 정확히 20 건이 `Too many connections` 였다.
    상한이 곧 동시 사용자 상한이었던 셈이다.

    `BlockingConnectionPool` 은 조건 변수로 **대기했다가** `timeout` 이 지나야 포기한다.
    큐가 잠깐 몰리면 밀리초 단위로 순서를 기다릴 뿐 요청이 죽지 않는다.

    `socket_timeout` 은 명령 왕복 상한이고, 풀 대기 상한과는 별개다. OCR 이미지처럼 큰
    명령은 전송 시간을 확보하되 Redis 에 연결조차 못 하는 경우는 짧은
    `socket_connect_timeout` 으로 끊는다.
    """
    pool = BlockingConnectionPool.from_url(
        config.REDIS_URL,
        decode_responses=True,
        max_connections=config.REDIS_MAX_CONNECTIONS,
        # 풀이 빌 때까지 기다리는 상한. `ConnectionPool` 에는 없는 인자다.
        timeout=config.REDIS_POOL_WAIT_TIMEOUT,
        # 큰 OCR payload 왕복 상한과 연결 실패 상한은 서로 다른 설정이다.
        socket_timeout=config.REDIS_SOCKET_TIMEOUT,
        socket_connect_timeout=config.REDIS_SOCKET_CONNECT_TIMEOUT,
        health_check_interval=30,
    )
    # **`Redis(connection_pool=...)` 이 아니라 `from_pool` 이다.** 전자는 풀 소유권을
    # 가져가지 않아서 `aclose()` 가 풀을 안 닫는다 — lifespan 종료 때 연결이 그대로
    # 남는다. `from_pool` 은 소유권을 넘겨받아 같이 닫으므로, 풀을 쓰기 전 동작과
    # 종료 의미가 같아진다.
    return Redis.from_pool(pool)


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
