import uuid
from datetime import datetime

from pydantic import Field

from app.dtos.base import BaseRequestModel, BaseSerializerModel


class DevicePairingCreateRequest(BaseRequestModel):
    password: str = Field(..., min_length=1, max_length=128, description="마스터 계정 재인증")


class DevicePairingCreatedData(BaseSerializerModel):
    pairing_id: uuid.UUID
    household_id: uuid.UUID
    code: str
    expires_at: datetime


class HouseholdDeviceClaimRequest(BaseRequestModel):
    pairing_code: str = Field(..., min_length=6, max_length=16)
    household_id: uuid.UUID
    display_name: str = Field(..., min_length=1, max_length=80)
    device_ref: str = Field(..., min_length=43, max_length=86, pattern=r"^[A-Za-z0-9_-]{43,86}$")


class HouseholdDeviceClaimedData(BaseSerializerModel):
    id: uuid.UUID
    household_id: uuid.UUID
    display_name: str
    device_token: str
    status: str
    row_version: int
    created_at: datetime


class HouseholdDeviceData(BaseSerializerModel):
    id: uuid.UUID
    household_id: uuid.UUID
    display_name: str
    status: str
    last_seen_at: datetime | None = None
    created_at: datetime
    row_version: int


class HouseholdDeviceListData(BaseSerializerModel):
    items: list[HouseholdDeviceData]


class HouseholdDeviceRevokeRequest(BaseRequestModel):
    password: str = Field(..., min_length=1, max_length=128)


class WallProfileCardData(BaseSerializerModel):
    id: uuid.UUID
    display_name: str
    relationship: str
    member_role: str


class WallProfileListData(BaseSerializerModel):
    household_id: uuid.UUID
    items: list[WallProfileCardData]


class WallPinChallengeRequest(BaseRequestModel):
    profile_id: uuid.UUID


class EmergencyDeviceRevocationRequest(BaseRequestModel):
    password: str = Field(..., min_length=1, max_length=128)


class EmergencyDeviceRevocationData(BaseSerializerModel):
    id: uuid.UUID
    household_id: uuid.UUID
    revoked_device_count: int
    revoked_session_count: int
