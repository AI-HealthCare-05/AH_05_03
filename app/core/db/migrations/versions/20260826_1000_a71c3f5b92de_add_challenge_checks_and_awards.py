"""add challenge checks and awards

Revision ID: a71c3f5b92de
Revises: 91c8e40c547a
Create Date: 2026-08-26 10:00:00+09:00

건강 수치를 담는 칼럼이 없다. `challenge_checks` 는 무엇을 했는지와 언제인지만 남기고
측정값은 브라우저 보관함에 머문다 (ADR-002 §4). 값을 서버에 남기려면 이 마이그레이션을
고쳐야 하고, 그러려면 ADR 개정을 함께 통과해야 한다.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "a71c3f5b92de"
down_revision: Union[str, Sequence[str], None] = "91c8e40c547a"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "challenge_checks",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("account_id", sa.Uuid(), nullable=False),
        sa.Column("challenge_id", sa.String(length=32), nullable=False),
        sa.Column("checked_on", sa.Date(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["account_id"],
            ["service_accounts.id"],
            name=op.f("fk_challenge_checks_account_id_service_accounts"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_challenge_checks")),
        sa.UniqueConstraint(
            "account_id",
            "challenge_id",
            "checked_on",
            name="uq_challenge_checks_account_id_challenge_id_checked_on",
        ),
    )
    op.create_index(op.f("ix_challenge_checks_account_id"), "challenge_checks", ["account_id"], unique=False)
    # 정원 계산이 계정별 전량 조회라 정렬까지 인덱스로 받는다.
    op.create_index(
        "ix_challenge_checks_account_id_checked_on",
        "challenge_checks",
        ["account_id", "checked_on"],
        unique=False,
    )

    op.create_table(
        "challenge_awards",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("account_id", sa.Uuid(), nullable=False),
        sa.Column("animal_id", sa.String(length=32), nullable=False),
        sa.Column("awarded_on", sa.Date(), nullable=False),
        sa.Column("awarded_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["account_id"],
            ["service_accounts.id"],
            name=op.f("fk_challenge_awards_account_id_service_accounts"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_challenge_awards")),
        sa.UniqueConstraint("account_id", "animal_id", name="uq_challenge_awards_account_id_animal_id"),
    )
    op.create_index(op.f("ix_challenge_awards_account_id"), "challenge_awards", ["account_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_challenge_awards_account_id"), table_name="challenge_awards")
    op.drop_table("challenge_awards")
    op.drop_index("ix_challenge_checks_account_id_checked_on", table_name="challenge_checks")
    op.drop_index(op.f("ix_challenge_checks_account_id"), table_name="challenge_checks")
    op.drop_table("challenge_checks")
