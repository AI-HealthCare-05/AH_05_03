"""작업 큐 저장소. 생산자(app)와 소비자(ai_worker)가 함께 쓴다.

Redis Streams를 고른 이유는 셋이다.
- 소비자 그룹이 있어 워커를 늘리면 그대로 병렬 처리가 된다.
- ack가 있어 워커가 중간에 죽어도 작업이 사라지지 않는다 (XAUTOCLAIM 재배달).
- 이미 초대 전송에서 같은 방식을 쓰고 있어 운영 방법이 하나로 유지된다.
"""

from __future__ import annotations

import base64
import uuid

from redis.asyncio import Redis
from redis.exceptions import RedisError

from app.core import config
from app.core.jobs.contract import JobKeys, JobRecord, JobStatus, TaskName
from app.exceptions import JobStoreUnavailableError


class JobStore:
    def __init__(self, redis: Redis) -> None:
        self._redis = redis
        self.keys = JobKeys(config.REDIS_KEY_PREFIX)

    async def enqueue(self, *, task: TaskName, payload: bytes, owner_account_id: uuid.UUID) -> JobRecord:
        job_id = uuid.uuid4()
        record = JobRecord(
            job_id=job_id,
            task=task,
            status=JobStatus.QUEUED,
            owner_account_id=owner_account_id,
        )
        try:
            async with self._redis.pipeline(transaction=True) as pipe:
                pipe.set(self.keys.payload(job_id), _encode(payload), ex=config.JOB_PAYLOAD_TTL_SECONDS)
                pipe.set(self.keys.record(job_id), record.model_dump_json(), ex=config.JOB_RECORD_TTL_SECONDS)
                # Stream에는 식별자만 둔다. 이미지 본문은 별도 키에 두고 처리 직후 지운다.
                pipe.xadd(
                    self.keys.stream,
                    {"job_id": str(job_id), "task": task.value},
                    maxlen=config.JOB_STREAM_MAXLEN,
                    approximate=True,
                )
                await pipe.execute()
        except RedisError as err:
            raise JobStoreUnavailableError() from err
        return record

    async def read(self, job_id: uuid.UUID) -> JobRecord | None:
        try:
            raw = await self._redis.get(self.keys.record(job_id))
        except RedisError as err:
            raise JobStoreUnavailableError() from err
        if raw is None:
            return None
        return JobRecord.model_validate_json(raw)

    async def write(self, record: JobRecord) -> None:
        try:
            await self._redis.set(
                self.keys.record(record.job_id),
                record.model_dump_json(),
                ex=config.JOB_RECORD_TTL_SECONDS,
            )
        except RedisError as err:
            raise JobStoreUnavailableError() from err

    async def read_payload(self, job_id: uuid.UUID) -> bytes | None:
        """처리 직전에 읽는다. 삭제는 discard_payload가 따로 한다.

        여기서 바로 지우지 않는 이유: 워커가 처리 중에 죽으면 재배달된 작업이
        읽을 것이 없어진다. TTL이 짧아 방치돼도 오래 남지 않는다.
        """
        try:
            raw = await self._redis.get(self.keys.payload(job_id))
        except RedisError as err:
            raise JobStoreUnavailableError() from err
        return None if raw is None else base64.b64decode(raw)

    async def discard_payload(self, job_id: uuid.UUID) -> None:
        try:
            await self._redis.delete(self.keys.payload(job_id))
        except RedisError as err:
            raise JobStoreUnavailableError() from err


def _encode(payload: bytes) -> str:
    # 연결 풀이 decode_responses=True다. 바이너리를 그대로 넣으면 응답을
    # UTF-8로 디코딩하다 깨지므로 base64로 감싼다.
    return base64.b64encode(payload).decode("ascii")
