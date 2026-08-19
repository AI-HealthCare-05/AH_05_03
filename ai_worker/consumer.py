"""Redis Streams 소비자.

한 프로세스가 소비자 여러 개를 asyncio 태스크로 돌린다. 소비자 그룹이 하나라
같은 작업을 둘이 집는 일은 없고, 워커 컨테이너를 늘리면 그대로 병렬 처리가 된다.

ack하지 않은 작업은 그룹의 PEL에 남는다. 워커가 죽어 ack가 끊기면
_reclaim_loop가 회수해 다시 처리한다. 무한 재시도를 막으려고 시도 횟수를
결과 레코드에 세고 상한을 넘기면 실패로 확정한다.
"""

from __future__ import annotations

import asyncio
import uuid
from typing import Any

from redis.asyncio import Redis
from redis.exceptions import RedisError, ResponseError

from ai_worker.core import config, logger
from ai_worker.tasks import REGISTRY
from app.core.errors import DEFAULT_MESSAGE, ErrorCode
from app.core.jobs import CONSUMER_GROUP, JobRecord, JobStatus, JobStore, TaskName
from app.exceptions import AppError

#: 스트림 항목 하나. decode_responses=True라 양쪽 다 str이다.
StreamMessage = tuple[str, dict[str, str]]


def _read_messages(batches: Any) -> list[StreamMessage]:
    """XREADGROUP 응답에서 항목만 꺼낸다: [[스트림명, [(id, 필드), ...]], ...]

    redis-py의 반환 타입이 느슨해서 형태를 여기 한 곳에서만 좁힌다.
    """
    messages: list[StreamMessage] = []
    for batch in batches or []:
        messages.extend(batch[1])
    return messages


def _claimed_messages(claimed: Any) -> list[StreamMessage]:
    """XAUTOCLAIM 응답에서 항목만 꺼낸다: [커서, [(id, 필드), ...], [삭제된 id]]"""
    messages: list[StreamMessage] = []
    if len(claimed) > 1:
        messages.extend(claimed[1])
    return messages


