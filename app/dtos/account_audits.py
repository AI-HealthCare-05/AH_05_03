import uuid
from datetime import datetime

from app.dtos.base import BaseSerializerModel


class AccountAuditEventData(BaseSerializerModel):
    id: uuid.UUID
    event_type: str
    target_type: str | None
    target_ref: str | None
    actor_account_id: uuid.UUID | None
    occurred_at: datetime
    metadata: dict[str, str]


class AccountAuditEventListData(BaseSerializerModel):
    items: list[AccountAuditEventData]
    next_before: datetime | None = None


class PinLockAlertData(BaseSerializerModel):
    id: uuid.UUID
    profile_id: str
    attempts: str | None
    occurred_at: datetime


class PinLockAlertListData(BaseSerializerModel):
    items: list[PinLockAlertData]
