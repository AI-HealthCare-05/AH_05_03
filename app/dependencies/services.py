from typing import Annotated

from fastapi import Depends
from redis.asyncio import Redis

from app.core.redis.client import get_redis
from app.services.invitation_store import InvitationStore
from app.services.token_store import TokenStore


def get_token_store(redis: Annotated[Redis, Depends(get_redis)]) -> TokenStore:
    return TokenStore(redis)


def get_invitation_store(redis: Annotated[Redis, Depends(get_redis)]) -> InvitationStore:
    return InvitationStore(redis)
