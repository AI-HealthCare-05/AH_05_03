"""문서 인식 소비자. Redis Stream 에서 원본을 받아 Gemini 로 구조화하고 결과를 되쓴다.

`consumer.py`(예측)와 같은 구조이고 같은 이유로 소비자 그룹·`XAUTOCLAIM` 회수를 쓴다.
다른 점 셋만 적는다.

**하나 — 재시도 상한이 더 낮다.** 외부 유료 API 호출이라 재시도가 곧 비용이다.
`DEV_OCR_JOB_MAX_ATTEMPTS` 는 2 이고 예측은 3 이다.

**둘 — 회수 대기가 더 길다.** Gemini 왕복이 수십 초까지 걸린다. 예측과 같은 60 초를
쓰면 정상 처리 중인 작업을 다른 워커가 뺏어 가 같은 문서를 두 번 보낸다 — 비용이
두 배가 되고 결과도 갈린다. `DEV_OCR_JOB_RECLAIM_IDLE_MS` 는 180 초다.

**셋 — 배치가 작다.** 한 작업이 이미지 여러 장을 물고 있어 메모리를 크게 쓴다.
`DEV_OCR_JOB_BATCH` 는 2 다.

**넷 — 진행 중 조각을 흘린다.** 예측은 1.3ms 라 보여 줄 중간이 없지만 문서 인식은
수십 초다. Gemini 가 흘리는 청크를 Redis 스트림에 실어 FastAPI 의 SSE 라우터가
브라우저로 중계한다 — 워커는 HTTP 를 서빙하지 않아 브라우저와 직접 이을 수 없다.
조각 쓰기가 실패해도 인식은 계속한다. 스트리밍은 UX 이고 결과는 기능이다.

로그에 파일명·본문·인식 결과를 남기지 않는다. 찍는 것은 `job_id`·상태·소요 시간뿐이다.
"""

from __future__ import annotations

import asyncio
import base64
import os
import socket
import time

from redis.asyncio import Redis
from redis.exceptions import ConnectionError as RedisConnectionError
from redis.exceptions import ResponseError
from redis.exceptions import TimeoutError as RedisTimeoutError

from ai_worker.core.logger import setup_logger
from app.core import config
from app.core.jobs import OcrJobStore
from app.core.redis.resilience import ensure_group_with_retry, is_missing_group
from app.exceptions import OcrUnavailableError
from app.services.dev_ocr import recognize_parts

logger = setup_logger("ai-worker.ocr")


