"""ai-worker 진입점.

    docker compose --profile ai up -d --scale ai-worker=3
    uv run --no-sync python -m ai_worker.main

`restart: always` 와 맞물리므로 **정상 종료가 중요하다.** SIGTERM 을 받으면 지금 집어 든
작업을 끝내고 루프를 나간다. 중간에 죽으면 그 작업은 `XACK` 되지 않아 pending 에 남고,
다른 워커가 `XAUTOCLAIM` 으로 회수한다 — 결과적으로 유실은 없지만 정상 종료가 회수를
기다리지 않게 해 준다.
"""

from __future__ import annotations

import asyncio
import contextlib
import signal

from ai_worker.consumer import PredictionConsumer, build_redis, describe_runtime
from ai_worker.core.logger import setup_logger
from ai_worker.ocr_consumer import OcrConsumer

logger = setup_logger("ai-worker")


async def main() -> int:
    # **연결을 둘로 나눈다.** 두 소비자가 하나를 공유하면 한쪽의 `XREADGROUP` 이
    # block 하는 동안 다른 쪽 명령이 그 뒤에 줄을 선다. 문서 인식은 왕복이 수십 초라
    # 예측 큐가 그만큼 멈춘다.
    predict_redis = build_redis()
    ocr_redis = build_redis()
    predict = PredictionConsumer(predict_redis)
    ocr = OcrConsumer(ocr_redis)

    loop = asyncio.get_running_loop()
    for name in ("SIGTERM", "SIGINT"):
        received = getattr(signal, name, None)
        if received is None:
            continue
        # Windows 는 add_signal_handler 를 지원하지 않는다. 컨테이너는 리눅스라
        # 실제 배포 경로에는 영향이 없고, 로컬에서 직접 돌릴 때만 건너뛴다.
        with contextlib.suppress(NotImplementedError):
            loop.add_signal_handler(received, _stop_both(predict, ocr))

    logger.info("runtime %s", describe_runtime())
    failed = 0
    try:
        # 한쪽이 예외로 죽어도 다른 쪽은 계속 돈다. `gather` 는 첫 예외에서
        # 나머지를 취소하므로 `return_exceptions` 로 갈라 받는다.
        results = await asyncio.gather(predict.run_forever(), ocr.run_forever(), return_exceptions=True)
        for outcome in results:
            if isinstance(outcome, BaseException):
                failed += 1
                logger.exception("소비자 하나가 예외로 종료", exc_info=outcome)
    finally:
        await predict_redis.aclose()
        await ocr_redis.aclose()
    # **여기서 0 을 돌려주면 안 된다.** 예전에는 예외를 로그로만 남기고 정상 반환했다.
    # 프로세스가 종료 코드 0 으로 끝나면 `docker compose ps` 에 `Restarting (0)` 으로
    # 찍히는데, 그건 "일을 마치고 깨끗이 끝났다" 로 읽혀서 장애를 알아보기 어렵다.
    # 실제로 이 상태의 워커를 정상으로 오해한 적이 있다. 비정상 종료는 비정상 코드로 낸다.
    return 1 if failed else 0


def _stop_both(*consumers: PredictionConsumer | OcrConsumer):
    def stop() -> None:
        for consumer in consumers:
            consumer.request_stop()

    return stop


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
