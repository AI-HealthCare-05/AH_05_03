"""add guardian links and minor deletion review

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-09-19 22:40:00.000000+09:00

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "e5f6a7b8c9d0"
down_revision: Union[str, Sequence[str], None] = "d4e5f6a7b8c9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("family_profiles", sa.Column("adult_transitioned_at", sa.DateTime(timezone=True), nullable=True))
    op.create_table(
        "guardian_links",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("household_id", sa.Uuid(), nullable=False),
        sa.Column("profile_id", sa.Uuid(), nullable=False),
        sa.Column("account_id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column(
            "verification_status",
            sa.String(length=20),
            server_default="unverified",
            nullable=False,
        ),
        sa.Column("self_attested", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("adapter_name", sa.String(length=80), nullable=True),
        sa.Column("row_version", sa.BigInteger(), server_default="1", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["account_id"], ["service_accounts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["household_id"], ["households.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["profile_id"], ["family_profiles.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint("kind IN ('product_guardian', 'legal_representative')", name="guardian_link_kind"),
        sa.CheckConstraint(
            "verification_status IN ('unverified', 'pending', 'verified', 'expired')",
            name="guardian_link_verification_status",
        ),
    )
    op.create_index("ix_guardian_links_household_id", "guardian_links", ["household_id"])
    op.create_index("ix_guardian_links_profile_id", "guardian_links", ["profile_id"])
    op.create_index("ix_guardian_links_account_id", "guardian_links", ["account_id"])
    op.create_index(
        "uq_guardian_links_profile_account_kind",
        "guardian_links",
        ["profile_id", "account_id", "kind"],
        unique=True,
    )
    op.create_table(
        "minor_deletion_requests",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("household_id", sa.Uuid(), nullable=False),
        sa.Column("profile_id", sa.Uuid(), nullable=False),
        sa.Column("requested_by_account_id", sa.Uuid(), nullable=False),
        sa.Column("status", sa.String(length=20), server_default="submitted", nullable=False),
        sa.Column("decision_note", sa.String(length=80), nullable=True),
        sa.Column("legal_hold", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("row_version", sa.BigInteger(), server_default="1", nullable=False),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["household_id"], ["households.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["profile_id"], ["family_profiles.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["requested_by_account_id"], ["service_accounts.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint(
            "status IN ('submitted', 'under_review', 'rejected', 'appealed', 'approved')",
            name="minor_deletion_request_status",
        ),
    )
    op.create_index("ix_minor_deletion_requests_household_id", "minor_deletion_requests", ["household_id"])
    op.create_index("ix_minor_deletion_requests_profile_id", "minor_deletion_requests", ["profile_id"])
    op.create_index(
        "ix_minor_deletion_requests_profile_status",
        "minor_deletion_requests",
        ["profile_id", "status"],
    )


def downgrade() -> None:
    op.drop_index("ix_minor_deletion_requests_profile_status", table_name="minor_deletion_requests")
    op.drop_index("ix_minor_deletion_requests_profile_id", table_name="minor_deletion_requests")
    op.drop_index("ix_minor_deletion_requests_household_id", table_name="minor_deletion_requests")
    op.drop_table("minor_deletion_requests")
    op.drop_index("uq_guardian_links_profile_account_kind", table_name="guardian_links")
    op.drop_index("ix_guardian_links_account_id", table_name="guardian_links")
    op.drop_index("ix_guardian_links_profile_id", table_name="guardian_links")
    op.drop_index("ix_guardian_links_household_id", table_name="guardian_links")
    op.drop_table("guardian_links")
    op.drop_column("family_profiles", "adult_transitioned_at")
