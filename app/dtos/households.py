import uuid
from datetime import datetime

from app.dtos.base import BaseSerializerModel
from app.models.households import HouseholdStatus, MembershipStatus


class HouseholdData(BaseSerializerModel):
    id: uuid.UUID
    created_by_account_id: uuid.UUID
    master_account_id: uuid.UUID
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


class HouseholdMembershipListItemData(HouseholdMembershipData):
    masked_email: str
    local_profile_ref: str | None
    is_master: bool = False


class HouseholdMembershipListData(BaseSerializerModel):
    items: list[HouseholdMembershipListItemData]


class TransferMasterRequest(BaseSerializerModel):
    target_account_id: uuid.UUID
