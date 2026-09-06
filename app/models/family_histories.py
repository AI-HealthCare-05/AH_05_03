import uuid
from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, Index, Integer, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.profiles import FamilyProfile


class FamilyHistory(TimestampMixin, Base):
    """가족 구성원별 가족력 질환 모델."""

    __tablename__ = "family_histories"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    profile_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("family_profiles.id", ondelete="CASCADE"), nullable=False, index=True
    )
    relative_relationship: Mapped[str] = mapped_column(String(30), nullable=False)
    condition_name: Mapped[str] = mapped_column(String(100), nullable=False)
    onset_age: Mapped[int | None] = mapped_column(Integer, nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)

    profile: Mapped["FamilyProfile"] = relationship("FamilyProfile", back_populates="histories")

    __table_args__ = (Index("ix_family_histories_profile_condition", "profile_id", "condition_name"),)
