"""ai-worker 진입점.

컨테이너는 이 모듈을 실행한다. 작업이 없으면 스트림을 블로킹으로 기다리며
살아 있고, SIGTERM을 받으면 처리 중인 작업을 끝낸 뒤 멈춘다.
"""

from __future__ import annotations

import asyncio
import signal

from redis.asyncio import Redis

from ai_worker.consumer import Worker
from ai_worker.core import config, logger


def _create_redis() -> Redis:
    return Redis.from_url(
        config.REDIS_URL,
        decode_responses=True,
        max_connections=config.REDIS_MAX_CONNECTIONS,
        # XREADGROUP이 block 동안 응답 없이 매달려 있다. 소켓 타임아웃이
        # 그보다 짧으면 대기할 때마다 예외가 난다. API 쪽의 0.5초와 다른 이유다.
        socket_timeout=config.WORKER_BLOCK_MS / 1000 + 5,
        socket_connect_timeout=5,
        health_check_interval=30,
    )


async def _run() -> None:
    redis = _create_redis()
    worker = Worker(redis)

    loop = asyncio.get_running_loop()
    try:
        for sig in (signal.SIGINT, signal.SIGTERM):
            loop.add_signal_handler(sig, worker.stop)
    except NotImplementedError:
        # Windows에는 add_signal_handler가 없다. 컨테이너는 리눅스지만
        # 개발 PC에서 직접 띄우는 경우를 위해 폴백을 둔다.
        signal.signal(signal.SIGINT, lambda *_: worker.stop())

    try:
        await worker.run()
    finally:
        await redis.aclose()


def main() -> None:
    logger.info("AI Worker를 시작합니다.")
    asyncio.run(_run())
    logger.info("AI Worker를 종료합니다.")


if __name__ == "__main__":
    main()
