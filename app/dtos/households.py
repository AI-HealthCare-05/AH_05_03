import uuid
from datetime import datetime

from app.dtos.base import BaseSerializerModel
from app.models.households import HouseholdStatus


class HouseholdData(BaseSerializerModel):
    id: uuid.UUID
    status: HouseholdStatus
    created_at: datetime
    row_version: int


class HouseholdListData(BaseSerializerModel):
    items: list[HouseholdData]
