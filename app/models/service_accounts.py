import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, String, Uuid
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db.base import Base, TimestampMixin
from app.core.utils.enums import StrEnum

if TYPE_CHECKING:
    from app.models.subscriptions import Subscription


class ServiceAccountStatus(StrEnum):
    ACTIVE = "active"
    SUSPENDED = "suspended"
    CLOSED = "closed"


class ServiceAccount(TimestampMixin, Base):
    """docs/02_erd.md 서버 데이터 모델.

    이름·생년·성별·휴대폰 컬럼은 의도적으로 없다.
    docs/05_tech_architecture.md 4절이 서버 금지 항목으로 명시했다.
    """

    __tablename__ = "service_accounts"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[ServiceAccountStatus] = mapped_column(
        SAEnum(
            ServiceAccountStatus,
            # native PG ENUM은 값 추가/변경을 alembic autogenerate가 전혀 감지하지
            # 못한다. ERD에 열거형 컬럼이 여럿이라 VARCHAR+CHECK가 훨씬 싸다.
            native_enum=False,
            # 2.0 기본값이 False다. 빼면 CHECK 없는 맨 VARCHAR가 조용히 생긴다.
            create_constraint=True,
            length=20,
            name="service_account_status",
            # 없으면 멤버 '이름'(ACTIVE)이 저장된다. ERD는 소문자 값을 쓴다.
            values_callable=lambda enum_cls: [member.value for member in enum_cls],
            validate_strings=True,
        ),
        default=ServiceAccountStatus.ACTIVE,
        server_default=ServiceAccountStatus.ACTIVE.value,
        nullable=False,
    )
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    subscriptions: Mapped[list["Subscription"]] = relationship(
        back_populates="account",
        cascade="all, delete-orphan",
        # lazy="raise"가 없으면 무심코 account.subscriptions를 건드렸을 때
        # 운영 중 임의 지점에서 MissingGreenlet이 터진다. 개발 시점에
        # 결정적으로 실패시키는 편이 낫다.
        lazy="raise",
    )
