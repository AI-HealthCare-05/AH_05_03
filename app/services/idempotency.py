"""`Idempotency-Key` 저장소. docs/03_api_spec.md §2.4.

가정·구독·초대·프로필연결·계정폐쇄처럼 상태를 바꾸는 요청은 같은 키로 재시도해도
부작용이 한 번만 나야 한다. **성공한 응답만 캐싱한다** — 실패는 애초에 아무것도
바꾸지 않았으므로 다시 시도해도 안전하고, 실패까지 캐싱하려면 모든 도메인 예외의
본문을 여기서 직렬화해야 해서 결합만 커진다.

**헤더는 선택이다.** 요청에 `Idempotency-Key` 가 없으면 이 저장소를 아예 거치지
않는다 — 기존 호출자(테스트·다른 클라이언트)를 깨지 않기 위해서다. 보낸 쪽만
재시도 안전성을 얻는다.

Redis 가 죽으면 막는다(fail-closed) — `rate_limit.py` 와 같은 이유다. 열어 두면
중복 방지 보장이 조용히 사라진다.

지속화가 꺼진 인스턴스(`app/core/jobs/contract.py` 머리말 참조)라 Redis 재시작 시
기록이 사라진다 — 그 순간의 재시도는 새 요청으로 처리된다. 리프레시 토큰과 같은
교환이고, 이 도메인엔 건강정보가 없으므로 받아들일 수 있다.
"""

from __future__ import annotations

import hashlib
import json
import uuid
from dataclasses import dataclass
from typing import Any, cast

from redis.asyncio import Redis
from redis.exceptions import RedisError

from app.core import config
from app.exceptions import IdempotencyKeyReusedError, TokenStoreUnavailableError

_FIELD_HASH = "hash"
_FIELD_STATUS = "status"
_FIELD_BODY = "body"


def compute_request_hash(payload: dict[str, Any]) -> str:
    """요청을 식별하는 필드만 해시한다. 원문은 저장하지 않는다."""
    canonical = json.dumps(payload, sort_keys=True, default=str, ensure_ascii=False)
    return hashlib.sha256(canonical.encode()).hexdigest()


@dataclass(frozen=True)
class IdempotentReplay:
    status_code: int
    body: dict[str, Any] | None


class IdempotencyStore:
    def __init__(self, redis: Redis) -> None:
        self._redis = redis

    def _key(self, account_id: uuid.UUID, operation: str, idempotency_key: str) -> str:
        return f"{config.REDIS_KEY_PREFIX}:idem:{account_id}:{operation}:{idempotency_key}"

    async def replay_or_none(
        self,
        account_id: uuid.UUID,
        operation: str,
        idempotency_key: str,
        request_hash: str,
    ) -> IdempotentReplay | None:
        """이미 성공한 같은 요청이면 그 응답. 다른 본문으로 키를 재사용했으면 409.

        처음 보는 키면 `None` — 호출자가 정상적으로 진행하면 된다.
        """
        key = self._key(account_id, operation, idempotency_key)
        try:
            fields = cast(dict[str, str], await self._redis.hgetall(key))
        except RedisError as err:
            raise TokenStoreUnavailableError() from err
        if not fields:
            return None
        if fields.get(_FIELD_HASH) != request_hash:
            raise IdempotencyKeyReusedError()
        raw_body = fields.get(_FIELD_BODY)
        body = cast(dict[str, Any], json.loads(raw_body)) if raw_body else None
        return IdempotentReplay(status_code=int(fields[_FIELD_STATUS]), body=body)

    async def remember(
        self,
        account_id: uuid.UUID,
        operation: str,
        idempotency_key: str,
        request_hash: str,
        status_code: int,
        body: dict[str, Any] | None,
    ) -> None:
        key = self._key(account_id, operation, idempotency_key)
        # **인라인 리터럴이어야 한다.** 이름 붙인 `dict[str, str]` 변수를 넘기면 mypy가
        # redis-py의 `Mapping[<union>, <union>]` 스텁과 맞지 않는다고 본다(불변성 문제) —
        # 그대로 리터럴로 넘기면 각 키·값이 개별적으로 검사돼 통과한다.
        try:
            pipe = self._redis.pipeline()
            if body is not None:
                pipe.hset(
                    key,
                    mapping={
                        _FIELD_HASH: request_hash,
                        _FIELD_STATUS: str(status_code),
                        _FIELD_BODY: json.dumps(body, ensure_ascii=False, separators=(",", ":")),
                    },
                )
            else:
                pipe.hset(key, mapping={_FIELD_HASH: request_hash, _FIELD_STATUS: str(status_code)})
            pipe.expire(key, config.IDEMPOTENCY_TTL_SECONDS)
            await pipe.execute()
        except RedisError as err:
            raise TokenStoreUnavailableError() from err
