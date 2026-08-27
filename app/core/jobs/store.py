"""예측 작업 큐의 Redis 조작. 생산자(FastAPI)와 소비자(ai-worker)가 같이 쓴다.

Redis Streams 를 쓰는 이유는 소비자 그룹이다. **워커를 3 개로 띄웠을 때 같은 작업이
두 번 채점되면 안 된다.** 리스트(`LPUSH`/`BRPOP`)로도 분배는 되지만 소비자가 죽으면
가져간 작업이 사라진다. 스트림은 `XACK` 전까지 pending 목록에 남고 `XAUTOCLAIM` 으로
회수할 수 있다.

`app/workers/invitation_email_worker.py` 가 이미 같은 패턴을 쓴다. 다른 점 하나는
**여기는 `XAUTOCLAIM` 을 넣었다** — 초대 메일 워커는 한 대만 띄우므로 회수가 없어도
당장 문제가 없지만, 3 대가 도는 큐에서는 한 대가 죽을 때 그 몫이 영구히 멈춘다.
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
from app.core.jobs.contract import (
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
    JobStatus,
    job_key,
    stream_key,
)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class PredictionJobStore:
    def __init__(self, redis: Redis) -> None:
        self.redis = redis
        self.stream = stream_key()

    # -- 생산자 --------------------------------------------------------

    async def enqueue(self, payload: dict[str, Any]) -> str:
        """작업을 등록하고 `job_id` 를 돌려준다.

        해시를 먼저 쓰고 스트림에 넣는 순서가 중요하다. 반대로 하면 워커가 스트림
        메시지를 먼저 집어 해시가 아직 없는 상태를 만난다.
        """
        job_id = uuid.uuid4().hex
        key = job_key(job_id)
        pipe = self.redis.pipeline()
        pipe.hset(
            key,
            mapping={
                FIELD_STATUS: JobStatus.QUEUED.value,
                FIELD_PAYLOAD: json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
                FIELD_CREATED_AT: _now(),
                FIELD_ATTEMPTS: "0",
            },
        )
        pipe.expire(key, config.PREDICTION_JOB_TTL_SECONDS)
        pipe.xadd(
            self.stream,
            {MESSAGE_FIELD_JOB_ID: job_id},
            maxlen=config.PREDICTION_JOB_STREAM_MAXLEN,
            approximate=True,
        )
        await pipe.execute()
        return job_id

    async def read(self, job_id: str) -> dict[str, str] | None:
        """상태 조회. **payload 는 돌려주지 않는다** — 되읽을 이유가 없다."""
        fields = cast(dict[str, str], await self.redis.hgetall(job_key(job_id)))
        if not fields:
            return None
        return {name: value for name, value in fields.items() if name != FIELD_PAYLOAD}

    async def pending_count(self) -> int:
        """아직 `XACK` 되지 않은 작업 수. 큐가 밀리는지 보는 값이다."""
        try:
            summary = cast(
                dict[str, Any],
                await cast(Any, self.redis).xpending(self.stream, config.PREDICTION_JOB_STREAM_GROUP),
            )
        except ResponseError:
            return 0
        return int(summary.get("pending", 0) or 0)

    # -- 소비자 --------------------------------------------------------

    async def ensure_group(self) -> None:
        try:
            await self.redis.xgroup_create(self.stream, config.PREDICTION_JOB_STREAM_GROUP, id="0", mkstream=True)
        except ResponseError as err:
            if "BUSYGROUP" not in str(err):
                raise

    async def claim(self, consumer: str, count: int, block_ms: int) -> list[tuple[str, str]]:
        """새 작업을 가져온다. `(message_id, job_id)` 목록."""
        streams = cast(
            list[tuple[str, list[tuple[str, dict[str, str]]]]],
            await cast(Any, self.redis).xreadgroup(
                groupname=config.PREDICTION_JOB_STREAM_GROUP,
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
                groupname=config.PREDICTION_JOB_STREAM_GROUP,
                consumername=consumer,
                min_idle_time=config.PREDICTION_JOB_RECLAIM_IDLE_MS,
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
        key = job_key(job_id)
        raw = cast("str | None", await self.redis.hget(key, FIELD_PAYLOAD))
        if raw is None:
            return None
        await self.redis.hset(
            key,
            mapping={
                FIELD_STATUS: JobStatus.RUNNING.value,
                FIELD_STARTED_AT: _now(),
                FIELD_WORKER: worker,
            },
        )
        await self.redis.hincrby(key, FIELD_ATTEMPTS, 1)
        return cast(dict[str, Any], json.loads(raw))

    async def succeed(self, job_id: str, result: dict[str, Any]) -> None:
        """결과를 쓰고 **payload 를 즉시 지운다.** ADR-010 §6 의 조건이다."""
        key = job_key(job_id)
        pipe = self.redis.pipeline()
        pipe.hset(
            key,
            mapping={
                FIELD_STATUS: JobStatus.SUCCEEDED.value,
                FIELD_RESULT: json.dumps(result, ensure_ascii=False, separators=(",", ":")),
                FIELD_FINISHED_AT: _now(),
            },
        )
        pipe.hdel(key, FIELD_PAYLOAD)
        pipe.expire(key, config.PREDICTION_JOB_TTL_SECONDS)
        await pipe.execute()

    async def fail(self, job_id: str, error: str) -> None:
        """실패도 payload 를 지운다. 재시도는 `attempts` 로 판단하되 본문은 남기지 않는다."""
        key = job_key(job_id)
        pipe = self.redis.pipeline()
        pipe.hset(
            key,
            mapping={
                FIELD_STATUS: JobStatus.FAILED.value,
                FIELD_ERROR: error,
                FIELD_FINISHED_AT: _now(),
            },
        )
        pipe.hdel(key, FIELD_PAYLOAD)
        pipe.expire(key, config.PREDICTION_JOB_TTL_SECONDS)
        await pipe.execute()

    async def ack(self, message_id: str) -> None:
        await self.redis.xack(self.stream, config.PREDICTION_JOB_STREAM_GROUP, message_id)

    async def drop_consumer(self, consumer: str) -> None:
        """정상 종료할 때 소비자 등록을 지운다.

        `{hostname}-{pid}` 로 이름을 만드는데 컨테이너를 재시작하면 pid 가 바뀌어
        **새 이름이 생기고 옛 이름은 그룹에 영원히 남는다.** 워커 3 대를 한 번
        재시작했더니 소비자가 6 개였다. 그대로 두면 `XINFO CONSUMERS` 와
        `XAUTOCLAIM` 이 훑는 목록이 배포할 때마다 늘어난다.
        """
        with contextlib.suppress(ResponseError):
            await self.redis.xgroup_delconsumer(self.stream, config.PREDICTION_JOB_STREAM_GROUP, consumer)

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
                await cast(Any, self.redis).xinfo_consumers(self.stream, config.PREDICTION_JOB_STREAM_GROUP),
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
        raw = cast("str | None", await self.redis.hget(job_key(job_id), FIELD_ATTEMPTS))
        return int(raw or 0)
