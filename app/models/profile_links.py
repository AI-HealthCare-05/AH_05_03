import uuid
from datetime import datetime

from sqlalchemy import BigInteger, CheckConstraint, DateTime, ForeignKey, Index, String, Uuid, func, text
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db.base import Base, TimestampMixin
from app.core.utils.enums import StrEnum


class ProfileLinkStatus(StrEnum):
    ACTIVE = "active"
    UNLINKED = "unlinked"


class ProfileLink(TimestampMixin, Base):
    """서비스 계정과 불투명 로컬 프로필 참조값의 연결만 저장한다.

    참조값은 브라우저가 CSPRNG로 만든 값이고 이름·관계·생년을 인코딩하지
    않는다 (docs/03_api_spec.md 7절). 연결이 있다는 사실이 건강정보가 서버에
    있다는 뜻은 아니다.
    """

    __tablename__ = "profile_links"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    household_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("households.id", ondelete="CASCADE"), nullable=False, index=True
    )
    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("service_accounts.id", ondelete="CASCADE"), nullable=False)
    # 초대 없이 만들어지는 연결(로컬 단독 사용자)을 후속 작업에서 허용할 수 있도록
    # nullable로 둔다. 값이 있으면 한 초대가 만들 수 있는 연결은 하나뿐이다.
    invitation_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("family_invitations.id", ondelete="RESTRICT"), unique=True
    )
    local_profile_ref: Mapped[str] = mapped_column(String(86), nullable=False)
    status: Mapped[ProfileLinkStatus] = mapped_column(
        SAEnum(
            ProfileLinkStatus,
            native_enum=False,
            create_constraint=True,
            length=16,
            name="profile_link_status",
            values_callable=lambda cls: [member.value for member in cls],
            validate_strings=True,
        ),
        default=ProfileLinkStatus.ACTIVE,
        server_default=ProfileLinkStatus.ACTIVE.value,
        nullable=False,
    )
    linked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    unlinked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    row_version: Mapped[int] = mapped_column(BigInteger, default=1, server_default="1", nullable=False)

    __table_args__ = (
        CheckConstraint(
            "local_profile_ref ~ '^[A-Za-z0-9_-]{43,86}$'",
            name="local_profile_ref_format",
        ),
        CheckConstraint(
            "(status = 'active' AND unlinked_at IS NULL) OR (status = 'unlinked' AND unlinked_at IS NOT NULL)",
            name="profile_link_status_unlinked_at_consistent",
        ),
    )


# docs/02_erd.md 2.6의 두 부분 유일 인덱스. 한 계정은 한 가정에서 프로필 하나에만
# 연결되고, 한 참조값도 계정 하나만 점유한다. 서비스 계층의 사전 검사가 경합에
# 지더라도 여기서 최종 방어된다.
Index(
    "uq_profile_links_one_active_profile_per_account_household",
    ProfileLink.household_id,
    ProfileLink.account_id,
    unique=True,
    postgresql_where=text("status = 'active'"),
)
Index(
    "uq_profile_links_one_active_account_per_profile",
    ProfileLink.household_id,
    ProfileLink.local_profile_ref,
    unique=True,
    postgresql_where=text("status = 'active'"),
)
Index("ix_profile_links_account_status", ProfileLink.account_id, ProfileLink.status)
