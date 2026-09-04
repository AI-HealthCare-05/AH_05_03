"""챌린지 개인 설정 — 모드·주간 목표·재는 날.

건강정보가 아니라 환경설정이다. "이 사람이 주 5일을 목표로 한다" 는 건강 상태를
말해 주지 않으므로 ADR-002 §4 의 서버 저장 경계 안에 있다. 값(체중 76.2kg)은
여전히 브라우저 보관함에만 남는다.
"""

import uuid

from sqlalchemy import CheckConstraint, ForeignKey, Integer, Uuid
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db.base import Base, TimestampMixin
from app.core.utils.enums import StrEnum


class ChallengeMode(StrEnum):
    PERSONAL = "personal"
    FAMILY = "family"


class ChallengeSettings(TimestampMixin, Base):
    __tablename__ = "challenge_settings"

    account_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("service_accounts.id", ondelete="CASCADE"), primary_key=True
    )
    mode: Mapped[ChallengeMode] = mapped_column(
        SAEnum(
            ChallengeMode,
            native_enum=False,
            create_constraint=True,
            length=20,
            name="challenge_mode",
            values_callable=lambda cls: [member.value for member in cls],
            validate_strings=True,
        ),
        default=ChallengeMode.PERSONAL,
        server_default=ChallengeMode.PERSONAL.value,
        nullable=False,
    )
    # 주 완주 기준. 낮추면 흔들림이 줄고 올리면 점수가 는다.
    weekly_water_goal: Mapped[int] = mapped_column(Integer, default=5, server_default="5", nullable=False)
    # 재는 날. 0 = 월요일. 가족이 같은 날 재도록 유도하는 값이다.
    measure_weekday: Mapped[int] = mapped_column(Integer, default=6, server_default="6", nullable=False)

    __table_args__ = (
        # 3·5·7 만 허용한다. 카탈로그가 세 갈래로 고정돼 있고, 임의 값이 들어오면
        # 주 완주 기준이 사람마다 달라져 가족 합산 목표가 설명 불가능해진다.
        CheckConstraint("weekly_water_goal in (3, 5, 7)", name="weekly_water_goal_allowed"),
        CheckConstraint("measure_weekday between 0 and 6", name="measure_weekday_range"),
    )
