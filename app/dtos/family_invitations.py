import uuid
from datetime import datetime

from pydantic import EmailStr, Field, field_validator

from app.dtos.base import BaseRequestModel, BaseSerializerModel
from app.models.family_invitations import InvitationStatus

_PROFILE_REF_PATTERN = r"^[A-Za-z0-9_-]{43,86}$"
_TOKEN_PATTERN = r"^[A-Za-z0-9_-]{43,128}$"


class FamilyInvitationCreateRequest(BaseRequestModel):
    household_id: uuid.UUID
    invitee_email: EmailStr
    target_profile_ref: str = Field(min_length=43, max_length=86, pattern=_PROFILE_REF_PATTERN)

    @field_validator("invitee_email", mode="after")
    @classmethod
    def normalize_email(cls, value: EmailStr) -> str:
        return str(value).strip().lower()


class InvitationTokenRequest(BaseRequestModel):
    token: str = Field(min_length=43, max_length=128, pattern=_TOKEN_PATTERN)


class FamilyInvitationData(BaseSerializerModel):
    id: uuid.UUID
    household_id: uuid.UUID
    inviter_account_id: uuid.UUID
    invitee_email: str
    target_profile_ref: str
    status: InvitationStatus
    expires_at: datetime
    accepted_by_account_id: uuid.UUID | None
    accepted_at: datetime | None
    declined_at: datetime | None
    cancelled_at: datetime | None
    created_at: datetime
    updated_at: datetime
    row_version: int


class FamilyInvitationListData(BaseSerializerModel):
    sent: list[FamilyInvitationData]
    received: list[FamilyInvitationData]


class FamilyInvitationCreatedData(BaseSerializerModel):
    invitation: FamilyInvitationData
    delivery_queued: bool = True