class OcrConsumer:
    def __init__(self, redis: Redis) -> None:
        self.store = OcrJobStore(redis)
        self.consumer = f"{socket.gethostname()}-{os.getpid()}"
        self._stopping = asyncio.Event()
        self._pruned_at = 0.0
        # 부분 결과 전달 실패를 작업당 한 번만 로그로 남기기 위한 표시.
        self._chunk_warned = False

    def request_stop(self) -> None:
        self._stopping.set()

    async def run_forever(self) -> None:
        # 루프 안에서 재시도한다 — 이유는 `app/core/redis/resilience.py` 참조.
        # 그냥 await 하면 Redis 순단 한 번에 프로세스가 종료 코드 0 으로 끝나고
        # `restart: always` 와 맞물려 영구 재시작 루프가 된다.
        if not await ensure_group_with_retry(self.store.ensure_group, self._stopping, logger):
            return
        logger.info(
            "started · group=%s consumer=%s bridge=%s",
            config.DEV_OCR_JOB_STREAM_GROUP,
            self.consumer,
            "on" if config.ENABLE_DEV_OCR_BRIDGE else "OFF",
        )
        if not config.ENABLE_DEV_OCR_BRIDGE:
            # 죽지 않고 계속 돈다. 브리지는 기본 꺼짐이고, 여기서 종료하면
            # restart:always 와 맞물려 재시작 루프가 된다.
            logger.warning("문서 인식 브리지가 꺼져 있다. 들어오는 작업은 즉시 실패로 확정된다")

        while not self._stopping.is_set():
            batch = await self._next_batch()
            if batch is None:
                continue

            for message_id, job_id in batch:
                await self._handle(message_id, job_id)

            await self._prune_dead_consumers()

        await self.store.drop_consumer(self.consumer)
        logger.info("stopped · consumer=%s", self.consumer)

    async def _next_batch(self) -> list[tuple[str, str]] | None:
        """처리할 작업을 가져온다. Redis 문제로 못 가져오면 `None`.

        `consumer.py` 의 같은 이름 메서드와 구조가 같고 상한 값만 다르다.
        """
        try:
            claimed = await self.store.reclaim_stale(self.consumer, config.DEV_OCR_JOB_BATCH)
            if claimed:
                logger.info("죽은 소비자 몫 %d건 회수", len(claimed))
            fresh = await self.store.claim(
                self.consumer,
                config.DEV_OCR_JOB_BATCH,
                config.DEV_OCR_JOB_STREAM_BLOCK_MS,
            )
        except RedisTimeoutError:
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
        moment = time.monotonic()
        if moment - self._pruned_at < config.DEV_OCR_JOB_PRUNE_INTERVAL_SECONDS:
            return
        self._pruned_at = moment
        dropped = await self.store.prune_consumers(config.DEV_OCR_JOB_CONSUMER_IDLE_MS, keep=self.consumer)
        if dropped:
            logger.info("죽은 소비자 등록 %d개 정리", len(dropped))

    async def _handle(self, message_id: str, job_id: str) -> None:
        started = time.perf_counter()
        payload = await self.store.take_payload(job_id, self.consumer)
        if payload is None:
            await self.store.ack(message_id)
            logger.info("job=%s 만료 또는 중복 — 건너뜀", job_id)
            return

        attempts = await self.store.attempts(job_id)
        try:
            files = [(base64.b64decode(item["b64"]), item["mime"]) for item in payload.get("files", [])]
        except Exception:  # noqa: BLE001 - 본문을 로그에 남기지 않는다
            await self.store.fail(job_id, "PAYLOAD_INVALID")
            await self.store.ack(message_id)
            logger.warning("job=%s payload 해독 실패 — 재시도하지 않는다", job_id)
            return

        try:
            # 진행 중 조각을 Redis 에 흘린다. FastAPI 의 SSE 라우터가 그걸 읽어
            # 브라우저로 중계한다 — 워커는 HTTP 를 서빙하지 않으므로 브라우저와
            # 직접 이어질 수 없다.
            #
            # **조각 쓰기가 실패해도 인식은 계속한다.** 스트리밍은 UX 이고 결과는
            # 기능이다. Redis 가 잠깐 흔들렸다고 다 끝난 인식을 버리면 그건 손해다.
            result = await recognize_parts(files, on_event=self._forward(job_id))
        except OcrUnavailableError as error:
            # 브리지 꺼짐·키 없음·형식 미지원은 다시 시도해도 같은 답이다.
            await self.store.fail(job_id, "OCR_UNAVAILABLE")
            await self.store.ack(message_id)
            logger.warning("job=%s 확정 실패: %s", job_id, error.message)
            return
        except Exception:  # noqa: BLE001 - 어떤 예외든 작업 하나만 죽어야 한다
            logger.exception("job=%s 인식 중 예외", job_id)
            await self._retry_or_fail(message_id, job_id, attempts, "RECOGNITION_FAILED")
            return

        await self.store.succeed(job_id, result)
        await self.store.ack(message_id)
        logger.info(
            "job=%s 완료 · 표 %d개 · %.0fms · attempts=%d",
            job_id,
            len(result.get("tables", [])),
            (time.perf_counter() - started) * 1000,
            attempts,
        )

    def _forward(self, job_id: str):
        """`recognize_parts` 가 부를 콜백. 조각을 Redis 로 옮긴다.

        완성 결과(`kind == "result"`)는 흘리지 않는다 — 그건 `succeed()` 가 작업
        해시에 쓰는 것이 단일 진실 원천이다. 두 곳에 쓰면 어느 쪽이 맞는지 판단해야
        하는 순간이 온다.
        """

        async def forward(event: dict) -> None:
            kind = event.get("kind")
            try:
                if kind == "delta":
                    await self.store.append_delta(job_id, event["text"])
                elif kind == "reset":
                    await self.store.append_reset(job_id)
            except Exception:  # noqa: BLE001 - 스트리밍은 UX, 결과는 기능이다
                # 로그도 한 번만 남기고 만다. 청크마다 찍으면 로그가 뒤덮인다.
                if not self._chunk_warned:
                    self._chunk_warned = True
                    logger.warning("job=%s 부분 결과 전달 실패 — 인식은 계속한다", job_id)

        self._chunk_warned = False
        return forward

    async def _retry_or_fail(self, message_id: str, job_id: str, attempts: int, error: str) -> None:
        if attempts >= config.DEV_OCR_JOB_MAX_ATTEMPTS:
            await self.store.fail(job_id, error)
            await self.store.ack(message_id)
            logger.error("job=%s %s · 재시도 %d회 초과로 확정 실패", job_id, error, attempts)
            return
        logger.warning("job=%s %s · 재배달 대기 (attempts=%d)", job_id, error, attempts)
