import uuid
from datetime import datetime

from app.dtos.base import BaseSerializerModel
from app.models.households import HouseholdStatus, MembershipStatus


class HouseholdData(BaseSerializerModel):
    id: uuid.UUID
    status: HouseholdStatus
    created_at: datetime
    row_version: int


class HouseholdListData(BaseSerializerModel):
    items: list[HouseholdData]


class HouseholdMembershipData(BaseSerializerModel):
    id: uuid.UUID
    household_id: uuid.UUID
    account_id: uuid.UUID
    status: MembershipStatus
    joined_at: datetime
    left_at: datetime | None
    row_version: int


class HouseholdMembershipListData(BaseSerializerModel):
    items: list[HouseholdMembershipData]
