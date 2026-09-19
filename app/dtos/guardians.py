import uuid
from datetime import datetime
from typing import Literal

from pydantic import Field

from app.dtos.base import BaseRequestModel, BaseSerializerModel

GuardianKind = Literal["product_guardian", "legal_representative"]
VerificationStatus = Literal["unverified", "pending", "verified", "expired"]
DeletionStatus = Literal["submitted", "under_review", "rejected", "appealed", "approved"]
ReviewDecision = Literal["under_review", "rejected", "approved"]


class GuardianLinkCreateRequest(BaseRequestModel):
    account_id: uuid.UUID
    self_attested: bool = False


class GuardianLinkData(BaseSerializerModel):
    id: uuid.UUID
    profile_id: uuid.UUID
    account_id: uuid.UUID
    kind: str
    verification_status: str
    self_attested: bool
    expires_at: datetime | None = None
    share_reapproved_at: datetime | None = None
    share_capabilities: str = ""
    share_expires_at: datetime | None = None
    share_revoked_at: datetime | None = None
    share_policy_version: str | None = None
    row_version: int


class GuardianLinkListData(BaseSerializerModel):
    items: list[GuardianLinkData]


class AccountReauthRequest(BaseRequestModel):
    password: str = Field(..., min_length=1, max_length=72)


class PrivacySelfDeterminationRequest(AccountReauthRequest):
    pass


class CivilMajorityTransitionRequest(AccountReauthRequest):
    pass


class GuardianShareReapprovalRequest(BaseRequestModel):
    account_id: uuid.UUID
    password: str = Field(..., min_length=1, max_length=72)
    capabilities: list[str] = Field(default_factory=lambda: ["view_public_summary"])
    expires_in_days: int = Field(default=30, ge=1, le=180)


class BirthDateCorrectionRequest(BaseRequestModel):
    birth_date: str = Field(..., min_length=10, max_length=10)
    reason: str = Field(..., min_length=1, max_length=80)
    password: str | None = Field(default=None, max_length=72)


class BirthDateCorrectionData(BaseSerializerModel):
    id: uuid.UUID
    profile_id: uuid.UUID
    previous_birth_date: str | None
    new_birth_date: str
    reason: str
    created_at: datetime


class MinorDeletionRequestCreate(BaseRequestModel):
    note: str | None = Field(default=None, max_length=80)


class MinorDeletionReviewRequest(BaseRequestModel):
    decision: ReviewDecision
    note: str | None = Field(default=None, max_length=80)
    legal_hold: bool = False


class MinorDeletionRequestData(BaseSerializerModel):
    id: uuid.UUID
    profile_id: uuid.UUID
    status: str
    legal_hold: bool
    decision_note: str | None = None
    row_version: int
    created_at: datetime
    updated_at: datetime


class CivilMajorityInvalidationRequest(BaseRequestModel):
    profile_id: uuid.UUID
    reason: str = Field(..., min_length=1, max_length=80)
    operator_id: str = Field(..., min_length=1, max_length=80, description="호출자 주장값. 검증된 운영자 ID가 아니다")
    ticket_ref: str = Field(
        ..., min_length=1, max_length=80, description="호출자 주장 티켓. 발급 시스템을 검증하지 않는다"
    )
    previous_birth_date: str | None = Field(default=None, max_length=10)
    new_birth_date: str | None = Field(default=None, max_length=10)
    idempotency_key: str = Field(..., min_length=8, max_length=80)


class CivilMajorityInvalidationData(BaseSerializerModel):
    id: uuid.UUID
    profile_id: uuid.UUID
    review_status: str
    invalidated_at: datetime | None
    invalidated_reason: str | None
    idempotency_key: str
