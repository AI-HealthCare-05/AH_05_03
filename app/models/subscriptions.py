import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Uuid
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db.base import Base, TimestampMixin
from app.core.utils.enums import StrEnum

if TYPE_CHECKING:
    from app.models.service_accounts import ServiceAccount


class SubscriptionPlan(StrEnum):
    FREE = "FREE"
    BASIC = "BASIC"
    FAMILY = "FAMILY"


class SubscriptionStatus(StrEnum):
    ACTIVE = "active"
    EXPIRED = "expired"
    CANCELLED = "cancelled"


class Subscription(TimestampMixin, Base):
    """docs/02_erd.md subscriptions.

    created_at/updated_at은 ERD에 없는 확장이다. POST /subscription/change의
    감사 흔적이 필요해서 넣었고, docs/02_erd.md에 함께 반영해야 한다
    (docs/05_tech_architecture.md 10절 협업 규칙).
    """

    __tablename__ = "subscriptions"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    account_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("service_accounts.id", ondelete="CASCADE"),
        nullable=False,
        # 계정당 구독 1개. 2순위 가족 라이선스가 들어오면 재검토한다.
        unique=True,
    )
    plan: Mapped[SubscriptionPlan] = mapped_column(
        SAEnum(
            SubscriptionPlan,
            native_enum=False,
            create_constraint=True,
            length=20,
            name="subscription_plan",
            values_callable=lambda enum_cls: [member.value for member in enum_cls],
            validate_strings=True,
        ),
        default=SubscriptionPlan.FREE,
        server_default=SubscriptionPlan.FREE.value,
        nullable=False,
    )
    status: Mapped[SubscriptionStatus] = mapped_column(
        SAEnum(
            SubscriptionStatus,
            native_enum=False,
            create_constraint=True,
            length=20,
            name="subscription_status",
            values_callable=lambda enum_cls: [member.value for member in enum_cls],
            validate_strings=True,
        ),
        default=SubscriptionStatus.ACTIVE,
        server_default=SubscriptionStatus.ACTIVE.value,
        nullable=False,
    )
    # 갱신된 적 없는 신규 구독이 있으므로 nullable. ERD는 이 점에 침묵한다.
    renewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    account: Mapped["ServiceAccount"] = relationship(back_populates="subscriptions", lazy="raise")
