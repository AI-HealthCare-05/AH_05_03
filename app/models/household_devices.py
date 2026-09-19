import uuid
from datetime import datetime

from sqlalchemy import BigInteger, CheckConstraint, DateTime, ForeignKey, Index, String, UniqueConstraint, Uuid
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db.base import Base, TimestampMixin
from app.core.utils.enums import StrEnum


def _enum(enum_cls: type[StrEnum], name: str) -> SAEnum:
    return SAEnum(
        enum_cls,
        native_enum=False,
        create_constraint=True,
        length=20,
        name=name,
        values_callable=lambda cls: [member.value for member in cls],
        validate_strings=True,
    )


class HouseholdDeviceStatus(StrEnum):
    ACTIVE = "active"
    REVOKED = "revoked"


class HouseholdDevicePairing(TimestampMixin, Base):
    """마스터 재인증 뒤에만 만들어지는 짧은 페어링 코드. 원문은 저장하지 않는다."""

    __tablename__ = "household_device_pairings"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    household_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("households.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_by_account_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("service_accounts.id", ondelete="RESTRICT"), nullable=False
    )
    code_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class HouseholdDevice(TimestampMixin, Base):
    """가구에 묶인 공용 벽 기기. 마스터 계정 세션이 아니다."""

    __tablename__ = "household_devices"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    household_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("households.id", ondelete="CASCADE"), nullable=False, index=True
    )
    pairing_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("household_device_pairings.id", ondelete="RESTRICT"), nullable=False, unique=True
    )
    created_by_account_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("service_accounts.id", ondelete="RESTRICT"), nullable=False
    )
    display_name: Mapped[str] = mapped_column(String(80), nullable=False)
    device_ref: Mapped[str] = mapped_column(String(86), nullable=False)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    status: Mapped[HouseholdDeviceStatus] = mapped_column(
        _enum(HouseholdDeviceStatus, "household_device_status"),
        default=HouseholdDeviceStatus.ACTIVE,
        server_default=HouseholdDeviceStatus.ACTIVE.value,
        nullable=False,
    )
    issued_session_epoch: Mapped[int] = mapped_column(BigInteger, default=1, server_default="1", nullable=False)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    row_version: Mapped[int] = mapped_column(BigInteger, default=1, server_default="1", nullable=False)

    __table_args__ = (
        UniqueConstraint("household_id", "device_ref", name="uq_household_devices_household_ref"),
        CheckConstraint(
            "(status = 'revoked' AND revoked_at IS NOT NULL) OR (status = 'active' AND revoked_at IS NULL)",
            name="household_device_revoked_at_consistent",
        ),
        CheckConstraint(
            "device_ref ~ '^[A-Za-z0-9_-]{43,86}$'",
            name="household_device_ref_format",
        ),
        Index("ix_household_devices_household_status", "household_id", "status"),
    )
