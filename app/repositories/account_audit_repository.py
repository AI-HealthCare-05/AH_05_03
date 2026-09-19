import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.profiles import AccountAuditEvent

PIN_LOCK_EVENT = "member_pin.lock"
PIN_LOCK_ACK_EVENT = "member_pin.lock_acknowledged"


class AccountAuditRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def list_for_household(
        self,
        household_id: uuid.UUID,
        *,
        event_type: str | None = None,
        actor_account_id: uuid.UUID | None = None,
        limit: int = 50,
        occurred_before: datetime | None = None,
        retention_days: int = 365,
    ) -> list[AccountAuditEvent]:
        cutoff = datetime.now(tz=timezone.utc) - timedelta(days=retention_days)
        query = select(AccountAuditEvent).where(
            AccountAuditEvent.household_id == household_id,
            AccountAuditEvent.occurred_at >= cutoff,
        )
        if event_type is not None:
            query = query.where(AccountAuditEvent.event_type == event_type)
        if actor_account_id is not None:
            query = query.where(AccountAuditEvent.actor_account_id == actor_account_id)
        if occurred_before is not None:
            query = query.where(AccountAuditEvent.occurred_at < occurred_before)
        query = query.order_by(AccountAuditEvent.occurred_at.desc()).limit(min(max(limit, 1), 50))
        return list(await self.session.scalars(query))

    async def get(self, event_id: uuid.UUID) -> AccountAuditEvent | None:
        return await self.session.get(AccountAuditEvent, event_id)

    async def list_open_pin_locks(self, household_id: uuid.UUID) -> list[AccountAuditEvent]:
        locks = list(
            await self.session.scalars(
                select(AccountAuditEvent)
                .where(
                    AccountAuditEvent.household_id == household_id,
                    AccountAuditEvent.event_type == PIN_LOCK_EVENT,
                )
                .order_by(AccountAuditEvent.occurred_at.desc())
            )
        )
        acks = list(
            await self.session.scalars(
                select(AccountAuditEvent).where(
                    AccountAuditEvent.household_id == household_id,
                    AccountAuditEvent.event_type == PIN_LOCK_ACK_EVENT,
                )
            )
        )
        ack_at: dict[str, datetime] = {}
        for ack in acks:
            ref = ack.target_ref or ""
            occurred = ack.occurred_at
            if occurred.tzinfo is None:
                occurred = occurred.replace(tzinfo=timezone.utc)
            previous = ack_at.get(ref)
            if previous is None or occurred > previous:
                ack_at[ref] = occurred
        open_locks: list[AccountAuditEvent] = []
        for lock in locks:
            ref = lock.target_ref or ""
            occurred = lock.occurred_at
            if occurred.tzinfo is None:
                occurred = occurred.replace(tzinfo=timezone.utc)
            acknowledged = ack_at.get(ref)
            if acknowledged is not None and acknowledged >= occurred:
                continue
            open_locks.append(lock)
        return open_locks
