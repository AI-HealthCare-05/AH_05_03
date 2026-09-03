"""챌린지 수행 기록. 건강 수치를 담는 칼럼이 없는 것이 이 파일의 요점이다.

`challenge_checks` 에 값 칼럼을 두지 않았다. 정책을 문서가 아니라 스키마가 강제한다 —
나중에 누가 측정값을 서버에 남기고 싶어도 넣을 칸이 없고, 넣으려면 마이그레이션과
ADR-002 개정을 함께 통과해야 한다.

계정 단위로 걸었다. 가정 미가입 1인 사용자도 그대로 돌아야 하고(`ProfileLink` 는
가정이 있어야 생긴다), 가정 집계는 `HouseholdMembership` 으로 조인하면 된다.
"""

import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Index, String, UniqueConstraint, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db.base import Base, TimestampMixin


class ChallengeCheck(TimestampMixin, Base):
    """"오늘 이걸 했다" 한 건. 무엇을 했는지와 언제인지만 남는다."""

    __tablename__ = "challenge_checks"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    account_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("service_accounts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # 카탈로그의 id. 카탈로그 자체는 코드(`services/challenge_catalog.py`)에 있고
    # 테이블로 두지 않았다 — 전원에게 같은 표이고 사용자가 만들지 않는다.
    challenge_id: Mapped[str] = mapped_column(String(32), nullable=False)
    checked_on: Mapped[date] = mapped_column(Date, nullable=False)

    __table_args__ = (
        UniqueConstraint(
            "account_id",
            "challenge_id",
            "checked_on",
            name="uq_challenge_checks_account_id_challenge_id_checked_on",
        ),
        # 정원 계산이 계정별 전량 조회 + 날짜 정렬이라 둘을 한 인덱스로 받는다.
        Index("ix_challenge_checks_account_id_checked_on", "account_id", "checked_on"),
    )


class ChallengeAward(TimestampMixin, Base):
    """받은 동물. 영구다 — 한번 오면 떠나지 않는다.

    이력에서 다시 계산할 수도 있지만 남긴다. 조건이 **최고 기록**이라, 점수 규칙을
    나중에 고치면 이미 받은 동물이 사라질 수 있다. 받은 것은 빼앗지 않는다.
    """

    __tablename__ = "challenge_awards"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    account_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("service_accounts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    animal_id: Mapped[str] = mapped_column(String(32), nullable=False)
    awarded_on: Mapped[date] = mapped_column(Date, nullable=False)
    awarded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (UniqueConstraint("account_id", "animal_id", name="uq_challenge_awards_account_id_animal_id"),)
