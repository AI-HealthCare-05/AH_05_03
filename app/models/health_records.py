import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import BigInteger, DateTime, ForeignKey, Index, String, Text, Uuid
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.profiles import FamilyProfile


class HealthRecord(TimestampMixin, Base):
    """가족 구성원별 건강 기록 모델 (PostgreSQL 정본)."""

    __tablename__ = "health_records"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    profile_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("family_profiles.id", ondelete="CASCADE"), nullable=False, index=True
    )
    record_type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    source: Mapped[str] = mapped_column(String(30), default="manual", server_default="manual", nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="active", server_default="active", nullable=False)
    row_version: Mapped[int] = mapped_column(BigInteger, default=1, server_default="1", nullable=False)

    profile: Mapped["FamilyProfile"] = relationship("FamilyProfile", back_populates="records")

    __table_args__ = (
        Index("ix_health_records_profile_type_date", "profile_id", "record_type", "recorded_at"),
        Index("ix_health_records_profile_status", "profile_id", "status"),
    )
