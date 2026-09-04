"""예측 작업 큐의 데이터 경계 계약.

`docs/adr/0010` §6 이 Redis 에 건강정보 payload 를 두는 것을 **네 조건 아래에서만**
허용했다. 조건을 문서에만 적어 두면 지켜지는지 알 수 없으므로 여기서 검사한다.

| 조건 | 검사 |
| --- | --- |
| TTL 이 있고 완료 즉시 payload 를 지운다 | `test_payload_is_deleted_on_success` · `test_ttl_is_set` |
| 키에 계정·프로필 식별자를 넣지 않는다 | `test_job_key_carries_no_account_identifier` |
| 지속화를 켜지 않는다 | compose 설정 — `test_compose_disables_redis_persistence` |
| 인식 텍스트·건강 수치를 로그에 남기지 않는다 | 상태 조회가 payload 를 돌려주지 않는지 확인 |

`fakeredis` 로 돈다 — 실제 Redis 컨테이너가 없어도 계약이 깨지면 잡힌다.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import pytest
import pytest_asyncio
from fakeredis.aioredis import FakeRedis

from app.core import config
from app.core.jobs import PredictionJobStore
from app.core.jobs.contract import (
    FIELD_CREATED_AT,
    FIELD_FINISHED_AT,
    FIELD_PAYLOAD,
    FIELD_STARTED_AT,
    FIELD_STATUS,
    JobStatus,
    job_key,
    stream_key,
)

PAYLOAD: dict[str, Any] = {
    "age": 54,
    "sex": "M",
    "height_cm": 173.0,
    "weight_kg": 78.0,
    "self_rated_health": 3,
    "sbp": 132.0,
    "dbp": 84.0,
}

COMPOSE = Path(__file__).resolve().parents[3] / "docker-compose.yml"
GROUP = config.PREDICTION_JOB_STREAM_GROUP


@pytest_asyncio.fixture
async def store() -> Any:
    redis = FakeRedis(decode_responses=True)
    try:
        yield PredictionJobStore(redis)
    finally:
        await redis.aclose()


@pytest.mark.asyncio
async def test_enqueue_then_read_never_exposes_payload(store: PredictionJobStore) -> None:
    """상태 조회는 payload 를 돌려주지 않는다. 되읽을 이유가 없다."""
    job_id = await store.enqueue(PAYLOAD)
    fields = await store.read(job_id)
    assert fields is not None
    assert FIELD_PAYLOAD not in fields
    assert fields[FIELD_STATUS] == JobStatus.QUEUED.value
    # 건강 수치가 어떤 값으로도 새 나가지 않는다.
    #
    # **시각 필드는 빼고 본다.** 예전에는 모든 값을 이어붙여 `"132"` 를 찾았는데,
    # `created_at` 의 마이크로초에 그 세 자리가 우연히 들어가면 통과하던 테스트가
    # 갑자기 깨졌다 — 실제로 `2026-08-27T06:55:10.571323+00:00` 에서 터졌다.
    # 시각은 우리가 만든 값이라 payload 가 새어 나올 통로가 아니다.
    timestamps = {FIELD_CREATED_AT, FIELD_STARTED_AT, FIELD_FINISHED_AT}
    exposed = "".join(value for name, value in fields.items() if name not in timestamps)
    assert "132" not in exposed


@pytest.mark.asyncio
async def test_ttl_is_set(store: PredictionJobStore) -> None:
    """작업 해시에 TTL 이 걸려야 한다. 안 걸리면 건강 수치가 영구히 남는다."""
    job_id = await store.enqueue(PAYLOAD)
    ttl = await store.redis.ttl(job_key(job_id))
    assert 0 < ttl <= config.PREDICTION_JOB_TTL_SECONDS


@pytest.mark.asyncio
async def test_payload_is_deleted_on_success(store: PredictionJobStore) -> None:
    """채점이 끝나면 payload 가 즉시 사라진다."""
    job_id = await store.enqueue(PAYLOAD)
    assert await store.redis.hget(job_key(job_id), FIELD_PAYLOAD) is not None

    await store.succeed(job_id, {"conditions": []})
    assert await store.redis.hget(job_key(job_id), FIELD_PAYLOAD) is None
    fields = await store.read(job_id)
    assert fields is not None and fields[FIELD_STATUS] == JobStatus.SUCCEEDED.value


@pytest.mark.asyncio
async def test_payload_is_deleted_on_failure(store: PredictionJobStore) -> None:
    """실패해도 payload 는 남기지 않는다. 재시도 판단은 attempts 로 한다."""
    job_id = await store.enqueue(PAYLOAD)
    await store.fail(job_id, "SCORING_FAILED")
    assert await store.redis.hget(job_key(job_id), FIELD_PAYLOAD) is None


@pytest.mark.asyncio
async def test_job_key_carries_no_account_identifier() -> None:
    """키는 무작위 UUID 뿐이어야 한다. 계정을 되짚을 수 있으면 안 된다."""
    key = job_key("0123456789abcdef0123456789abcdef")
    assert re.fullmatch(rf"{config.REDIS_KEY_PREFIX}:predict:job:[0-9a-f]{{32}}", key)


@pytest.mark.asyncio
async def test_one_job_goes_to_exactly_one_consumer(store: PredictionJobStore) -> None:
    """소비자 그룹이 중복 배달을 막는다. 워커 3 대의 근거가 이것이다."""
    await store.ensure_group()
    job_ids = [await store.enqueue(PAYLOAD) for _ in range(6)]

    seen: list[str] = []
    for consumer in ("worker-a", "worker-b", "worker-c"):
        claimed = await store.claim(consumer, count=10, block_ms=0)
        seen.extend(job_id for _, job_id in claimed)

    assert sorted(seen) == sorted(job_ids), "작업이 누락되거나 중복 배달됐다"
    assert len(seen) == len(set(seen)), "같은 작업이 두 소비자에게 갔다"


@pytest.mark.asyncio
async def test_unacked_work_is_reclaimable(store: PredictionJobStore) -> None:
    """XACK 하지 않은 작업은 pending 에 남아 회수 대상이 된다."""
    await store.ensure_group()
    job_id = await store.enqueue(PAYLOAD)
    claimed = await store.claim("dying-worker", count=10, block_ms=0)
    assert [j for _, j in claimed] == [job_id]
    # XACK 하지 않았으므로 pending 이다 — 다른 워커가 XAUTOCLAIM 으로 가져갈 수 있다
    assert await store.pending_count() == 1


@pytest.mark.asyncio
async def test_ack_removes_from_pending(store: PredictionJobStore) -> None:
    await store.ensure_group()
    await store.enqueue(PAYLOAD)
    claimed = await store.claim("worker-a", count=10, block_ms=0)
    for message_id, _ in claimed:
        await store.ack(message_id)
    assert await store.pending_count() == 0


@pytest.mark.asyncio
async def test_enqueued_payload_survives_revalidation(store: PredictionJobStore) -> None:
    """큐에 넣은 본문을 워커가 되검증할 수 있어야 한다.

    첫 판이 여기서 실패했다. `model_dump()` 가 `computed_field` 인 `bmi` 를 넣는데
    DTO 가 `extra="forbid"` 라서 되검증이 거부한다. **동기 경로에는 증상이 없다** —
    되검증을 하지 않기 때문이다. 큐를 건너는 경로에서만 드러나므로 계약으로 박는다.
    """
    from app.dtos.predictions import RiskPredictionRequest

    request = RiskPredictionRequest(
        age=54, sex="M", height_cm=173.0, weight_kg=78.0, self_rated_health=3, sbp=132.0, dbp=84.0
    )
    enqueued = request.model_dump(exclude_none=True, include=set(RiskPredictionRequest.model_fields))
    job_id = await store.enqueue(enqueued)

    payload = await store.take_payload(job_id, "worker-a")
    assert payload is not None
    # 워커가 하는 것과 같은 되검증. 여기서 터지면 큐에 들어간 모든 작업이 실패한다.
    restored = RiskPredictionRequest.model_validate(payload)
    assert restored.age == request.age
    assert restored.bmi == request.bmi


@pytest.mark.asyncio
async def test_consumer_registration_is_removed_on_stop(store: PredictionJobStore) -> None:
    """정상 종료하면 소비자 등록이 사라진다.

    `{hostname}-{pid}` 라서 컨테이너를 재시작하면 pid 가 바뀌어 새 이름이 생기고
    옛 이름이 그룹에 남는다. 실제로 워커 3 대를 한 번 재시작했더니 소비자가 6 개였다.
    """
    await store.ensure_group()
    await store.enqueue(PAYLOAD)
    claimed = await store.claim("worker-a", count=10, block_ms=0)
    for message_id, _ in claimed:
        await store.ack(message_id)

    await store.drop_consumer("worker-a")
    names = {c["name"] for c in await store.redis.xinfo_consumers(store.stream, GROUP)}
    assert "worker-a" not in names


@pytest.mark.asyncio
async def test_prune_keeps_consumers_that_still_hold_work(store: PredictionJobStore) -> None:
    """pending 이 남은 소비자는 지우지 않는다.

    지우면 그 소비자의 pending 목록이 통째로 사라져 작업이 유실된다. 회수는
    `XAUTOCLAIM` 이 하고, pending 이 0 이 된 뒤에야 정리 대상이 된다.
    """
    await store.ensure_group()
    await store.enqueue(PAYLOAD)
    await store.claim("busy-worker", count=10, block_ms=0)  # XACK 하지 않는다

    dropped = await store.prune_consumers(idle_ms=0, keep="other")
    assert "busy-worker" not in dropped
    names = {c["name"] for c in await store.redis.xinfo_consumers(store.stream, GROUP)}
    assert "busy-worker" in names
    assert await store.pending_count() == 1


@pytest.mark.asyncio
async def test_prune_removes_idle_empty_consumers(store: PredictionJobStore) -> None:
    """놀고 있고 pending 이 0 인 소비자는 정리된다. 자기 자신은 남긴다."""
    await store.ensure_group()
    await store.enqueue(PAYLOAD)
    claimed = await store.claim("gone-worker", count=10, block_ms=0)
    for message_id, _ in claimed:
        await store.ack(message_id)
    await store.claim("alive-worker", count=10, block_ms=0)

    dropped = await store.prune_consumers(idle_ms=0, keep="alive-worker")
    assert "gone-worker" in dropped
    names = {c["name"] for c in await store.redis.xinfo_consumers(store.stream, GROUP)}
    assert "gone-worker" not in names
    assert "alive-worker" in names


def test_stream_key_is_separate_from_token_space() -> None:
    """토큰 키 공간(`ieobom:rt:*`)과 겹치면 안 된다."""
    assert stream_key().startswith(f"{config.REDIS_KEY_PREFIX}:predict:")
    assert ":rt:" not in stream_key()


def test_compose_disables_redis_persistence() -> None:
    """ADR-010 §6 의 세 번째 조건. 건강 수치가 RDB·AOF 로 디스크에 남으면 안 된다."""
    if not COMPOSE.exists():
        pytest.skip("docker-compose.yml 이 없다")
    text = COMPOSE.read_text(encoding="utf-8")
    assert '"--save", ""' in text, "RDB 스냅샷이 꺼져 있지 않다"
    assert '"--appendonly", "no"' in text, "AOF 가 꺼져 있지 않다"


def test_compose_ai_worker_can_scale() -> None:
    """`container_name` 이 있으면 여러 대를 띄울 수 없다."""
    if not COMPOSE.exists():
        pytest.skip("docker-compose.yml 이 없다")
    lines = COMPOSE.read_text(encoding="utf-8").splitlines()
    start = next(i for i, line in enumerate(lines) if line.strip() == "ai-worker:")
    block = []
    for line in lines[start + 1 :]:
        if line and not line.startswith("    ") and not line.startswith("  #"):
            break
        block.append(line)
    assert not any("container_name" in line for line in block), (
        "ai-worker 에 container_name 이 있으면 --scale 이 이름 충돌로 실패한다"
    )
