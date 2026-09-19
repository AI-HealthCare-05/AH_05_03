"""household session epoch, scoped share, civil majority history

Revision ID: g7b8c9d0e1f2
Revises: f6a7b8c9d0e1
Create Date: 2026-09-20 00:10:00.000000+09:00

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "g7b8c9d0e1f2"
down_revision: Union[str, Sequence[str], None] = "f6a7b8c9d0e1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("households", sa.Column("session_epoch", sa.BigInteger(), server_default="1", nullable=False))
    op.add_column(
        "household_devices", sa.Column("issued_session_epoch", sa.BigInteger(), server_default="1", nullable=False)
    )
    op.add_column(
        "member_sessions", sa.Column("issued_session_epoch", sa.Integer(), server_default="1", nullable=False)
    )
    op.add_column("guardian_links", sa.Column("share_grantor_account_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_guardian_links_share_grantor_account_id",
        "guardian_links",
        "service_accounts",
        ["share_grantor_account_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.add_column(
        "guardian_links", sa.Column("share_capabilities", sa.String(length=240), server_default="", nullable=False)
    )
    op.add_column("guardian_links", sa.Column("share_expires_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("guardian_links", sa.Column("share_revoked_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("guardian_links", sa.Column("share_policy_version", sa.String(length=40), nullable=True))
    op.add_column("guardian_links", sa.Column("share_reauthenticated_at", sa.DateTime(timezone=True), nullable=True))
    op.create_table(
        "civil_majority_transitions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("household_id", sa.Uuid(), nullable=False),
        sa.Column("profile_id", sa.Uuid(), nullable=False),
        sa.Column("actor_account_id", sa.Uuid(), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("invalidated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("invalidated_reason", sa.String(length=80), nullable=True),
        sa.Column("superseded_by", sa.Uuid(), nullable=True),
        sa.Column("review_status", sa.String(length=20), server_default="active", nullable=False),
        sa.Column("idempotency_key", sa.String(length=80), nullable=False),
        sa.Column("invalidation_idempotency_key", sa.String(length=80), nullable=True),
        sa.Column("previous_birth_date", sa.String(length=10), nullable=True),
        sa.Column("new_birth_date", sa.String(length=10), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["household_id"], ["households.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["profile_id"], ["family_profiles.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["actor_account_id"], ["service_accounts.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint(
            "review_status IN ('active', 'invalidated', 'needs_review')",
            name="civil_majority_transition_review_status",
        ),
    )
    op.create_index("ix_civil_majority_transitions_household_id", "civil_majority_transitions", ["household_id"])
    op.create_index("ix_civil_majority_transitions_profile_id", "civil_majority_transitions", ["profile_id"])
    op.create_index(
        "uq_civil_majority_transitions_idempotency",
        "civil_majority_transitions",
        ["idempotency_key"],
        unique=True,
    )
    op.create_index(
        "uq_civil_majority_transitions_invalidation_key",
        "civil_majority_transitions",
        ["invalidation_idempotency_key"],
        unique=True,
        postgresql_where=sa.text("invalidation_idempotency_key IS NOT NULL"),
    )
    op.create_index(
        "uq_civil_majority_transitions_active_profile",
        "civil_majority_transitions",
        ["profile_id"],
        unique=True,
        postgresql_where=sa.text("invalidated_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_civil_majority_transitions_active_profile", table_name="civil_majority_transitions")
    op.drop_index("uq_civil_majority_transitions_invalidation_key", table_name="civil_majority_transitions")
    op.drop_index("uq_civil_majority_transitions_idempotency", table_name="civil_majority_transitions")
    op.drop_index("ix_civil_majority_transitions_profile_id", table_name="civil_majority_transitions")
    op.drop_index("ix_civil_majority_transitions_household_id", table_name="civil_majority_transitions")
    op.drop_table("civil_majority_transitions")
    op.drop_column("guardian_links", "share_reauthenticated_at")
    op.drop_column("guardian_links", "share_policy_version")
    op.drop_column("guardian_links", "share_revoked_at")
    op.drop_column("guardian_links", "share_expires_at")
    op.drop_column("guardian_links", "share_capabilities")
    op.drop_constraint("fk_guardian_links_share_grantor_account_id", "guardian_links", type_="foreignkey")
    op.drop_column("guardian_links", "share_grantor_account_id")
    op.drop_column("member_sessions", "issued_session_epoch")
    op.drop_column("household_devices", "issued_session_epoch")
    op.drop_column("households", "session_epoch")
