"""shorten civil majority review_status check name

Revision ID: h8i9j0k1l2m3
Revises: g7b8c9d0e1f2
Create Date: 2026-09-20 02:10:00.000000+09:00

PostgreSQL 식별자는 63바이트다. 예전 이름
`ck_civil_majority_transitions_civil_majority_transition_review_status`
는 잘려 `..._d371` 이 되었고 alembic check 가 모델과 불일치로 실패했다.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "h8i9j0k1l2m3"
down_revision: Union[str, Sequence[str], None] = "g7b8c9d0e1f2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_OLD_NAMES = (
    "ck_civil_majority_transitions_civil_majority_transition_d371",
    "ck_civil_majority_transitions_civil_majority_transition_review_status",
    "civil_majority_transition_review_status",
    "ck_civil_majority_transitions_review_status",
)
_NEW_NAME = "ck_civil_majority_transitions_review_status"


def upgrade() -> None:
    for name in _OLD_NAMES:
        op.execute(sa.text(f"ALTER TABLE civil_majority_transitions DROP CONSTRAINT IF EXISTS {name}"))
    op.execute(
        sa.text(
            "ALTER TABLE civil_majority_transitions "
            f"ADD CONSTRAINT {_NEW_NAME} "
            "CHECK (review_status IN ('active', 'invalidated', 'needs_review'))"
        )
    )


def downgrade() -> None:
    op.execute(sa.text(f"ALTER TABLE civil_majority_transitions DROP CONSTRAINT IF EXISTS {_NEW_NAME}"))
    op.execute(
        sa.text(
            "ALTER TABLE civil_majority_transitions "
            "ADD CONSTRAINT civil_majority_transition_review_status "
            "CHECK (review_status IN ('active', 'invalidated', 'needs_review'))"
        )
    )
