from datetime import datetime
from uuid import UUID

from pydantic import Field

from app.dtos.base import BaseRequestModel, BaseSerializerModel


class MemberPinIssueData(BaseSerializerModel):
    profile_id: UUID
    temporary_pin: str
    must_change: bool


class MemberSessionCreateRequest(BaseRequestModel):
    pin: str = Field(..., min_length=6, max_length=12)


class MemberSessionData(BaseSerializerModel):
    id: UUID
    profile_id: UUID
    household_id: UUID
    member_role: str
    must_change: bool
    session_token: str
    expires_at: datetime


class MemberPinReplacementRequest(BaseRequestModel):
    current_pin: str = Field(..., min_length=6, max_length=12)
    new_pin: str = Field(..., min_length=6, max_length=12)


class WallMemberSessionCreateRequest(BaseRequestModel):
    profile_id: UUID
    pin: str = Field(..., min_length=6, max_length=12)


class WallMemberPinReplacementRequest(BaseRequestModel):
    profile_id: UUID
    current_pin: str = Field(..., min_length=6, max_length=12)
    new_pin: str = Field(..., min_length=6, max_length=12)
