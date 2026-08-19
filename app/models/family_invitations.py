import uuid
from datetime import datetime

from sqlalchemy import BigInteger, CheckConstraint, DateTime, ForeignKey, Index, LargeBinary, String, Uuid, func, text
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db.base import Base, TimestampMixin
from app.core.utils.enums import StrEnum


class InvitationStatus(StrEnum):
    PENDING = "pending"
    ACCEPTED = "accepted"
    DECLINED = "declined"
    EXPIRED = "expired"
    CANCELLED = "cancelled"


class FamilyInvitation(TimestampMixin, Base):
    """초대 상태만 서버에 저장하며 로컬 프로필·건강정보는 저장하지 않는다."""

    __tablename__ = "family_invitations"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    household_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("households.id", ondelete="CASCADE"), nullable=False, index=True
    )
    inviter_account_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("service_accounts.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    invitee_email: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    target_profile_ref: Mapped[str] = mapped_column(String(86), nullable=False)
    token_hash: Mapped[bytes] = mapped_column(LargeBinary(32), nullable=False, unique=True)
    status: Mapped[InvitationStatus] = mapped_column(
        SAEnum(
            InvitationStatus,
            native_enum=False,
            create_constraint=True,
            length=20,
            name="family_invitation_status",
            values_callable=lambda cls: [member.value for member in cls],
            validate_strings=True,
        ),
        default=InvitationStatus.PENDING,
        server_default=InvitationStatus.PENDING.value,
        nullable=False,
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    accepted_by_account_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("service_accounts.id", ondelete="RESTRICT")
    )
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    declined_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    row_version: Mapped[int] = mapped_column(BigInteger, default=1, server_default="1", nullable=False)

    __table_args__ = (
        CheckConstraint("octet_length(token_hash) = 32", name="family_invitation_token_hash_length"),
        CheckConstraint(
            "target_profile_ref ~ '^[A-Za-z0-9_-]{43,86}$'",
            name="target_profile_ref_format",
        ),
        CheckConstraint("expires_at > created_at", name="family_invitation_expiry_after_creation"),
        CheckConstraint(
            "(status = 'pending' AND accepted_at IS NULL AND declined_at IS NULL AND cancelled_at IS NULL "
            "AND accepted_by_account_id IS NULL) OR "
            "(status = 'accepted' AND accepted_at IS NOT NULL AND accepted_by_account_id IS NOT NULL "
            "AND declined_at IS NULL AND cancelled_at IS NULL) OR "
            "(status = 'declined' AND declined_at IS NOT NULL AND accepted_at IS NULL "
            "AND cancelled_at IS NULL AND accepted_by_account_id IS NULL) OR "
            "(status = 'cancelled' AND cancelled_at IS NOT NULL AND accepted_at IS NULL "
            "AND declined_at IS NULL AND accepted_by_account_id IS NULL) OR "
            "(status = 'expired' AND accepted_at IS NULL AND declined_at IS NULL "
            "AND cancelled_at IS NULL AND accepted_by_account_id IS NULL)",
            name="terminal_state_consistent",
        ),
    )


Index(
    "uq_family_invitations_pending_target",
    FamilyInvitation.household_id,
    func.lower(FamilyInvitation.invitee_email),
    FamilyInvitation.target_profile_ref,
    unique=True,
    postgresql_where=text("status = 'pending'"),
)
