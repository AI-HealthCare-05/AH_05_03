import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr, Field

from app.dtos.base import BaseSerializerModel
from app.models.family_invitations import InvitationStatus


class FamilyInvitationCreateRequest(BaseModel):
    invitee_email: EmailStr
    household_ref: str = Field(min_length=16, max_length=128)
    target_profile_ref: str = Field(min_length=16, max_length=128)


class FamilyInvitationResponse(BaseSerializerModel):
    id: uuid.UUID
    inviter_account_id: int
    invitee_email: EmailStr
    household_ref: str
    target_profile_ref: str
    status: InvitationStatus
    expires_at: datetime
    created_at: datetime
    accepted_at: datetime | None


class FamilyInvitationListResponse(BaseModel):
    sent: list[FamilyInvitationResponse]
    received: list[FamilyInvitationResponse]

