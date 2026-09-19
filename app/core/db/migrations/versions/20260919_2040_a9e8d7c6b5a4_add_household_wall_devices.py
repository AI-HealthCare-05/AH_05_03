"""add household wall devices and pairings

Revision ID: a9e8d7c6b5a4
Revises: c4a1b2d3e4f5
Create Date: 2026-09-19 20:40:00.000000+09:00

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a9e8d7c6b5a4"
down_revision: Union[str, Sequence[str], None] = "c4a1b2d3e4f5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "household_device_pairings",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("household_id", sa.Uuid(), nullable=False),
        sa.Column("created_by_account_id", sa.Uuid(), nullable=False),
        sa.Column("code_hash", sa.String(length=64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["created_by_account_id"],
            ["service_accounts.id"],
            name=op.f("fk_household_device_pairings_created_by_account_id_service_accounts"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["household_id"],
            ["households.id"],
            name=op.f("fk_household_device_pairings_household_id_households"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_household_device_pairings")),
        sa.UniqueConstraint("code_hash", name=op.f("uq_household_device_pairings_code_hash")),
    )
    op.create_index(
        op.f("ix_household_device_pairings_household_id"),
        "household_device_pairings",
        ["household_id"],
        unique=False,
    )
    op.create_table(
        "household_devices",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("household_id", sa.Uuid(), nullable=False),
        sa.Column("pairing_id", sa.Uuid(), nullable=False),
        sa.Column("created_by_account_id", sa.Uuid(), nullable=False),
        sa.Column("display_name", sa.String(length=80), nullable=False),
        sa.Column("device_ref", sa.String(length=86), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=20), server_default="active", nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("row_version", sa.BigInteger(), server_default="1", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint(
            "(status = 'revoked' AND revoked_at IS NOT NULL) OR (status = 'active' AND revoked_at IS NULL)",
            name="household_device_revoked_at_consistent",
        ),
        sa.CheckConstraint("device_ref ~ '^[A-Za-z0-9_-]{43,86}$'", name="household_device_ref_format"),
        sa.CheckConstraint("status IN ('active', 'revoked')", name="household_device_status"),
        sa.ForeignKeyConstraint(
            ["created_by_account_id"],
            ["service_accounts.id"],
            name=op.f("fk_household_devices_created_by_account_id_service_accounts"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["household_id"],
            ["households.id"],
            name=op.f("fk_household_devices_household_id_households"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["pairing_id"],
            ["household_device_pairings.id"],
            name=op.f("fk_household_devices_pairing_id_household_device_pairings"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_household_devices")),
        sa.UniqueConstraint("pairing_id", name=op.f("uq_household_devices_pairing_id")),
        sa.UniqueConstraint("token_hash", name=op.f("uq_household_devices_token_hash")),
        sa.UniqueConstraint("household_id", "device_ref", name="uq_household_devices_household_ref"),
    )
    op.create_index(op.f("ix_household_devices_household_id"), "household_devices", ["household_id"], unique=False)
    op.create_index(
        "ix_household_devices_household_status", "household_devices", ["household_id", "status"], unique=False
    )


def downgrade() -> None:
    op.drop_index("ix_household_devices_household_status", table_name="household_devices")
    op.drop_index(op.f("ix_household_devices_household_id"), table_name="household_devices")
    op.drop_table("household_devices")
    op.drop_index(op.f("ix_household_device_pairings_household_id"), table_name="household_device_pairings")
    op.drop_table("household_device_pairings")
