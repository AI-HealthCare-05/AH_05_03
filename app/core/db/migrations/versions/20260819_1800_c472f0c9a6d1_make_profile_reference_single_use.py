"""make invitation profile references single-use per household

Revision ID: c472f0c9a6d1
Revises: 0bf56173f28b
Create Date: 2026-08-19 18:00:00+09:00

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c472f0c9a6d1"
down_revision: Union[str, Sequence[str], None] = "0bf56173f28b"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_index(
        "uq_family_invitations_pending_target",
        table_name="family_invitations",
        postgresql_where=sa.text("status = 'pending'"),
    )
    op.create_index(
        "uq_family_invitations_profile_ref_lifetime",
        "family_invitations",
        ["household_id", "target_profile_ref"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index(
        "uq_family_invitations_profile_ref_lifetime",
        table_name="family_invitations",
    )
    op.create_index(
        "uq_family_invitations_pending_target",
        "family_invitations",
        ["household_id", sa.literal_column("lower(invitee_email)"), "target_profile_ref"],
        unique=True,
        postgresql_where=sa.text("status = 'pending'"),
    )