class Worker:
    def __init__(self, redis: Redis) -> None:
        self._redis = redis
        self._store = JobStore(redis)
        self._stream = self._store.keys.stream
        self._stop = asyncio.Event()

    def stop(self) -> None:
        logger.info("종료 신호를 받았습니다. 처리 중인 작업을 끝내고 멈춥니다.")
        self._stop.set()

    async def run(self) -> None:
        await self._ensure_group()
        logger.info(
            "스트림 %s 소비를 시작합니다 (소비자 %d개, 등록된 작업 %s)",
            self._stream,
            config.WORKER_CONCURRENCY,
            ", ".join(sorted(task.value for task in REGISTRY)),
        )
        tasks = [
            asyncio.create_task(self._consume(f"consumer-{index}"), name=f"consumer-{index}")
            for index in range(config.WORKER_CONCURRENCY)
        ]
        tasks.append(asyncio.create_task(self._reclaim_loop(), name="reclaimer"))
        await asyncio.gather(*tasks)
        logger.info("모든 소비자가 멈췄습니다.")

    async def drain_once(self, consumer: str = "drain") -> int:
        """지금 큐에 있는 작업만 처리하고 돌아온다.

        블로킹 대기를 하지 않는다. 상주 없이 한 번만 비우고 싶을 때와
        테스트에서 큐 왕복을 확인할 때 쓴다.
        """
        await self._ensure_group()
        processed = 0
        while True:
            batches = await self._redis.xreadgroup(CONSUMER_GROUP, consumer, {self._stream: ">"}, count=16)
            messages = _read_messages(batches)
            if not messages:
                return processed
            for message_id, fields in messages:
                await self._handle(message_id, fields)
                processed += 1

    async def _ensure_group(self) -> None:
        try:
            await self._redis.xgroup_create(self._stream, CONSUMER_GROUP, id="0", mkstream=True)
        except ResponseError as err:
            # 이미 있는 그룹을 다시 만들면 BUSYGROUP이 난다. 워커가 여럿이면 정상이다.
            if "BUSYGROUP" not in str(err):
                raise

    async def _consume(self, name: str) -> None:
        while not self._stop.is_set():
            try:
                batches = await self._redis.xreadgroup(
                    CONSUMER_GROUP,
                    name,
                    {self._stream: ">"},
                    count=1,
                    block=config.WORKER_BLOCK_MS,
                )
            except RedisError:
                logger.exception("%s: 스트림을 읽지 못했습니다. 잠시 후 다시 시도합니다.", name)
                await self._sleep(1.0)
                continue

            for message_id, fields in _read_messages(batches):
                await self._handle(message_id, fields)

    async def _reclaim_loop(self) -> None:
        """죽은 워커가 붙잡고 있던 작업을 회수한다."""
        while not await self._sleep(config.WORKER_CLAIM_INTERVAL_SECONDS):
            try:
                claimed = await self._redis.xautoclaim(
                    self._stream,
                    CONSUMER_GROUP,
                    "reclaimer",
                    min_idle_time=config.WORKER_CLAIM_MIN_IDLE_MS,
                    count=16,
                )
            except RedisError:
                logger.exception("밀린 작업을 회수하지 못했습니다.")
                continue

            messages = _claimed_messages(claimed)
            if messages:
                logger.warning("%d개 작업을 회수해 다시 처리합니다.", len(messages))
            for message_id, fields in messages:
                await self._handle(message_id, fields)

    async def _handle(self, message_id: str, fields: dict[str, str]) -> None:
        try:
            job_id = uuid.UUID(fields["job_id"])
            task = TaskName(fields["task"])
        except (KeyError, ValueError):
            logger.error("해석할 수 없는 항목이라 버립니다: %s %r", message_id, fields)
            await self._ack(message_id)
            return

        if task not in REGISTRY:
            logger.error("등록되지 않은 작업이라 버립니다: %s", task)
            await self._ack(message_id)
            return

        record = await self._store.read(job_id)
        if record is None:
            # 결과 레코드가 TTL로 사라졌으면 호출자도 이미 포기한 뒤다.
            await self._finish(job_id, message_id)
            return

        record.attempts += 1
        if record.attempts > config.WORKER_MAX_ATTEMPTS:
            logger.error("작업 %s이 %d번 시도 후에도 끝나지 않아 실패로 확정합니다.", job_id, record.attempts - 1)
            await self._fail(record, ErrorCode.INTERNAL_ERROR, "작업을 여러 번 시도했지만 끝내지 못했습니다.")
            await self._finish(job_id, message_id)
            return

        record.status = JobStatus.RUNNING
        await self._store.write(record)

        payload = await self._store.read_payload(job_id)
        if payload is None:
            await self._fail(
                record, ErrorCode.INTERNAL_ERROR, "작업 입력의 유효 시간이 지났습니다. 다시 시도해 주세요."
            )
            await self._finish(job_id, message_id)
            return

        try:
            record.result = await REGISTRY[task](payload)
            record.status = JobStatus.SUCCEEDED
            await self._store.write(record)
            logger.info("작업 %s (%s) 완료", job_id, task.value)
        except AppError as err:
            # 서비스 계층이 계약한 실패다. 오류 코드를 그대로 호출자에게 넘긴다.
            await self._fail(record, err.error_code, err.message)
            logger.info("작업 %s (%s) 실패: %s", job_id, task.value, err.error_code.value)
        except Exception:
            logger.exception("작업 %s (%s) 처리 중 예상 못한 오류", job_id, task.value)
            await self._fail(record, ErrorCode.INTERNAL_ERROR, DEFAULT_MESSAGE[ErrorCode.INTERNAL_ERROR])
        finally:
            await self._finish(job_id, message_id)

    async def _fail(self, record: JobRecord, error_code: ErrorCode, message: str) -> None:
        record.status = JobStatus.FAILED
        record.error_code = error_code.value
        record.error_message = message
        await self._store.write(record)

    async def _finish(self, job_id: uuid.UUID, message_id: str) -> None:
        """처리가 끝난 작업을 정리한다.

        페이로드 삭제가 먼저다. 검진문서 이미지는 건강정보라서 Redis에 남는
        시간을 최소로 줄인다 (docs/05_tech_architecture.md 2절).
        """
        await self._store.discard_payload(job_id)
        await self._ack(message_id)

    async def _ack(self, message_id: str) -> None:
        # 결과는 별도 키에 있으므로 스트림에 원본을 남길 이유가 없다.
        async with self._redis.pipeline(transaction=True) as pipe:
            pipe.xack(self._stream, CONSUMER_GROUP, message_id)
            pipe.xdel(self._stream, message_id)
            await pipe.execute()

    async def _sleep(self, seconds: float) -> bool:
        """종료 신호를 기다리며 쉰다. 종료면 True, 시간이 다 됐으면 False."""
        try:
            await asyncio.wait_for(self._stop.wait(), timeout=seconds)
        except TimeoutError:
            return False
        return True
