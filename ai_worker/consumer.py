"""예측 작업 소비자. Redis Stream 에서 작업을 받아 채점하고 결과를 되쓴다.

## 3 대를 띄워도 중복이 없는 이유

Redis 소비자 그룹은 한 메시지를 그룹 안의 **한 소비자에게만** 배달한다. 워커마다
`{hostname}-{pid}` 로 다른 이름을 쓰므로 세 대가 서로 다른 작업을 나눠 갖는다.
`--scale ai-worker=3` 으로 늘려도 코드는 그대로다.

리스트(`BRPOP`)로도 분배는 되지만 소비자가 죽는 순간 물고 있던 작업이 사라진다.
스트림은 `XACK` 전까지 pending 에 남고 `XAUTOCLAIM` 으로 회수할 수 있다. 3 대가 도는
큐에서는 이게 선택이 아니다 — 한 대가 죽으면 그 몫이 영구히 멈추기 때문이다.

## 왜 채점 코드를 여기에 다시 쓰지 않는가

`app.services.prediction.build_prediction` 을 부른다. 동기 라우터가 부르는 것과 같은
함수다. 두 벌로 두면 같은 입력에 다른 답이 나올 수 있고, 그건 사용자가 예측을 두 번
눌렀을 때 설명할 수 없는 동작이 된다. 그래서 이 이미지는 `app/` 을 함께 담는다.

## 실패 처리

스키마 오류는 생산자(`POST /predictions/jobs`)가 이미 막았으므로 여기 도달하는 실패는
모델 미적재나 예상 못 한 예외다. `PREDICTION_JOB_MAX_ATTEMPTS` 까지 재배달하고 넘으면
`failed` 로 확정하고 `XACK` 한다 — 무한 재배달이 큐를 막는 것이 더 나쁘다.

로그에 건강 수치를 남기지 않는다. 찍는 것은 `job_id`·상태·소요 시간뿐이다.
"""

from __future__ import annotations

import asyncio
import os
import socket
import time
from typing import Any

from pydantic import ValidationError
from redis.asyncio import Redis
from redis.exceptions import ConnectionError as RedisConnectionError
from redis.exceptions import ResponseError
from redis.exceptions import TimeoutError as RedisTimeoutError

from ai_worker.core.logger import setup_logger
from app.core import config
from app.core.jobs import PredictionJobStore
from app.core.redis.resilience import ensure_group_with_retry, is_missing_group
from app.dtos.predictions import RiskPredictionRequest
from app.services.prediction import build_prediction
from app.services.risk import registry

logger = setup_logger("ai-worker.predict")


