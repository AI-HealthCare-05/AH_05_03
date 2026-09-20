from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated

from fastapi import Depends

from app.core import config
from app.core.db.session import SessionDep
from app.dtos.account_audits import (
    AccountAuditEventData,
    AccountAuditEventListData,
    PinLockAlertData,
    PinLockAlertListData,
)
from app.exceptions import (
    HouseholdMasterRequiredError,
    HouseholdMembershipRequiredError,
    HouseholdNotFoundError,
    ProfileNotFoundError,
)
from app.models.households import HouseholdStatus
from app.models.profiles import AccountAuditEvent
from app.models.service_accounts import ServiceAccount
from app.repositories.account_audit_repository import PIN_LOCK_ACK_EVENT, AccountAuditRepository
from app.repositories.household_repository import HouseholdRepository
from app.services.profile_access import record_audit, sanitize_audit_metadata


def get_audit_repository(session: SessionDep) -> AccountAuditRepository:
    return AccountAuditRepository(session)


def get_household_repository(session: SessionDep) -> HouseholdRepository:
    return HouseholdRepository(session)


class AccountAuditService:
    def __init__(
        self,
        session: SessionDep,
        audit_repo: Annotated[AccountAuditRepository, Depends(get_audit_repository)],
        household_repo: Annotated[HouseholdRepository, Depends(get_household_repository)],
    ) -> None:
        self.session = session
        self.audit_repo = audit_repo
        self.household_repo = household_repo

    async def _require_master(self, household_id: uuid.UUID, account: ServiceAccount):
        household = await self.household_repo.get(household_id)
        if household is None or household.status is not HouseholdStatus.ACTIVE:
            raise HouseholdNotFoundError()
        if household.master_account_id != account.id:
            raise HouseholdMasterRequiredError()
        return household

    async def _require_member(self, household_id: uuid.UUID, account: ServiceAccount):
        household = await self.household_repo.get(household_id)
        if household is None or household.status is not HouseholdStatus.ACTIVE:
            raise HouseholdNotFoundError()
        if not await self.household_repo.has_active_membership(household_id, account.id):
            raise HouseholdMembershipRequiredError()
        return household

    async def list_events(
        self,
        household_id: uuid.UUID,
        account: ServiceAccount,
        *,
        event_type: str | None = None,
        limit: int = 20,
        occurred_before: datetime | None = None,
    ) -> AccountAuditEventListData:
        household = await self._require_member(household_id, account)
        actor_only: uuid.UUID | None = None
        if household.master_account_id != account.id:
            actor_only = account.id
        rows = await self.audit_repo.list_for_household(
            household_id,
            event_type=event_type,
            actor_account_id=actor_only,
            limit=limit,
            occurred_before=occurred_before,
            retention_days=config.AUDIT_EVENT_RETENTION_DAYS,
        )
        next_before = rows[-1].occurred_at if len(rows) == min(max(limit, 1), 50) else None
        return AccountAuditEventListData(items=[_to_data(row) for row in rows], next_before=next_before)

    async def list_pin_lock_alerts(self, household_id: uuid.UUID, account: ServiceAccount) -> PinLockAlertListData:
        await self._require_master(household_id, account)
        rows = await self.audit_repo.list_open_pin_locks(household_id)
        return PinLockAlertListData(
            items=[
                PinLockAlertData(
                    id=row.id,
                    profile_id=row.target_ref or "",
                    attempts=row.event_metadata.get("attempts"),
                    occurred_at=row.occurred_at,
                )
                for row in rows
            ]
        )

    async def acknowledge_pin_lock(
        self, household_id: uuid.UUID, alert_id: uuid.UUID, account: ServiceAccount
    ) -> PinLockAlertData:
        await self._require_master(household_id, account)
        row = await self.audit_repo.get(alert_id)
        if row is None or row.household_id != household_id or row.event_type != "member_pin.lock":
            raise ProfileNotFoundError()
        await record_audit(
            self.session,
            actor_account_id=account.id,
            household_id=household_id,
            event_type=PIN_LOCK_ACK_EVENT,
            target_ref=row.target_ref or str(alert_id),
            target_type="family_profile",
            event_metadata={"alert_id": str(alert_id)},
        )
        await self.session.commit()
        return PinLockAlertData(
            id=row.id,
            profile_id=row.target_ref or "",
            attempts=row.event_metadata.get("attempts"),
            occurred_at=row.occurred_at,
        )


def _to_data(row: AccountAuditEvent) -> AccountAuditEventData:
    return AccountAuditEventData(
        id=row.id,
        event_type=row.event_type,
        target_type=row.target_type,
        target_ref=row.target_ref,
        actor_account_id=row.actor_account_id,
        occurred_at=row.occurred_at,
        metadata=sanitize_audit_metadata(dict(row.event_metadata)),
    )
