"""split privacy self-determination and civil majority

Revision ID: f6a7b8c9d0e1
Revises: e5f6a7b8c9d0
Create Date: 2026-09-19 23:40:00.000000+09:00

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f6a7b8c9d0e1"
down_revision: Union[str, Sequence[str], None] = "e5f6a7b8c9d0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("family_profiles", sa.Column("privacy_self_determined_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        "family_profiles", sa.Column("adult_transition_pending_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column("guardian_links", sa.Column("share_reapproved_at", sa.DateTime(timezone=True), nullable=True))
    op.create_table(
        "birth_date_corrections",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("household_id", sa.Uuid(), nullable=False),
        sa.Column("profile_id", sa.Uuid(), nullable=False),
        sa.Column("actor_account_id", sa.Uuid(), nullable=False),
        sa.Column("previous_birth_date", sa.String(length=10), nullable=True),
        sa.Column("new_birth_date", sa.String(length=10), nullable=False),
        sa.Column("reason", sa.String(length=80), nullable=False),
        sa.Column("row_version", sa.BigInteger(), server_default="1", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["household_id"], ["households.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["profile_id"], ["family_profiles.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["actor_account_id"], ["service_accounts.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_birth_date_corrections_household_id", "birth_date_corrections", ["household_id"])
    op.create_index("ix_birth_date_corrections_profile_id", "birth_date_corrections", ["profile_id"])


def downgrade() -> None:
    op.drop_index("ix_birth_date_corrections_profile_id", table_name="birth_date_corrections")
    op.drop_index("ix_birth_date_corrections_household_id", table_name="birth_date_corrections")
    op.drop_table("birth_date_corrections")
    op.drop_column("guardian_links", "share_reapproved_at")
    op.drop_column("family_profiles", "adult_transition_pending_at")
    op.drop_column("family_profiles", "privacy_self_determined_at")
