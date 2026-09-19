import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import BigInteger, CheckConstraint, DateTime, ForeignKey, Index, String, Uuid, text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db.base import Base, TimestampMixin
from app.core.utils.enums import StrEnum

if TYPE_CHECKING:
    pass


class GuardianLinkKind(StrEnum):
    PRODUCT_GUARDIAN = "product_guardian"
    LEGAL_REPRESENTATIVE = "legal_representative"


class GuardianVerificationStatus(StrEnum):
    UNVERIFIED = "unverified"
    PENDING = "pending"
    VERIFIED = "verified"
    EXPIRED = "expired"


class MinorDeletionStatus(StrEnum):
    SUBMITTED = "submitted"
    UNDER_REVIEW = "under_review"
    REJECTED = "rejected"
    APPEALED = "appealed"
    APPROVED = "approved"


class GuardianLink(TimestampMixin, Base):
    """제품 보호자와 법정대리인 확인을 같은 행에 섞지 않는다. kind로 가른다."""

    __tablename__ = "guardian_links"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    household_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("households.id", ondelete="CASCADE"), nullable=False, index=True
    )
    profile_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("family_profiles.id", ondelete="CASCADE"), nullable=False, index=True
    )
    account_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("service_accounts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    verification_status: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default=GuardianVerificationStatus.UNVERIFIED.value
    )
    self_attested: Mapped[bool] = mapped_column(default=False, server_default="false", nullable=False)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    adapter_name: Mapped[str | None] = mapped_column(String(80), nullable=True)
    share_reapproved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    share_grantor_account_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("service_accounts.id", ondelete="SET NULL"), nullable=True
    )
    share_capabilities: Mapped[str] = mapped_column(String(240), nullable=False, default="", server_default="")
    share_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    share_revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    share_policy_version: Mapped[str | None] = mapped_column(String(40), nullable=True)
    share_reauthenticated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    row_version: Mapped[int] = mapped_column(BigInteger, default=1, server_default="1", nullable=False)

    __table_args__ = (
        Index("uq_guardian_links_profile_account_kind", "profile_id", "account_id", "kind", unique=True),
        CheckConstraint(
            "kind IN ('product_guardian', 'legal_representative')",
            name="guardian_link_kind",
        ),
        CheckConstraint(
            "verification_status IN ('unverified', 'pending', 'verified', 'expired')",
            name="guardian_link_verification_status",
        ),
    )


class MinorDeletionRequest(TimestampMixin, Base):
    """미성년 삭제 요청. 승인 전에는 프로필을 파기하지 않는다."""

    __tablename__ = "minor_deletion_requests"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    household_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("households.id", ondelete="CASCADE"), nullable=False, index=True
    )
    profile_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("family_profiles.id", ondelete="CASCADE"), nullable=False, index=True
    )
    requested_by_account_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("service_accounts.id", ondelete="RESTRICT"), nullable=False
    )
    status: Mapped[str] = mapped_column(String(20), nullable=False, server_default=MinorDeletionStatus.SUBMITTED.value)
    decision_note: Mapped[str | None] = mapped_column(String(80), nullable=True)
    legal_hold: Mapped[bool] = mapped_column(default=False, server_default="false", nullable=False)
    row_version: Mapped[int] = mapped_column(BigInteger, default=1, server_default="1", nullable=False)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        CheckConstraint(
            "status IN ('submitted', 'under_review', 'rejected', 'appealed', 'approved')",
            name="minor_deletion_request_status",
        ),
        Index("ix_minor_deletion_requests_profile_status", "profile_id", "status"),
    )


class BirthDateCorrection(TimestampMixin, Base):
    """생년월일 정정. 성년 전환을 대신하지 않는다."""

    __tablename__ = "birth_date_corrections"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    household_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("households.id", ondelete="CASCADE"), nullable=False, index=True
    )
    profile_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("family_profiles.id", ondelete="CASCADE"), nullable=False, index=True
    )
    actor_account_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("service_accounts.id", ondelete="RESTRICT"), nullable=False
    )
    previous_birth_date: Mapped[str | None] = mapped_column(String(10), nullable=True)
    new_birth_date: Mapped[str] = mapped_column(String(10), nullable=False)
    reason: Mapped[str] = mapped_column(String(80), nullable=False)
    row_version: Mapped[int] = mapped_column(BigInteger, default=1, server_default="1", nullable=False)


class CivilMajorityTransition(TimestampMixin, Base):
    """성년 전환 이력. 물리 삭제하지 않고 invalidated_at으로만 무효화한다."""

    __tablename__ = "civil_majority_transitions"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    household_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("households.id", ondelete="CASCADE"), nullable=False, index=True
    )
    profile_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("family_profiles.id", ondelete="CASCADE"), nullable=False, index=True
    )
    actor_account_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("service_accounts.id", ondelete="RESTRICT"), nullable=False
    )
    completed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    invalidated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    invalidated_reason: Mapped[str | None] = mapped_column(String(80), nullable=True)
    superseded_by: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    review_status: Mapped[str] = mapped_column(String(20), nullable=False, server_default="active")
    idempotency_key: Mapped[str] = mapped_column(String(80), nullable=False)
    invalidation_idempotency_key: Mapped[str | None] = mapped_column(String(80), nullable=True)
    previous_birth_date: Mapped[str | None] = mapped_column(String(10), nullable=True)
    new_birth_date: Mapped[str | None] = mapped_column(String(10), nullable=True)

    __table_args__ = (
        Index("uq_civil_majority_transitions_idempotency", "idempotency_key", unique=True),
        Index(
            "uq_civil_majority_transitions_invalidation_key",
            "invalidation_idempotency_key",
            unique=True,
            postgresql_where=text("invalidation_idempotency_key IS NOT NULL"),
        ),
        Index(
            "uq_civil_majority_transitions_active_profile",
            "profile_id",
            unique=True,
            postgresql_where=text("invalidated_at IS NULL"),
        ),
        CheckConstraint(
            "review_status IN ('active', 'invalidated', 'needs_review')",
            name="review_status",
        ),
    )
