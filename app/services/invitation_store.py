import hashlib
import json
import uuid
from dataclasses import dataclass

from redis.asyncio import Redis
from redis.exceptions import RedisError

from app.core import config
from app.exceptions import (
    InvitationTokenInvalidError,
    InvitationTokenReusedError,
    RateLimitedError,
    TokenStoreUnavailableError,
)


@dataclass(frozen=True)
class InvitationDelivery:
    invitation_id: uuid.UUID
    invitee_email: str
    token: str


class InvitationStore:
    """초대의 짧은 수명 보안 상태만 관리한다.

    PostgreSQL이 초대 상태의 정본이다. Redis는 원문 토큰의 1회성 소비,
    재사용 탐지, 속도 제한과 메일 워커 인계에만 사용한다.
    """

    def __init__(self, redis: Redis) -> None:
        self._redis = redis
        self._prefix = config.REDIS_KEY_PREFIX

    @staticmethod
    def hash_token(raw_token: str) -> bytes:
        return hashlib.sha256(raw_token.encode()).digest()

    @staticmethod
    def _hash_hex(raw_token: str) -> str:
        return hashlib.sha256(raw_token.encode()).hexdigest()

    def _token(self, token_hash_hex: str) -> str:
        return f"{self._prefix}:invite:token:{token_hash_hex}"

    def _used(self, token_hash_hex: str) -> str:
        return f"{self._prefix}:invite:used:{token_hash_hex}"

    def _delivery(self, invitation_id: uuid.UUID) -> str:
        return f"{self._prefix}:invite:delivery:{invitation_id}"

    def _delivery_stream(self) -> str:
        return f"{self._prefix}:invite:delivery:stream"

    def _rate_account(self, account_id: uuid.UUID) -> str:
        return f"{self._prefix}:invite:rate:account:{account_id}"

    def _rate_email(self, email: str) -> str:
        digest = hashlib.sha256(email.lower().encode()).hexdigest()
        return f"{self._prefix}:invite:rate:email:{digest}"

    def _rate_transition_account(self, account_id: uuid.UUID) -> str:
        return f"{self._prefix}:invite:rate:transition:account:{account_id}"

    def _rate_transition_invitation(self, invitation_id: uuid.UUID) -> str:
        return f"{self._prefix}:invite:rate:transition:invitation:{invitation_id}"

    async def enforce_create_rate(self, account_id: uuid.UUID, invitee_email: str) -> None:
        try:
            async with self._redis.pipeline(transaction=True) as pipe:
                pipe.incr(self._rate_account(account_id))
                pipe.expire(
                    self._rate_account(account_id), config.FAMILY_INVITATION_ACCOUNT_RATE_WINDOW_SECONDS, nx=True
                )
                pipe.incr(self._rate_email(invitee_email))
                pipe.expire(
                    self._rate_email(invitee_email), config.FAMILY_INVITATION_EMAIL_RATE_WINDOW_SECONDS, nx=True
                )
                account_count, _, email_count, _ = await pipe.execute()
            if (
                int(account_count) > config.FAMILY_INVITATION_ACCOUNT_RATE_LIMIT
                or int(email_count) > config.FAMILY_INVITATION_EMAIL_RATE_LIMIT
            ):
                raise RateLimitedError()
        except RedisError as err:
            raise TokenStoreUnavailableError() from err

    async def enforce_transition_rate(self, account_id: uuid.UUID, invitation_id: uuid.UUID) -> None:
        try:
            async with self._redis.pipeline(transaction=True) as pipe:
                pipe.incr(self._rate_transition_account(account_id))
                pipe.expire(
                    self._rate_transition_account(account_id),
                    config.FAMILY_INVITATION_TRANSITION_RATE_WINDOW_SECONDS,
                    nx=True,
                )
                pipe.incr(self._rate_transition_invitation(invitation_id))
                pipe.expire(
                    self._rate_transition_invitation(invitation_id),
                    config.FAMILY_INVITATION_TRANSITION_RATE_WINDOW_SECONDS,
                    nx=True,
                )
                account_count, _, invitation_count, _ = await pipe.execute()
            if max(int(account_count), int(invitation_count)) > config.FAMILY_INVITATION_TRANSITION_RATE_LIMIT:
                raise RateLimitedError()
        except RedisError as err:
            raise TokenStoreUnavailableError() from err

    async def register(
        self,
        invitation_id: uuid.UUID,
        invitee_email: str,
        raw_token: str,
        ttl_seconds: int,
    ) -> None:
        token_hash_hex = self._hash_hex(raw_token)
        payload = json.dumps(
            {"invitation_id": str(invitation_id), "invitee_email": invitee_email, "token": raw_token},
            separators=(",", ":"),
        )
        try:
            async with self._redis.pipeline(transaction=True) as pipe:
                pipe.set(self._token(token_hash_hex), str(invitation_id), ex=ttl_seconds, nx=True)
                pipe.set(
                    self._delivery(invitation_id),
                    payload,
                    ex=min(ttl_seconds, config.FAMILY_INVITATION_DELIVERY_TTL_SECONDS),
                )
                # Stream에는 민감한 원문 토큰 대신 조회용 초대 ID만 둔다.
                pipe.xadd(
                    self._delivery_stream(),
                    {"invitation_id": str(invitation_id)},
                    maxlen=config.FAMILY_INVITATION_DELIVERY_STREAM_MAXLEN,
                    approximate=True,
                )
                registered, _, _ = await pipe.execute()
            if not registered:
                raise TokenStoreUnavailableError("초대 토큰을 등록하지 못했습니다.")
        except RedisError as err:
            raise TokenStoreUnavailableError() from err

    async def consume(self, invitation_id: uuid.UUID, raw_token: str) -> None:
        token_hash_hex = self._hash_hex(raw_token)
        try:
            stored_invitation_id = await self._redis.getdel(self._token(token_hash_hex))
            if stored_invitation_id is None:
                if await self._redis.exists(self._used(token_hash_hex)):
                    raise InvitationTokenReusedError()
                raise InvitationTokenInvalidError()
            if stored_invitation_id != str(invitation_id):
                raise InvitationTokenInvalidError()
            await self._redis.set(
                self._used(token_hash_hex),
                str(invitation_id),
                ex=config.FAMILY_INVITATION_USED_TOKEN_TTL_SECONDS,
            )
        except RedisError as err:
            raise TokenStoreUnavailableError() from err

    async def restore(self, invitation_id: uuid.UUID, raw_token: str, ttl_seconds: int) -> None:
        """DB 커밋 실패 시 이미 소비한 토큰을 보상 복구한다.

        NX를 써서 다른 상태를 덮지 않는다. 정상 흐름에서는 PostgreSQL 행 잠금이
        동일 초대의 동시 전이를 직렬화한다.
        """
        token_hash_hex = self._hash_hex(raw_token)
        try:
            async with self._redis.pipeline(transaction=True) as pipe:
                pipe.delete(self._used(token_hash_hex))
                pipe.set(self._token(token_hash_hex), str(invitation_id), ex=max(ttl_seconds, 1), nx=True)
                await pipe.execute()
        except RedisError as err:
            raise TokenStoreUnavailableError() from err

    async def revoke(self, token_hash: bytes, invitation_id: uuid.UUID) -> None:
        token_hash_hex = token_hash.hex()
        try:
            async with self._redis.pipeline(transaction=True) as pipe:
                pipe.delete(self._token(token_hash_hex))
                pipe.delete(self._delivery(invitation_id))
                await pipe.execute()
        except RedisError as err:
            raise TokenStoreUnavailableError() from err

    async def take_delivery(self, invitation_id: uuid.UUID) -> InvitationDelivery | None:
        """메일 워커용 원자적 인계. HTTP API는 이 값을 반환하지 않는다."""
        try:
            raw = await self._redis.getdel(self._delivery(invitation_id))
        except RedisError as err:
            raise TokenStoreUnavailableError() from err
        if raw is None:
            return None
        data = json.loads(raw)
        return InvitationDelivery(
            invitation_id=uuid.UUID(data["invitation_id"]),
            invitee_email=data["invitee_email"],
            token=data["token"],
        )
