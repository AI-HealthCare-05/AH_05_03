"""Create users table.

Revision ID: 20260818_0001
Revises:
Create Date: 2026-08-18
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import context, op

revision: str = "20260818_0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    if not context.is_offline_mode():
        inspector = sa.inspect(op.get_bind())
        if "users" in inspector.get_table_names():
            expected_columns = {
                "id",
                "email",
                "hashed_password",
                "name",
                "gender",
                "birthday",
                "phone_number",
                "is_active",
                "is_admin",
                "last_login",
                "created_at",
                "updated_at",
            }
            actual_columns = {column["name"] for column in inspector.get_columns("users")}
            missing_columns = expected_columns - actual_columns
            if missing_columns:
                missing = ", ".join(sorted(missing_columns))
                raise RuntimeError(f"Existing users table is missing required columns: {missing}")
            return

    op.create_table(
        "users",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("email", sa.String(length=40), nullable=False),
        sa.Column("hashed_password", sa.String(length=128), nullable=False),
        sa.Column("name", sa.String(length=20), nullable=False),
        sa.Column(
            "gender",
            sa.Enum("MALE", "FEMALE", name="gender", native_enum=False, length=6),
            nullable=False,
        ),
        sa.Column("birthday", sa.Date(), nullable=False),
        sa.Column("phone_number", sa.String(length=11), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column("is_admin", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("last_login", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    op.drop_table("users")
