"""라우터가 공유하는 `Idempotency-Key`·`If-Match` 배선. docs/03_api_spec.md §2.4·§2.5.

**둘 다 선택 헤더다.** 목표 계약은 필수로 적어 두지만, 기존 호출자를 깨지 않기
위해 여기서는 보낸 쪽만 보호받는 형태로 들여온다 — 값이 없으면 이 모듈을 거치지
않고 지금까지와 똑같이 동작한다.

각 라우터는 이 셋을 쓴다.

1. `IdempotencyKeyHeader` / `IfMatchHeader` — 파라미터 타입. 형식은 FastAPI가
   선언 시점에 검증하므로(422), 여기서는 값이 있을 때의 의미만 다룬다.
2. `check_idempotency()` — 같은 키로 이미 성공한 요청이면 그 응답을 그대로
   돌려줄 `Response`. 처음 보는 키(또는 헤더 자체가 없음)면 `None` — 그대로 진행한다.
3. `remember_idempotent()` — 성공 응답을 저장한다. **응답을 만든 뒤, 반환하기 전에** 부른다.
"""

from __future__ import annotations

import re
import uuid
from typing import Annotated, Any

from fastapi import Header
from fastapi.responses import JSONResponse, Response

from app.services.idempotency import IdempotencyStore, compute_request_hash

IdempotencyKeyHeader = Annotated[
    str | None,
    Header(
        alias="Idempotency-Key",
        min_length=16,
        max_length=72,
        pattern=r"^[A-Za-z0-9._:-]+$",
        description="24시간 동안 유효한 클라이언트 생성 재시도 키. 없으면 재시도 안전성을 보장하지 않는다.",
    ),
]

IfMatchHeader = Annotated[
    str | None,
    Header(
        alias="If-Match",
        pattern=r'^"[1-9][0-9]*"$',
        description='조회 응답의 row_version. 예: "3". 없으면 낙관적 잠금을 걸지 않는다.',
    ),
]

_IF_MATCH_VERSION = re.compile(r'^"([1-9][0-9]*)"$')


def parse_if_match(if_match: str | None) -> int | None:
    """`If-Match` 값에서 버전 숫자만 뽑는다. 헤더가 없으면 `None`."""
    if if_match is None:
        return None
    match = _IF_MATCH_VERSION.match(if_match)
    # FastAPI의 Header(pattern=...)가 이미 형식을 걸렀으므로 여기서는 항상 매치한다.
    assert match is not None
    return int(match.group(1))


async def check_idempotency(
    store: IdempotencyStore,
    account_id: uuid.UUID,
    operation: str,
    idempotency_key: str | None,
    payload: dict[str, Any],
) -> Response | None:
    """캐시된 성공 응답이 있으면 그대로 돌려줄 `Response`.

    헤더가 없거나 처음 보는 키면 `None` — 호출자는 평소대로 비즈니스 로직을 실행한다.
    """
    if idempotency_key is None:
        return None
    request_hash = compute_request_hash(payload)
    replay = await store.replay_or_none(account_id, operation, idempotency_key, request_hash)
    if replay is None:
        return None
    if replay.body is None:
        return Response(status_code=replay.status_code)
    return JSONResponse(status_code=replay.status_code, content=replay.body)


async def remember_idempotent(
    store: IdempotencyStore,
    account_id: uuid.UUID,
    operation: str,
    idempotency_key: str | None,
    payload: dict[str, Any],
    *,
    status_code: int,
    body: dict[str, Any] | None,
) -> None:
    """성공 응답을 저장한다. `idempotency_key` 가 없으면 아무 일도 하지 않는다."""
    if idempotency_key is None:
        return
    request_hash = compute_request_hash(payload)
    await store.remember(account_id, operation, idempotency_key, request_hash, status_code, body)
