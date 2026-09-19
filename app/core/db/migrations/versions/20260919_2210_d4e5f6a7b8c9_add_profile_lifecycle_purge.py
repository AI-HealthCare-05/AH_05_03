"""add archived deleted lifecycle and purge schedule

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-09-19 22:10:00.000000+09:00

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "d4e5f6a7b8c9"
down_revision: Union[str, Sequence[str], None] = "c3d4e5f6a7b8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint("family_profile_lifecycle_status_consistent", "family_profiles", type_="check")
    op.drop_constraint("family_profile_lifecycle_status", "family_profiles", type_="check")
    op.add_column("family_profiles", sa.Column("purge_after", sa.DateTime(timezone=True), nullable=True))
    op.add_column("family_profiles", sa.Column("purged_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("family_profiles", sa.Column("purge_hold_reason", sa.String(length=80), nullable=True))
    op.create_index("ix_family_profiles_purge_after", "family_profiles", ["purge_after"])
    op.create_check_constraint(
        "family_profile_lifecycle_status",
        "family_profiles",
        "lifecycle_status IN ('active', 'hidden', 'archived', 'unshared', 'pending_delete', 'deleted')",
    )
    op.create_check_constraint(
        "family_profile_lifecycle_status_consistent",
        "family_profiles",
        "(lifecycle_status = 'hidden' AND status = 'hidden') OR "
        "(lifecycle_status = 'archived' AND status = 'hidden') OR "
        "(lifecycle_status IN ('pending_delete', 'deleted') AND status = 'deleted') OR "
        "(lifecycle_status IN ('active', 'unshared') AND status = 'active')",
    )


def downgrade() -> None:
    op.drop_constraint("family_profile_lifecycle_status_consistent", "family_profiles", type_="check")
    op.drop_constraint("family_profile_lifecycle_status", "family_profiles", type_="check")
    op.drop_index("ix_family_profiles_purge_after", table_name="family_profiles")
    op.drop_column("family_profiles", "purge_hold_reason")
    op.drop_column("family_profiles", "purged_at")
    op.drop_column("family_profiles", "purge_after")
    op.create_check_constraint(
        "family_profile_lifecycle_status",
        "family_profiles",
        "lifecycle_status IN ('active', 'hidden', 'unshared', 'pending_delete')",
    )
    op.create_check_constraint(
        "family_profile_lifecycle_status_consistent",
        "family_profiles",
        "(lifecycle_status = 'hidden' AND status = 'hidden') OR "
        "(lifecycle_status = 'pending_delete' AND status = 'deleted') OR "
        "(lifecycle_status IN ('active', 'unshared') AND status = 'active')",
    )