class PredictionConsumer:
    def __init__(self, redis: Redis) -> None:
        self.store = PredictionJobStore(redis)
        # 컨테이너를 여러 개 띄우면 hostname 이 서로 다르다. 같은 호스트에서
        # 프로세스로 나눠 돌릴 때를 대비해 pid 도 붙인다.
        self.consumer = f"{socket.gethostname()}-{os.getpid()}"
        self._stopping = asyncio.Event()
        self._pruned_at = 0.0

    def request_stop(self) -> None:
        """SIGTERM 을 받았을 때. 지금 처리 중인 작업은 끝내고 나간다."""
        self._stopping.set()

    async def run_forever(self) -> None:
        # **루프 안에서 재시도한다.** 예전에는 여기서 곧장 `await ensure_group()` 을
        # 불렀는데, 기동 순간 Redis 가 아직 안 떠 있거나 잠깐 끊기면 이 줄이 예외를
        # 던지고 `run_forever` 가 죽었다. `main()` 은 그 예외를 로그로만 남기고 정상
        # 반환하므로 프로세스가 **종료 코드 0** 으로 끝나고, `restart: always` 가
        # 되살리면 또 같은 자리에서 죽는다. Redis 가 살아나도 스스로 회복하지 못하는
        # 영구 재시작 루프였다 — 실제로 `Restarting (0)` 상태로 발견했다.
        if not await ensure_group_with_retry(self.store.ensure_group, self._stopping, logger):
            return
        logger.info(
            "started · group=%s consumer=%s models=%s",
            config.PREDICTION_JOB_STREAM_GROUP,
            self.consumer,
            "loaded" if registry.available else "MISSING",
        )
        if not registry.available:
            # 죽지 않고 계속 돈다. 모델 볼륨이 늦게 붙는 경우가 있고, 여기서
            # 종료하면 restart:always 와 맞물려 재시작 루프가 된다.
            logger.warning("위험도 모델이 적재되지 않았다. /app/models 마운트를 확인하라")

        while not self._stopping.is_set():
            batch = await self._next_batch()
            if batch is None:
                continue

            for message_id, job_id in batch:
                await self._handle(message_id, job_id)

            await self._prune_dead_consumers()

        # 정상 종료면 내 등록을 지우고 나간다. 안 지우면 다음 기동 때 pid 가 달라져
        # 새 이름이 생기고 이 이름이 그룹에 영원히 남는다.
        await self.store.drop_consumer(self.consumer)
        logger.info("stopped · consumer=%s", self.consumer)

    async def _next_batch(self) -> list[tuple[str, str]] | None:
        """처리할 작업을 가져온다. Redis 문제로 못 가져오면 `None`.

        **Redis 쪽 사고를 여기 한곳에 모았다.** 셋 다 "다음 바퀴에 다시 해 보라" 로
        끝나므로 호출부는 `None` 하나만 보면 된다.
        """
        try:
            claimed = await self.store.reclaim_stale(self.consumer, config.PREDICTION_JOB_BATCH)
            if claimed:
                logger.info("죽은 소비자 몫 %d건 회수", len(claimed))
            fresh = await self.store.claim(
                self.consumer,
                config.PREDICTION_JOB_BATCH,
                config.PREDICTION_JOB_STREAM_BLOCK_MS,
            )
        except RedisTimeoutError:
            # `XREADGROUP` 이 block 만큼 매달렸을 뿐이다. 정상이다.
            return None
        except RedisConnectionError:
            logger.warning("Redis 연결이 끊겼다. 2초 뒤 재시도")
            await asyncio.sleep(2.0)
            return None
        except ResponseError as error:
            # Redis 가 재시작하면 지속화가 꺼져 있어 그룹이 통째로 사라진다.
            # 자세한 이유는 `app.core.redis.resilience.is_missing_group` 참조.
            if not is_missing_group(error):
                raise
            logger.warning("소비자 그룹이 사라졌다 (Redis 재시작으로 보인다). 다시 만든다")
            await ensure_group_with_retry(self.store.ensure_group, self._stopping, logger)
            return None
        return [*claimed, *fresh]

    async def _prune_dead_consumers(self) -> None:
        """죽은 소비자 등록을 주기적으로 정리한다.

        `docker kill` 이나 OOM 은 정상 종료 경로를 안 탄다. 살아 있는 워커가 훑어
        청소해야 목록이 무한히 늘지 않는다. pending 이 남은 소비자는 건드리지 않으므로
        회수 대기 중인 작업이 사라질 일은 없다.
        """
        moment = time.monotonic()
        if moment - self._pruned_at < config.PREDICTION_JOB_PRUNE_INTERVAL_SECONDS:
            return
        self._pruned_at = moment
        dropped = await self.store.prune_consumers(config.PREDICTION_JOB_CONSUMER_IDLE_MS, keep=self.consumer)
        if dropped:
            logger.info("죽은 소비자 등록 %d개 정리: %s", len(dropped), ", ".join(dropped))

    async def _handle(self, message_id: str, job_id: str) -> None:
        started = time.perf_counter()
        payload = await self.store.take_payload(job_id, self.consumer)
        if payload is None:
            # 해시가 TTL 로 사라졌거나 이미 처리됐다. 스트림에서만 치운다.
            await self.store.ack(message_id)
            logger.info("job=%s 만료 또는 중복 — 건너뜀", job_id)
            return

        attempts = await self.store.attempts(job_id)
        try:
            request = RiskPredictionRequest.model_validate(payload)
        except ValidationError:
            # 생산자가 막았어야 하는 경우다. 재시도해도 같은 결과이므로 즉시 확정한다.
            await self.store.fail(job_id, "VALIDATION_ERROR")
            await self.store.ack(message_id)
            logger.warning("job=%s 본문 검증 실패 — 재시도하지 않는다", job_id)
            return

        if not registry.available:
            await self._retry_or_fail(message_id, job_id, attempts, "MODEL_UNAVAILABLE")
            return

        try:
            # 모델 파일이 바뀌었으면 다시 읽는다. 재학습 후 워커를 재시작하지 않아도
            # 새 번들이 반영된다 — FastAPI 쪽 `get_registry` 와 같은 규칙이다.
            registry.refresh()
            data = build_prediction(request, registry)
        except Exception:  # noqa: BLE001 - 어떤 예외든 작업 하나만 죽어야 한다
            logger.exception("job=%s 채점 중 예외", job_id)
            await self._retry_or_fail(message_id, job_id, attempts, "SCORING_FAILED")
            return

        await self.store.succeed(job_id, data.model_dump(mode="json"))
        await self.store.ack(message_id)
        logger.info(
            "job=%s 완료 · 질환 %d건 · %.1fms · attempts=%d",
            job_id,
            len(data.conditions),
            (time.perf_counter() - started) * 1000,
            attempts,
        )

    async def _retry_or_fail(self, message_id: str, job_id: str, attempts: int, error: str) -> None:
        if attempts >= config.PREDICTION_JOB_MAX_ATTEMPTS:
            await self.store.fail(job_id, error)
            await self.store.ack(message_id)
            logger.error("job=%s %s · 재시도 %d회 초과로 확정 실패", job_id, error, attempts)
            return
        # XACK 하지 않는다. pending 에 남아 있다가 XAUTOCLAIM 으로 다시 잡힌다.
        logger.warning("job=%s %s · 재배달 대기 (attempts=%d)", job_id, error, attempts)


def build_redis() -> Redis:
    block_seconds = config.PREDICTION_JOB_STREAM_BLOCK_MS / 1_000
    return Redis.from_url(
        config.REDIS_URL,
        encoding="utf-8",
        decode_responses=True,
        # XREADGROUP 이 block 만큼 매달리므로 socket_timeout 이 그보다 커야 한다.
        # 짧게 두면 정상 대기가 타임아웃으로 잡혀 로그가 경고로 뒤덮인다.
        socket_timeout=block_seconds + 5,
        socket_connect_timeout=config.REDIS_SOCKET_CONNECT_TIMEOUT,
        health_check_interval=30,
    )


def describe_runtime() -> dict[str, Any]:
    """기동 로그용. 건강 수치는 담지 않는다."""
    return {
        "group": config.PREDICTION_JOB_STREAM_GROUP,
        "batch": config.PREDICTION_JOB_BATCH,
        "block_ms": config.PREDICTION_JOB_STREAM_BLOCK_MS,
        "job_ttl_s": config.PREDICTION_JOB_TTL_SECONDS,
        "max_attempts": config.PREDICTION_JOB_MAX_ATTEMPTS,
    }
