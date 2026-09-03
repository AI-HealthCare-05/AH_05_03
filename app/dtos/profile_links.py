import uuid
from datetime import datetime

from pydantic import Field

from app.dtos.base import BaseRequestModel, BaseSerializerModel
from app.models.profile_links import ProfileLinkStatus

_PROFILE_REF_PATTERN = r"^[A-Za-z0-9_-]{43,86}$"


class ProfileLinkCreateRequest(BaseRequestModel):
    invitation_id: uuid.UUID
    local_profile_ref: str = Field(min_length=43, max_length=86, pattern=_PROFILE_REF_PATTERN)


class ProfileLinkData(BaseSerializerModel):
    """docs/api/openapi.yaml ProfileLinkResponse.

    account_id와 invitation_id는 응답에 넣지 않는다. 요청자는 항상 본인이고,
    연결 근거 초대는 이미 /family-invitations로 조회할 수 있다.
    """

    id: uuid.UUID
    household_id: uuid.UUID
    local_profile_ref: str
    status: ProfileLinkStatus
    linked_at: datetime
    unlinked_at: datetime | None
    row_version: int


class ProfileLinkListData(BaseSerializerModel):
    items: list[ProfileLinkData]
