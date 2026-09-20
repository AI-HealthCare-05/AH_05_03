import uuid
from datetime import datetime
from typing import Literal

from pydantic import Field

from app.dtos.base import BaseRequestModel, BaseSerializerModel

Gender = Literal["male", "female"]
ProfileStatus = Literal["active", "hidden", "deleted"]


class ProfileCreateRequest(BaseRequestModel):
    id: uuid.UUID | None = Field(default=None, description="클라이언트 생성 UUID (선택)")
    household_id: uuid.UUID = Field(..., description="가정 ID")
    display_name: str = Field(..., min_length=1, max_length=50, description="이름 또는 호칭")
    relationship: str = Field(..., min_length=1, max_length=30, description="가족 관계")
    birth_date: str | None = Field(default=None, max_length=10, description="생년월일 (YYYY-MM-DD)")
    gender: Gender | None = Field(default=None, description="성별 (male/female)")
    account_email: str | None = Field(default=None, max_length=255, description="연동된 계정 이메일")


class ProfileUpdateRequest(BaseRequestModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=50)
    relationship: str | None = Field(default=None, min_length=1, max_length=30)
    birth_date: str | None = Field(default=None, max_length=10)
    gender: Gender | None = Field(default=None)
    account_email: str | None = Field(default=None, max_length=255)
    status: ProfileStatus | None = Field(default=None)


class HouseholdUnshareRequest(BaseRequestModel):
    password: str | None = None


class ProfileDeletionPreviewData(BaseSerializerModel):
    profile_id: uuid.UUID
    ownership_type: str
    lifecycle_status: str
    record_count: int
    membership_unchanged_if_hidden: bool = True
    recommended_action: Literal["purge_empty", "trash", "forbidden", "minor_review"]
    backup_hint: str
    purge_after: datetime | None = None


class ProfileDeletionRequestData(BaseSerializerModel):
    profile_id: uuid.UUID
    lifecycle_status: str
    purged: bool
    purge_after: datetime | None = None


class ProfilePurgeJobData(BaseSerializerModel):
    purged_count: int
    skipped_count: int


class ProfileData(BaseSerializerModel):
    id: uuid.UUID
    household_id: uuid.UUID
    created_by_account_id: uuid.UUID
    claimed_account_id: uuid.UUID | None = None
    display_name: str
    relationship: str
    birth_date: str | None = None
    gender: Gender | None = None
    account_email: str | None = None
    status: str
    ownership_type: str
    lifecycle_status: str
    member_role: str
    purge_after: datetime | None = None
    purged_at: datetime | None = None
    purge_hold_reason: str | None = None
    legal_guardian_status: str | None = None
    minor_deletion_status: str | None = None
    privacy_self_determined_at: datetime | None = None
    adult_transition_pending_at: datetime | None = None
    adult_transitioned_at: datetime | None = None
    row_version: int
    created_at: datetime
    updated_at: datetime
    pin_configured: bool


class ProfileListData(BaseSerializerModel):
    items: list[ProfileData]


class ProfileSyncItem(BaseRequestModel):
    id: uuid.UUID
    household_id: uuid.UUID
    display_name: str = Field(..., min_length=1, max_length=50)
    relationship: str = Field(..., min_length=1, max_length=30)
    birth_date: str | None = None
    gender: Gender | None = None
    account_email: str | None = None
    status: str = "active"
    row_version: int = 1


class ProfileSyncRequest(BaseRequestModel):
    profiles: list[ProfileSyncItem]
