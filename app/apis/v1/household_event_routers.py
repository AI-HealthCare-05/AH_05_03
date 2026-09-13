import asyncio
import contextlib
import json
import uuid
from collections.abc import AsyncGenerator
from typing import Annotated

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from redis.asyncio import Redis

from app.core import config
from app.core.db.session import SessionDep
from app.core.errors import ErrorCode
from app.core.redis.client import get_redis_optional
from app.dependencies.security import require_active_account
from app.dtos.envelope import error_responses
from app.exceptions import (
    HouseholdMembershipRequiredError,
    HouseholdNotFoundError,
    HouseholdStreamUnavailableError,
)
from app.models.households import HouseholdStatus
from app.models.service_accounts import ServiceAccount
from app.repositories.household_repository import HouseholdRepository

household_event_router = APIRouter(prefix="/households", tags=["households"])

_AUTH_ERRORS = (
    ErrorCode.AUTH_REQUIRED,
    ErrorCode.TOKEN_INVALID,
    ErrorCode.TOKEN_EXPIRED,
    ErrorCode.TOKEN_REVOKED,
    ErrorCode.ACCOUNT_NOT_FOUND,
    ErrorCode.ACCOUNT_SUSPENDED,
    ErrorCode.ACCOUNT_CLOSED,
    ErrorCode.SERVICE_UNAVAILABLE,
)


async def _event_stream(
    redis: Redis,
    household_id: uuid.UUID,
    request: Request,
) -> AsyncGenerator[str, None]:
    channel = f"{config.REDIS_KEY_PREFIX}:household:{household_id}:events"
    pubsub = redis.pubsub()
    await pubsub.subscribe(channel)
    try:
        # 최초 연결 확인 프레임 전송
        yield f"event: connected\ndata: {json.dumps({'household_id': str(household_id)})}\n\n"

        while not await request.is_disconnected():
            try:
                # 15초 동안 메시지를 기다린다. 없으면 타임아웃 예외가 발생한다.
                msg = await pubsub.get_message(ignore_subscribe_messages=True, timeout=15.0)
                if msg and msg.get("type") == "message":
                    raw_data = msg.get("data")
                    if isinstance(raw_data, bytes):
                        data_str = raw_data.decode("utf-8")
                    else:
                        data_str = str(raw_data or "{}")

                    event_name = "record_saved"
                    try:
                        parsed = json.loads(data_str)
                        if isinstance(parsed, dict) and "event" in parsed:
                            event_name = str(parsed["event"])
                    except Exception:
                        pass

                    yield f"event: {event_name}\ndata: {data_str}\n\n"
                else:
                    # 유휴 상태에서는 keepalive 주석을 보내 Nginx/브라우저 연결 끊김을 방지한다.
                    yield ": keepalive\n\n"
            except (TimeoutError, asyncio.TimeoutError):
                yield ": keepalive\n\n"
            except Exception:
                # 기타 일시적인 수신 오류 시 루프 탈출
                break
    finally:
        with contextlib.suppress(Exception):
            await pubsub.unsubscribe(channel)
            await pubsub.aclose()


@household_event_router.get(
    "/{household_id}/events",
    responses=error_responses(
        *_AUTH_ERRORS,
        ErrorCode.HOUSEHOLD_NOT_FOUND,
        ErrorCode.HOUSEHOLD_MEMBERSHIP_REQUIRED,
    ),
    summary="가구 실시간 이벤트 스트림 (SSE)",
    description="가구 내 건강 기록 생성·수정·삭제 등 변경 사항을 Server-Sent Events로 실시간 중계합니다.",
)
async def stream_household_events(
    household_id: uuid.UUID,
    request: Request,
    account: Annotated[ServiceAccount, Depends(require_active_account)],
    session: SessionDep,
    redis: Annotated[Redis | None, Depends(get_redis_optional)],
) -> StreamingResponse:
    household_repo = HouseholdRepository(session)
    household = await household_repo.get(household_id)
    if household is None or household.status is not HouseholdStatus.ACTIVE:
        raise HouseholdNotFoundError()

    is_member = await household_repo.has_active_membership(household_id, account.id)
    if not is_member:
        raise HouseholdMembershipRequiredError()

    if redis is None:
        raise HouseholdStreamUnavailableError("실시간 이벤트 서비스를 이용할 수 없습니다.")

    return StreamingResponse(
        _event_stream(redis, household_id, request),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
