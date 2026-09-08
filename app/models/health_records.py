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
    # **원본 서류와 기록을 잇는 고리.** 검진표를 올려 판정하면 원본은 기기 보관함에,
    # 판정은 이 표에 남는다. 이 칸이 없으면 둘을 이을 방법이 없어 "이 숫자는 어느
    # 서류에서 왔나" 에 답할 수 없다 — 건강 데이터의 검진 이력이 늘 비어 있던 이유다.
    #
    # 외래키를 걸지 않는다. 문서 실물은 서버가 아니라 **브라우저 OPFS** 에 있어서
    # 참조 무결성을 서버가 보장할 수 없다. 기기를 옮기면 id 는 남고 실물은 없는데,
    # 그건 깨진 상태가 아니라 "그 기기에서만 열 수 있다" 는 사실 그대로다.
    source_document_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="active", server_default="active", nullable=False)
    row_version: Mapped[int] = mapped_column(BigInteger, default=1, server_default="1", nullable=False)

    profile: Mapped["FamilyProfile"] = relationship("FamilyProfile", back_populates="records")

    __table_args__ = (
        Index("ix_health_records_profile_type_date", "profile_id", "record_type", "recorded_at"),
        Index("ix_health_records_profile_status", "profile_id", "status"),
    )
