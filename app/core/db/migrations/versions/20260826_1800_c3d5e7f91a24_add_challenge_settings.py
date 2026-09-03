"""add challenge settings

Revision ID: c3d5e7f91a24
Revises: a71c3f5b92de
Create Date: 2026-08-26 18:00:00+09:00

모드·주간 목표·재는 날. 건강정보가 아니라 환경설정이라 서버에 남는다 —
값(체중 76.2kg)은 여전히 브라우저 보관함에만 있다.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c3d5e7f91a24"
down_revision: Union[str, Sequence[str], None] = "a71c3f5b92de"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "challenge_settings",
        sa.Column("account_id", sa.Uuid(), nullable=False),
        sa.Column(
            "mode",
            sa.Enum("personal", "family", name="challenge_mode", native_enum=False, create_constraint=True, length=20),
            server_default="personal",
            nullable=False,
        ),
        sa.Column("weekly_water_goal", sa.Integer(), server_default="5", nullable=False),
        sa.Column("measure_weekday", sa.Integer(), server_default="6", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("weekly_water_goal in (3, 5, 7)", name=op.f("ck_challenge_settings_weekly_water_goal_allowed")),
        sa.CheckConstraint("measure_weekday between 0 and 6", name=op.f("ck_challenge_settings_measure_weekday_range")),
        sa.ForeignKeyConstraint(
            ["account_id"],
            ["service_accounts.id"],
            name=op.f("fk_challenge_settings_account_id_service_accounts"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("account_id", name=op.f("pk_challenge_settings")),
    )


def downgrade() -> None:
    op.drop_table("challenge_settings")
