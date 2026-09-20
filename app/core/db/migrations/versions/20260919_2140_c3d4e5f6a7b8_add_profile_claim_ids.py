"""add invitation and profile-link family profile ids for claim

Revision ID: c3d4e5f6a7b8
Revises: b1c2d3e4f5a6
Create Date: 2026-09-19 21:40:00.000000+09:00

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c3d4e5f6a7b8"
down_revision: Union[str, Sequence[str], None] = "b1c2d3e4f5a6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("family_invitations", sa.Column("target_profile_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        op.f("fk_family_invitations_target_profile_id_family_profiles"),
        "family_invitations",
        "family_profiles",
        ["target_profile_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(op.f("ix_family_invitations_target_profile_id"), "family_invitations", ["target_profile_id"])
    op.add_column("profile_links", sa.Column("profile_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        op.f("fk_profile_links_profile_id_family_profiles"),
        "profile_links",
        "family_profiles",
        ["profile_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(op.f("ix_profile_links_profile_id"), "profile_links", ["profile_id"])


def downgrade() -> None:
    op.drop_index(op.f("ix_profile_links_profile_id"), table_name="profile_links")
    op.drop_constraint(op.f("fk_profile_links_profile_id_family_profiles"), "profile_links", type_="foreignkey")
    op.drop_column("profile_links", "profile_id")
    op.drop_index(op.f("ix_family_invitations_target_profile_id"), table_name="family_invitations")
    op.drop_constraint(
        op.f("fk_family_invitations_target_profile_id_family_profiles"), "family_invitations", type_="foreignkey"
    )
    op.drop_column("family_invitations", "target_profile_id")
