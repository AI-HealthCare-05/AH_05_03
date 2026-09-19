"""add profile ownership lifecycle capability grants and audit

Revision ID: c4a1b2d3e4f5
Revises: f019a8b6dda0
Create Date: 2026-09-19 20:10:00.000000+09:00

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "c4a1b2d3e4f5"
down_revision: Union[str, Sequence[str], None] = "f019a8b6dda0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("family_profiles", sa.Column("claimed_account_id", sa.Uuid(), nullable=True))
    op.add_column(
        "family_profiles",
        sa.Column("ownership_type", sa.String(length=32), server_default="local_slot", nullable=False),
    )
    op.add_column(
        "family_profiles",
        sa.Column("lifecycle_status", sa.String(length=32), server_default="active", nullable=False),
    )
    op.add_column(
        "family_profiles",
        sa.Column("member_role", sa.String(length=32), server_default="adult_member", nullable=False),
    )
    op.create_foreign_key(
        op.f("fk_family_profiles_claimed_account_id_service_accounts"),
        "family_profiles",
        "service_accounts",
        ["claimed_account_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        op.f("ix_family_profiles_claimed_account_id"), "family_profiles", ["claimed_account_id"], unique=False
    )

    op.execute(
        """
        UPDATE family_profiles AS fp
        SET claimed_account_id = sa.id
        FROM service_accounts AS sa
        WHERE fp.account_email IS NOT NULL
          AND lower(fp.account_email) = lower(sa.email)
        """
    )
    op.execute(
        """
        UPDATE family_profiles
        SET member_role = CASE
            WHEN relationship IN ('자녀', 'child', 'son', 'daughter', '아들', '딸')
                 OR lower(relationship) IN ('child', 'son', 'daughter')
                THEN 'self_only'
            WHEN relationship IN ('기타', 'other') OR lower(relationship) = 'other'
                THEN 'restricted'
            ELSE 'adult_member'
        END
        """
    )
    op.execute(
        """
        UPDATE family_profiles
        SET ownership_type = CASE
            WHEN member_role = 'self_only' THEN 'guardian_managed'
            WHEN birth_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
                 AND EXTRACT(YEAR FROM age(CAST(birth_date AS date))) < 14
                THEN 'guardian_managed'
            WHEN claimed_account_id IS NOT NULL OR account_email IS NOT NULL THEN 'claimed_adult'
            ELSE 'local_slot'
        END,
        lifecycle_status = CASE status
            WHEN 'hidden' THEN 'hidden'
            WHEN 'deleted' THEN 'pending_delete'
            ELSE 'active'
        END
        """
    )

    op.create_check_constraint(
        "family_profile_ownership_type",
        "family_profiles",
        "ownership_type IN ('local_slot', 'claimed_adult', 'guardian_managed')",
    )
    op.create_check_constraint(
        "family_profile_lifecycle_status",
        "family_profiles",
        "lifecycle_status IN ('active', 'hidden', 'unshared', 'pending_delete')",
    )
    op.create_check_constraint(
        "family_profile_member_role",
        "family_profiles",
        "member_role IN ('adult_member', 'self_only', 'restricted')",
    )
    op.create_check_constraint(
        "family_profile_lifecycle_status_consistent",
        "family_profiles",
        "(lifecycle_status = 'hidden' AND status = 'hidden') OR "
        "(lifecycle_status = 'pending_delete' AND status = 'deleted') OR "
        "(lifecycle_status IN ('active', 'unshared') AND status = 'active')",
    )
    op.create_index(
        "uq_family_profiles_active_claimed_account",
        "family_profiles",
        ["household_id", "claimed_account_id"],
        unique=True,
        postgresql_where=sa.text("claimed_account_id IS NOT NULL AND lifecycle_status = 'active'"),
    )

    op.create_table(
        "capability_grants",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("household_id", sa.Uuid(), nullable=False),
        sa.Column("profile_id", sa.Uuid(), nullable=False),
        sa.Column("capability", sa.String(length=40), nullable=False),
        sa.Column("effect", sa.String(length=10), nullable=False),
        sa.Column("created_by_account_id", sa.Uuid(), nullable=False),
        sa.Column("row_version", sa.BigInteger(), server_default="1", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("effect IN ('allow', 'deny')", name="capability_grant_effect"),
        sa.ForeignKeyConstraint(
            ["created_by_account_id"],
            ["service_accounts.id"],
            name=op.f("fk_capability_grants_created_by_account_id_service_accounts"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["household_id"],
            ["households.id"],
            name=op.f("fk_capability_grants_household_id_households"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["profile_id"],
            ["family_profiles.id"],
            name=op.f("fk_capability_grants_profile_id_family_profiles"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_capability_grants")),
    )
    op.create_index(op.f("ix_capability_grants_household_id"), "capability_grants", ["household_id"], unique=False)
    op.create_index(op.f("ix_capability_grants_profile_id"), "capability_grants", ["profile_id"], unique=False)
    op.create_index(
        "uq_capability_grants_profile_capability", "capability_grants", ["profile_id", "capability"], unique=True
    )

    op.create_table(
        "account_audit_events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("actor_account_id", sa.Uuid(), nullable=True),
        sa.Column("household_id", sa.Uuid(), nullable=True),
        sa.Column("event_type", sa.String(length=80), nullable=False),
        sa.Column("target_type", sa.String(length=40), nullable=True),
        sa.Column("target_ref", sa.String(length=86), nullable=True),
        sa.Column("request_id", sa.Uuid(), nullable=True),
        sa.Column(
            "metadata", postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'{}'::jsonb"), nullable=False
        ),
        sa.Column("occurred_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("jsonb_typeof(metadata) = 'object'", name="account_audit_metadata_object"),
        sa.ForeignKeyConstraint(
            ["actor_account_id"],
            ["service_accounts.id"],
            name=op.f("fk_account_audit_events_actor_account_id_service_accounts"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["household_id"],
            ["households.id"],
            name=op.f("fk_account_audit_events_household_id_households"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_account_audit_events")),
    )
    op.create_index(
        op.f("ix_account_audit_events_actor_account_id"), "account_audit_events", ["actor_account_id"], unique=False
    )
    op.create_index(
        op.f("ix_account_audit_events_household_id"), "account_audit_events", ["household_id"], unique=False
    )
    op.create_index(
        "ix_account_audit_events_actor_time",
        "account_audit_events",
        ["actor_account_id", "occurred_at"],
        unique=False,
    )
    op.create_index(
        "ix_account_audit_events_household_time",
        "account_audit_events",
        ["household_id", "occurred_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_account_audit_events_household_time", table_name="account_audit_events")
    op.drop_index("ix_account_audit_events_actor_time", table_name="account_audit_events")
    op.drop_index(op.f("ix_account_audit_events_household_id"), table_name="account_audit_events")
    op.drop_index(op.f("ix_account_audit_events_actor_account_id"), table_name="account_audit_events")
    op.drop_table("account_audit_events")
    op.drop_index("uq_capability_grants_profile_capability", table_name="capability_grants")
    op.drop_index(op.f("ix_capability_grants_profile_id"), table_name="capability_grants")
    op.drop_index(op.f("ix_capability_grants_household_id"), table_name="capability_grants")
    op.drop_table("capability_grants")
    op.drop_index("uq_family_profiles_active_claimed_account", table_name="family_profiles")
    op.drop_constraint(
        "ck_family_profiles_family_profile_lifecycle_status_consistent", "family_profiles", type_="check"
    )
    op.drop_constraint("ck_family_profiles_family_profile_member_role", "family_profiles", type_="check")
    op.drop_constraint("ck_family_profiles_family_profile_lifecycle_status", "family_profiles", type_="check")
    op.drop_constraint("ck_family_profiles_family_profile_ownership_type", "family_profiles", type_="check")
    op.drop_index(op.f("ix_family_profiles_claimed_account_id"), table_name="family_profiles")
    op.drop_constraint(
        op.f("fk_family_profiles_claimed_account_id_service_accounts"), "family_profiles", type_="foreignkey"
    )
    op.drop_column("family_profiles", "member_role")
    op.drop_column("family_profiles", "lifecycle_status")
    op.drop_column("family_profiles", "ownership_type")
    op.drop_column("family_profiles", "claimed_account_id")
