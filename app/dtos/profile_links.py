import uuid
from datetime import datetime

from pydantic import Field

from app.dtos.base import BaseRequestModel, BaseSerializerModel
from app.models.households import ProfileLinkStatus

_PROFILE_REF_PATTERN = r"^[A-Za-z0-9_-]{43,86}$"


class ProfileLinkCreateRequest(BaseRequestModel):
    invitation_id: uuid.UUID
    local_profile_ref: str = Field(min_length=43, max_length=86, pattern=_PROFILE_REF_PATTERN)


class ProfileLinkData(BaseSerializerModel):
    id: uuid.UUID
    household_id: uuid.UUID
    account_id: uuid.UUID
    invitation_id: uuid.UUID | None
    local_profile_ref: str
    status: ProfileLinkStatus
    linked_at: datetime
    unlinked_at: datetime | None
    row_version: int


class ProfileLinkListData(BaseSerializerModel):
    items: list[ProfileLinkData]
