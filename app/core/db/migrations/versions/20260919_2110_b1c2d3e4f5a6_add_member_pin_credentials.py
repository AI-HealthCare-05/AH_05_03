"""add member pin credentials and sessions

Revision ID: b1c2d3e4f5a6
Revises: a9e8d7c6b5a4
Create Date: 2026-09-19 21:10:00.000000+09:00

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b1c2d3e4f5a6"
down_revision: Union[str, Sequence[str], None] = "a9e8d7c6b5a4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "member_pin_credentials",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("profile_id", sa.Uuid(), nullable=False),
        sa.Column("household_id", sa.Uuid(), nullable=False),
        sa.Column("pin_hash", sa.String(length=255), nullable=False),
        sa.Column("must_change", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("failed_attempts", sa.Integer(), server_default="0", nullable=False),
        sa.Column("locked_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("generation", sa.Integer(), server_default="1", nullable=False),
        sa.Column("row_version", sa.BigInteger(), server_default="1", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["household_id"], ["households.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["profile_id"], ["family_profiles.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_member_pin_credentials")),
        sa.UniqueConstraint("profile_id", name=op.f("uq_member_pin_credentials_profile_id")),
    )
    op.create_index(op.f("ix_member_pin_credentials_household_id"), "member_pin_credentials", ["household_id"])
    op.create_table(
        "member_sessions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("profile_id", sa.Uuid(), nullable=False),
        sa.Column("household_id", sa.Uuid(), nullable=False),
        sa.Column("device_id", sa.Uuid(), nullable=True),
        sa.Column("credential_generation", sa.Integer(), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["device_id"], ["household_devices.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["household_id"], ["households.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["profile_id"], ["family_profiles.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_member_sessions")),
        sa.UniqueConstraint("token_hash", name=op.f("uq_member_sessions_token_hash")),
    )
    op.create_index(op.f("ix_member_sessions_profile_id"), "member_sessions", ["profile_id"])
    op.create_index(op.f("ix_member_sessions_household_id"), "member_sessions", ["household_id"])
    op.create_index(op.f("ix_member_sessions_device_id"), "member_sessions", ["device_id"])
    op.create_index("ix_member_sessions_profile_active", "member_sessions", ["profile_id", "expires_at"])


def downgrade() -> None:
    op.drop_index("ix_member_sessions_profile_active", table_name="member_sessions")
    op.drop_index(op.f("ix_member_sessions_device_id"), table_name="member_sessions")
    op.drop_index(op.f("ix_member_sessions_household_id"), table_name="member_sessions")
    op.drop_index(op.f("ix_member_sessions_profile_id"), table_name="member_sessions")
    op.drop_table("member_sessions")
    op.drop_index(op.f("ix_member_pin_credentials_household_id"), table_name="member_pin_credentials")
    op.drop_table("member_pin_credentials")
