import uuid
from datetime import datetime

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Index, Integer, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db.base import Base, TimestampMixin


class MemberPinCredential(TimestampMixin, Base):
    """프로필당 위임 PIN 해시. 원문은 저장하지 않는다."""

    __tablename__ = "member_pin_credentials"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    profile_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("family_profiles.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    household_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("households.id", ondelete="CASCADE"), nullable=False, index=True
    )
    pin_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    must_change: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    failed_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    generation: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    row_version: Mapped[int] = mapped_column(BigInteger, default=1, server_default="1", nullable=False)


class MemberSession(TimestampMixin, Base):
    """등록 기기 또는 계정 가구 화면에서만 열리는 짧은 구성원 세션."""

    __tablename__ = "member_sessions"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    profile_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("family_profiles.id", ondelete="CASCADE"), nullable=False, index=True
    )
    household_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("households.id", ondelete="CASCADE"), nullable=False, index=True
    )
    device_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("household_devices.id", ondelete="CASCADE"), nullable=True, index=True
    )
    credential_generation: Mapped[int] = mapped_column(Integer, nullable=False)
    issued_session_epoch: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (Index("ix_member_sessions_profile_active", "profile_id", "expires_at"),)
