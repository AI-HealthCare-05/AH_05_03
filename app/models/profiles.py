import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import BigInteger, CheckConstraint, DateTime, ForeignKey, Index, String, Uuid, func, text
from sqlalchemy import Enum as SAEnum
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.orm import relationship as sa_relationship

from app.core.db.base import Base, TimestampMixin
from app.core.utils.enums import StrEnum


class OwnershipType(StrEnum):
    LOCAL_SLOT = "local_slot"
    CLAIMED_ADULT = "claimed_adult"
    GUARDIAN_MANAGED = "guardian_managed"


class LifecycleStatus(StrEnum):
    ACTIVE = "active"
    HIDDEN = "hidden"
    ARCHIVED = "archived"
    UNSHARED = "unshared"
    PENDING_DELETE = "pending_delete"
    DELETED = "deleted"


class MemberRole(StrEnum):
    ADULT_MEMBER = "adult_member"
    SELF_ONLY = "self_only"
    RESTRICTED = "restricted"


if TYPE_CHECKING:
    from app.models.family_histories import FamilyHistory
    from app.models.health_records import HealthRecord


def _enum(enum_cls: type[StrEnum], name: str, *, length: int = 32) -> SAEnum:
    return SAEnum(
        enum_cls,
        native_enum=False,
        create_constraint=True,
        length=length,
        name=name,
        values_callable=lambda cls: [member.value for member in cls],
        validate_strings=True,
    )


class FamilyProfile(TimestampMixin, Base):
    """가족 구성원 프로필 모델 (PostgreSQL 정본)."""

    __tablename__ = "family_profiles"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    household_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("households.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_by_account_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("service_accounts.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    claimed_account_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("service_accounts.id", ondelete="SET NULL"), nullable=True, index=True
    )
    display_name: Mapped[str] = mapped_column(String(50), nullable=False)
    relationship: Mapped[str] = mapped_column(String(30), nullable=False)
    gender: Mapped[str | None] = mapped_column(String(10), nullable=True)
    birth_date: Mapped[str | None] = mapped_column(String(10), nullable=True)
    account_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="active", server_default="active", nullable=False)
    ownership_type: Mapped[OwnershipType] = mapped_column(
        _enum(OwnershipType, "family_profile_ownership_type"),
        default=OwnershipType.LOCAL_SLOT,
        server_default=OwnershipType.LOCAL_SLOT.value,
        nullable=False,
    )
    lifecycle_status: Mapped[LifecycleStatus] = mapped_column(
        _enum(LifecycleStatus, "family_profile_lifecycle_status"),
        default=LifecycleStatus.ACTIVE,
        server_default=LifecycleStatus.ACTIVE.value,
        nullable=False,
    )
    member_role: Mapped[MemberRole] = mapped_column(
        _enum(MemberRole, "family_profile_member_role"),
        default=MemberRole.ADULT_MEMBER,
        server_default=MemberRole.ADULT_MEMBER.value,
        nullable=False,
    )
    purge_after: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    purged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    purge_hold_reason: Mapped[str | None] = mapped_column(String(80), nullable=True)
    adult_transitioned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    privacy_self_determined_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    adult_transition_pending_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    row_version: Mapped[int] = mapped_column(BigInteger, default=1, server_default="1", nullable=False)

    records: Mapped[list["HealthRecord"]] = sa_relationship(
        "HealthRecord",
        back_populates="profile",
        cascade="all, delete-orphan",
        order_by="HealthRecord.recorded_at.desc()",
    )
    histories: Mapped[list["FamilyHistory"]] = sa_relationship(
        "FamilyHistory",
        back_populates="profile",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        Index("ix_family_profiles_household_status", "household_id", "status"),
        Index("ix_family_profiles_account_status", "created_by_account_id", "status"),
        Index(
            "uq_family_profiles_active_claimed_account",
            "household_id",
            "claimed_account_id",
            unique=True,
            postgresql_where=(claimed_account_id.is_not(None) & (lifecycle_status == LifecycleStatus.ACTIVE)),
        ),
        CheckConstraint(
            "(lifecycle_status = 'hidden' AND status = 'hidden') OR "
            "(lifecycle_status = 'archived' AND status = 'hidden') OR "
            "(lifecycle_status IN ('pending_delete', 'deleted') AND status = 'deleted') OR "
            "(lifecycle_status IN ('active', 'unshared') AND status = 'active')",
            name="family_profile_lifecycle_status_consistent",
        ),
    )


class CapabilityGrant(TimestampMixin, Base):
    """프로필에 대한 역할 묶음 위·아래 덮어쓰기. 건강 수치를 저장하지 않는다."""

    __tablename__ = "capability_grants"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    household_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("households.id", ondelete="CASCADE"), nullable=False, index=True
    )
    profile_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("family_profiles.id", ondelete="CASCADE"), nullable=False, index=True
    )
    capability: Mapped[str] = mapped_column(String(40), nullable=False)
    effect: Mapped[str] = mapped_column(String(10), nullable=False)
    created_by_account_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("service_accounts.id", ondelete="RESTRICT"), nullable=False
    )
    row_version: Mapped[int] = mapped_column(BigInteger, default=1, server_default="1", nullable=False)

    __table_args__ = (
        Index(
            "uq_capability_grants_profile_capability",
            "profile_id",
            "capability",
            unique=True,
        ),
        CheckConstraint("effect IN ('allow', 'deny')", name="capability_grant_effect"),
    )


class AccountAuditEvent(Base):
    """계정·가구·프로필 메타데이터 감사. metadata에 건강정보를 넣지 않는다."""

    __tablename__ = "account_audit_events"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    actor_account_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("service_accounts.id", ondelete="SET NULL"), nullable=True, index=True
    )
    household_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("households.id", ondelete="SET NULL"), nullable=True, index=True
    )
    event_type: Mapped[str] = mapped_column(String(80), nullable=False)
    target_type: Mapped[str | None] = mapped_column(String(40), nullable=True)
    target_ref: Mapped[str | None] = mapped_column(String(86), nullable=True)
    request_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    event_metadata: Mapped[dict[str, str]] = mapped_column(
        "metadata", JSONB, nullable=False, server_default=text("'{}'::jsonb")
    )
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        CheckConstraint("jsonb_typeof(metadata) = 'object'", name="account_audit_metadata_object"),
        Index("ix_account_audit_events_actor_time", "actor_account_id", "occurred_at"),
        Index("ix_account_audit_events_household_time", "household_id", "occurred_at"),
    )
