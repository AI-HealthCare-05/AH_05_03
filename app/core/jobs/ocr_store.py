"""문서 인식 작업 큐의 Redis 조작. 생산자(FastAPI)와 소비자(ai-worker)가 같이 쓴다.

`store.py`(예측 큐)와 같은 구조다. 소비자 그룹·`XAUTOCLAIM` 회수·payload 즉시 삭제가
전부 같은 이유로 필요하고, 다른 것은 키 공간과 TTL·상한뿐이다.

**왜 복사했는가.** 예측 큐와 하나로 묶으면 스트림·그룹·TTL·상한을 전부 파라미터로
받아야 하고, 그 순간 "이 값이 어느 큐의 것인가" 가 호출부로 흩어진다. 계약 파일을
따로 둔 이유(`ocr_contract.py`)와 같다 — 큐는 프로세스 경계를 넘으므로 잘못 묶이면
증상이 "조용히 아무 일도 안 일어남" 이다.
"""

from __future__ import annotations

import contextlib
import json
import uuid
from datetime import datetime, timezone
from typing import Any, cast

from redis.asyncio import Redis
from redis.exceptions import ResponseError

from app.core import config
from app.core.jobs.ocr_contract import (
    CHUNK_FIELD_KIND,
    CHUNK_FIELD_TEXT,
    CHUNK_KIND_DELTA,
    CHUNK_KIND_RESET,
    FIELD_ATTEMPTS,
    FIELD_CREATED_AT,
    FIELD_ERROR,
    FIELD_FINISHED_AT,
    FIELD_PAYLOAD,
    FIELD_RESULT,
    FIELD_STARTED_AT,
    FIELD_STATUS,
    FIELD_WORKER,
    MESSAGE_FIELD_JOB_ID,
    OcrJobStatus,
    ocr_chunk_key,
    ocr_job_key,
    ocr_stream_key,
)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class OcrJobStore:
    def __init__(self, redis: Redis) -> None:
        self.redis = redis
        self.stream = ocr_stream_key()

    # -- 생산자 --------------------------------------------------------

    async def enqueue(self, payload: dict[str, Any]) -> str:
        """작업을 등록하고 `job_id` 를 돌려준다.

        해시를 먼저 쓰고 스트림에 넣는 순서가 중요하다. 반대로 하면 워커가 스트림
        메시지를 먼저 집어 해시가 아직 없는 상태를 만난다.
        """
        job_id = uuid.uuid4().hex
        key = ocr_job_key(job_id)
        pipe = self.redis.pipeline()
        pipe.hset(
            key,
            mapping={
                FIELD_STATUS: OcrJobStatus.QUEUED.value,
                FIELD_PAYLOAD: json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
                FIELD_CREATED_AT: _now(),
                FIELD_ATTEMPTS: "0",
            },
        )
        pipe.expire(key, config.DEV_OCR_JOB_TTL_SECONDS)
        pipe.xadd(
            self.stream,
            {MESSAGE_FIELD_JOB_ID: job_id},
            maxlen=config.DEV_OCR_JOB_STREAM_MAXLEN,
            approximate=True,
        )
        await pipe.execute()
        return job_id

    async def read(self, job_id: str) -> dict[str, str] | None:
        """상태 조회. **payload 는 돌려주지 않는다** — 되읽을 이유가 없다."""
        fields = cast(dict[str, str], await self.redis.hgetall(ocr_job_key(job_id)))
        if not fields:
            return None
        return {name: value for name, value in fields.items() if name != FIELD_PAYLOAD}

    async def pending_count(self) -> int:
        """아직 `XACK` 되지 않은 작업 수. 큐가 밀리는지 보는 값이다."""
        try:
            summary = cast(
                dict[str, Any],
                await cast(Any, self.redis).xpending(self.stream, config.DEV_OCR_JOB_STREAM_GROUP),
            )
        except ResponseError:
            return 0
        return int(summary.get("pending", 0) or 0)

    # -- 소비자 --------------------------------------------------------

    async def ensure_group(self) -> None:
        try:
            await self.redis.xgroup_create(self.stream, config.DEV_OCR_JOB_STREAM_GROUP, id="0", mkstream=True)
        except ResponseError as err:
            if "BUSYGROUP" not in str(err):
                raise

    async def claim(self, consumer: str, count: int, block_ms: int) -> list[tuple[str, str]]:
        """새 작업을 가져온다. `(message_id, job_id)` 목록."""
        streams = cast(
            list[tuple[str, list[tuple[str, dict[str, str]]]]],
            await cast(Any, self.redis).xreadgroup(
                groupname=config.DEV_OCR_JOB_STREAM_GROUP,
                consumername=consumer,
                streams={self.stream: ">"},
                count=count,
                block=block_ms,
            ),
        )
        return [
            (message_id, fields[MESSAGE_FIELD_JOB_ID])
            for _, messages in streams
            for message_id, fields in messages
            if MESSAGE_FIELD_JOB_ID in fields
        ]

    async def reclaim_stale(self, consumer: str, count: int) -> list[tuple[str, str]]:
        """죽은 소비자가 물고 있던 작업을 회수한다.

        3 대가 도는 큐에서 한 대가 SIGKILL 되면 그 대가 가져간 작업은 pending 에
        남아 아무도 안 본다. `min_idle_time` 이 지난 것만 다른 소비자에게 넘긴다.
        """
        try:
            result = await cast(Any, self.redis).xautoclaim(
                name=self.stream,
                groupname=config.DEV_OCR_JOB_STREAM_GROUP,
                consumername=consumer,
                min_idle_time=config.DEV_OCR_JOB_RECLAIM_IDLE_MS,
                count=count,
            )
        except ResponseError:
            return []
        # redis-py 는 (next_cursor, messages) 또는 (next_cursor, messages, deleted) 를 준다.
        messages = result[1] if len(result) > 1 else []
        return [
            (message_id, fields[MESSAGE_FIELD_JOB_ID])
            for message_id, fields in messages
            if fields and MESSAGE_FIELD_JOB_ID in fields
        ]

    async def take_payload(self, job_id: str, worker: str) -> dict[str, Any] | None:
        """payload 를 읽고 `running` 으로 표시한다. 없으면 None."""
        key = ocr_job_key(job_id)
        raw = cast("str | None", await self.redis.hget(key, FIELD_PAYLOAD))
        if raw is None:
            return None
        await self.redis.hset(
            key,
            mapping={
                FIELD_STATUS: OcrJobStatus.RUNNING.value,
                FIELD_STARTED_AT: _now(),
                FIELD_WORKER: worker,
            },
        )
        await self.redis.hincrby(key, FIELD_ATTEMPTS, 1)
        return cast(dict[str, Any], json.loads(raw))

    async def succeed(self, job_id: str, result: dict[str, Any]) -> None:
        """결과를 쓰고 **원본을 즉시 지운다.** ADR-010 §6 의 조건이다."""
        key = ocr_job_key(job_id)
        pipe = self.redis.pipeline()
        pipe.hset(
            key,
            mapping={
                FIELD_STATUS: OcrJobStatus.SUCCEEDED.value,
                FIELD_RESULT: json.dumps(result, ensure_ascii=False, separators=(",", ":")),
                FIELD_FINISHED_AT: _now(),
            },
        )
        pipe.hdel(key, FIELD_PAYLOAD)
        pipe.expire(key, config.DEV_OCR_JOB_TTL_SECONDS)
        await pipe.execute()

    async def fail(self, job_id: str, error: str) -> None:
        """실패도 원본을 지운다. 재시도는 `attempts` 로 판단하되 본문은 남기지 않는다."""
        key = ocr_job_key(job_id)
        pipe = self.redis.pipeline()
        pipe.hset(
            key,
            mapping={
                FIELD_STATUS: OcrJobStatus.FAILED.value,
                FIELD_ERROR: error,
                FIELD_FINISHED_AT: _now(),
            },
        )
        pipe.hdel(key, FIELD_PAYLOAD)
        pipe.expire(key, config.DEV_OCR_JOB_TTL_SECONDS)
        # **부분 결과도 같이 지운다.** 성공했으면 완성본이 해시에 있으니 조각은 그
        # 부분집합이라 TTL 로 두면 되지만, 실패는 대응하는 결과가 없다. 남겨 두면
        # 아무도 안 읽을 인식 내용이 Redis 에 120초 더 머문다.
        pipe.delete(ocr_chunk_key(job_id))
        await pipe.execute()

    async def ack(self, message_id: str) -> None:
        await self.redis.xack(self.stream, config.DEV_OCR_JOB_STREAM_GROUP, message_id)

    async def drop_consumer(self, consumer: str) -> None:
        """정상 종료할 때 소비자 등록을 지운다.

        `{hostname}-{pid}` 로 이름을 만드는데 컨테이너를 재시작하면 pid 가 바뀌어
        **새 이름이 생기고 옛 이름은 그룹에 영원히 남는다.** 워커 3 대를 한 번
        재시작했더니 소비자가 6 개였다. 그대로 두면 `XINFO CONSUMERS` 와
        `XAUTOCLAIM` 이 훑는 목록이 배포할 때마다 늘어난다.
        """
        with contextlib.suppress(ResponseError):
            await self.redis.xgroup_delconsumer(self.stream, config.DEV_OCR_JOB_STREAM_GROUP, consumer)

    async def prune_consumers(self, idle_ms: int, keep: str) -> list[str]:
        """오래 놀고 pending 이 0 인 소비자를 정리한다. 지운 이름 목록.

        정상 종료가 항상 오지는 않는다 — `docker kill` 이나 OOM 은 `drop_consumer`
        를 못 부른다. 그래서 살아 있는 워커가 주기적으로 훑어 청소한다.

        **pending 이 남은 소비자는 건드리지 않는다.** 지우면 그 소비자가 물고 있던
        작업이 pending 목록째 사라져 유실된다. 회수는 `XAUTOCLAIM` 이 하고,
        회수가 끝나 pending 이 0 이 된 뒤에야 여기서 정리된다.
        """
        try:
            consumers = cast(
                list[dict[str, Any]],
                await cast(Any, self.redis).xinfo_consumers(self.stream, config.DEV_OCR_JOB_STREAM_GROUP),
            )
        except ResponseError:
            return []

        dropped = []
        for entry in consumers:
            name = str(entry.get("name", ""))
            if not name or name == keep:
                continue
            if int(entry.get("pending", 0) or 0) > 0:
                continue
            if int(entry.get("idle", 0) or 0) < idle_ms:
                continue
            await self.drop_consumer(name)
            dropped.append(name)
        return dropped

    async def attempts(self, job_id: str) -> int:
        raw = cast("str | None", await self.redis.hget(ocr_job_key(job_id), FIELD_ATTEMPTS))
        return int(raw or 0)

    # -- 부분 결과 (스트리밍) -------------------------------------------
    #
    # 워커가 Gemini 청크를 여기 흘리고 FastAPI 의 SSE 라우터가 읽어 중계한다.
    # 완성 결과는 여기 오지 않는다 — 그건 위 `succeed` 가 쓰는 해시의 `result` 다.

    async def append_delta(self, job_id: str, text: str) -> None:
        """새로 해독된 텍스트 조각을 싣는다."""
        await self._append(job_id, CHUNK_KIND_DELTA, text)

    async def append_reset(self, job_id: str) -> None:
        """앞 모델이 도중에 실패해 다시 시작한다 — 지금까지 보여 준 것을 지우라는 신호."""
        await self._append(job_id, CHUNK_KIND_RESET, "")

    async def _append(self, job_id: str, kind: str, text: str) -> None:
        key = ocr_chunk_key(job_id)
        pipe = self.redis.pipeline()
        pipe.xadd(
            key,
            {CHUNK_FIELD_KIND: kind, CHUNK_FIELD_TEXT: text},
            maxlen=config.DEV_OCR_CHUNK_STREAM_MAXLEN,
            approximate=True,
        )
        # **매 청크마다 TTL 을 다시 건다.** 한 번만 걸면 인식이 TTL 보다 오래 걸릴 때
        # 진행 중인데도 조각이 사라진다. 마지막 청크로부터 이만큼이 수명이 된다.
        pipe.expire(key, config.DEV_OCR_CHUNK_TTL_SECONDS)
        await pipe.execute()

    async def read_chunks(self, job_id: str, after_id: str) -> list[tuple[str, str, str]]:
        """`after_id` 뒤의 조각을 읽는다. `(message_id, kind, text)`.

        `after_id` 는 배타적이다. 처음 붙는 쪽은 `"0"` 을 주면 시작부터 다 받는다 —
        SSE 가 재연결해도 글이 중간부터 시작하지 않는 것이 이 덕분이다.
        """
        entries = cast(
            list[tuple[str, dict[str, str]]],
            await self.redis.xrange(ocr_chunk_key(job_id), min=f"({after_id}", max="+"),
        )
        return [
            (message_id, fields.get(CHUNK_FIELD_KIND, ""), fields.get(CHUNK_FIELD_TEXT, ""))
            for message_id, fields in entries
        ]

    async def drop_chunks(self, job_id: str) -> None:
        """조각을 지운다. 완성본이 해시에 들어간 뒤에는 남길 이유가 없다."""
        await self.redis.delete(ocr_chunk_key(job_id))
