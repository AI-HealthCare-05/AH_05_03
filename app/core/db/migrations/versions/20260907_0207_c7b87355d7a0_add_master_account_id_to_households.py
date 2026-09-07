"""add_master_account_id_to_households

Revision ID: c7b87355d7a0
Revises: 6b3d62092d34
Create Date: 2026-09-07 02:07:56.815020+09:00

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "c7b87355d7a0"
down_revision: Union[str, Sequence[str], None] = "6b3d62092d34"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("households", sa.Column("master_account_id", sa.Uuid(), nullable=True))
    op.execute("UPDATE households SET master_account_id = created_by_account_id WHERE master_account_id IS NULL")
    op.alter_column("households", "master_account_id", nullable=False)
    op.create_foreign_key(
        op.f("fk_households_master_account_id_service_accounts"),
        "households",
        "service_accounts",
        ["master_account_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_index(op.f("ix_households_master_account_id"), "households", ["master_account_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_households_master_account_id"), table_name="households")
    op.drop_constraint(op.f("fk_households_master_account_id_service_accounts"), "households", type_="foreignkey")
    op.drop_column("households", "master_account_id")
