import uuid
from typing import TYPE_CHECKING

from sqlalchemy import BigInteger, ForeignKey, Index, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.orm import relationship as sa_relationship

from app.core.db.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.family_histories import FamilyHistory
    from app.models.health_records import HealthRecord


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
    display_name: Mapped[str] = mapped_column(String(50), nullable=False)
    relationship: Mapped[str] = mapped_column(String(30), nullable=False)
    gender: Mapped[str | None] = mapped_column(String(10), nullable=True)
    birth_date: Mapped[str | None] = mapped_column(String(10), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="active", server_default="active", nullable=False)
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
    )
