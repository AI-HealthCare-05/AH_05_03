import uuid
from datetime import datetime

from sqlalchemy import BigInteger, CheckConstraint, DateTime, ForeignKey, UniqueConstraint, Uuid, func
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


class HouseholdStatus(StrEnum):
    ACTIVE = "active"
    CLOSED = "closed"


class MembershipStatus(StrEnum):
    ACTIVE = "active"
    LEFT = "left"


class Household(TimestampMixin, Base):
    """서버 계정 간 초대·소속의 경계. 건강정보는 이 모델에 두지 않는다."""

    __tablename__ = "households"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    created_by_account_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("service_accounts.id", ondelete="RESTRICT"), nullable=False
    )
    status: Mapped[HouseholdStatus] = mapped_column(
        _enum(HouseholdStatus, "household_status"),
        default=HouseholdStatus.ACTIVE,
        server_default=HouseholdStatus.ACTIVE.value,
        nullable=False,
    )
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    row_version: Mapped[int] = mapped_column(BigInteger, default=1, server_default="1", nullable=False)

    __table_args__ = (
        CheckConstraint(
            "(status = 'active' AND closed_at IS NULL) OR (status = 'closed' AND closed_at IS NOT NULL)",
            name="household_status_closed_at_consistent",
        ),
    )


class HouseholdMembership(TimestampMixin, Base):
    __tablename__ = "household_memberships"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    household_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("households.id", ondelete="CASCADE"), nullable=False, index=True
    )
    account_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("service_accounts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    status: Mapped[MembershipStatus] = mapped_column(
        _enum(MembershipStatus, "household_membership_status"),
        default=MembershipStatus.ACTIVE,
        server_default=MembershipStatus.ACTIVE.value,
        nullable=False,
    )
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    left_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    row_version: Mapped[int] = mapped_column(BigInteger, default=1, server_default="1", nullable=False)

    __table_args__ = (
        UniqueConstraint("household_id", "account_id", name="uq_household_memberships_household_account"),
        CheckConstraint(
            "(status = 'active' AND left_at IS NULL) OR (status = 'left' AND left_at IS NOT NULL)",
            name="status_left_at_consistent",
        ),
    )
