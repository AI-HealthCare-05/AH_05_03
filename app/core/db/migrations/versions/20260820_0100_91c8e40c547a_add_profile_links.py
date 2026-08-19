"""add profile links

Revision ID: 91c8e40c547a
Revises: c472f0c9a6d1
Create Date: 2026-08-20 01:00:00+09:00

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "91c8e40c547a"
down_revision: Union[str, Sequence[str], None] = "c472f0c9a6d1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "profile_links",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("household_id", sa.Uuid(), nullable=False),
        sa.Column("account_id", sa.Uuid(), nullable=False),
        sa.Column("invitation_id", sa.Uuid(), nullable=True),
        sa.Column("local_profile_ref", sa.String(length=86), nullable=False),
        sa.Column(
            "status",
            sa.Enum(
                "active",
                "unlinked",
                name="profile_link_status",
                native_enum=False,
                create_constraint=True,
                length=20,
            ),
            server_default="active",
            nullable=False,
        ),
        sa.Column("linked_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("unlinked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("row_version", sa.BigInteger(), server_default="1", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint(
            "local_profile_ref ~ '^[A-Za-z0-9_-]{43,86}$'",
            name=op.f("ck_profile_links_profile_link_ref_format"),
        ),
        sa.CheckConstraint(
            "(status = 'active' AND unlinked_at IS NULL) OR (status = 'unlinked' AND unlinked_at IS NOT NULL)",
            name=op.f("ck_profile_links_profile_link_status_unlinked_at_consistent"),
        ),
        sa.ForeignKeyConstraint(
            ["account_id"],
            ["service_accounts.id"],
            name=op.f("fk_profile_links_account_id_service_accounts"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["household_id"],
            ["households.id"],
            name=op.f("fk_profile_links_household_id_households"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["invitation_id"],
            ["family_invitations.id"],
            name=op.f("fk_profile_links_invitation_id_family_invitations"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_profile_links")),
        sa.UniqueConstraint("invitation_id", name=op.f("uq_profile_links_invitation_id")),
        sa.UniqueConstraint(
            "household_id",
            "local_profile_ref",
            name="uq_profile_links_household_profile_ref",
        ),
    )
    op.create_index(op.f("ix_profile_links_account_id"), "profile_links", ["account_id"], unique=False)
    op.create_index(op.f("ix_profile_links_household_id"), "profile_links", ["household_id"], unique=False)
    op.create_index(
        "uq_profile_links_active_household_account",
        "profile_links",
        ["household_id", "account_id"],
        unique=True,
        postgresql_where=sa.text("status = 'active'"),
    )


def downgrade() -> None:
    op.drop_index("uq_profile_links_active_household_account", table_name="profile_links")
    op.drop_index(op.f("ix_profile_links_household_id"), table_name="profile_links")
    op.drop_index(op.f("ix_profile_links_account_id"), table_name="profile_links")
    op.drop_table("profile_links")
