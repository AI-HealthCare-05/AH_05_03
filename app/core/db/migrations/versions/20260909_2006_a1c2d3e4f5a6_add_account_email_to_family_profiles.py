"""add account_email to family_profiles

Revision ID: a1c2d3e4f5a6
Revises: b812213ae8dc
Create Date: 2026-09-09 20:06:00.000000+09:00

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "a1c2d3e4f5a6"
down_revision: Union[str, Sequence[str], None] = "b812213ae8dc"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("family_profiles", sa.Column("account_email", sa.String(length=255), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("family_profiles", "account_email")
