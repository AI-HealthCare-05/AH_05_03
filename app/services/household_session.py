"""가구 session_epoch. 비상 철회 뒤 남은 토큰·실시간 연결을 한 번에 끊는다."""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone

from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import config
from app.models.households import Household


def epoch_redis_key(household_id: uuid.UUID) -> str:
    return f"{config.REDIS_KEY_PREFIX}:household:{household_id}:session_epoch"


async def bump_session_epoch(
    session: AsyncSession,
    household: Household,
    redis: Redis | None,
) -> int:
    household.session_epoch += 1
    household.row_version += 1
    await session.flush()
    if redis is not None:
        key = epoch_redis_key(household.id)
        await redis.set(key, str(household.session_epoch))
        channel = f"{config.REDIS_KEY_PREFIX}:household:{household.id}:events"
        payload = {
            "event": "devices_revoked",
            "household_id": str(household.id),
            "session_epoch": household.session_epoch,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        await redis.publish(channel, json.dumps(payload))
    return household.session_epoch
