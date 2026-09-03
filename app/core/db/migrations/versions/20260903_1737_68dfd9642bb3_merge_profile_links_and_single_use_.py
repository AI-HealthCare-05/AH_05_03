"""merge profile_links and single-use profile reference

Revision ID: 68dfd9642bb3
Revises: 2861d7594df1, c472f0c9a6d1
Create Date: 2026-09-03 17:37:01.217479+09:00

`0bf56173f28b` 뒤로 갈래가 둘 생겼다. main 이 `2861d7594df1`(profile_links 신설)을,
이 브랜치가 `c472f0c9a6d1`(초대 참조값을 1회용으로)을 각각 붙였기 때문이다. 둘을
합치면서 `alembic upgrade head` 가 "Multiple head revisions are present" 로 멈췄다.

두 갈래는 건드리는 것이 다르다 — 앞은 `profile_links` 테이블을 새로 만들고, 뒤는
`family_invitations` 의 인덱스 하나를 갈아 끼운다. 겹치는 객체가 없으므로 순서를
정해 주기만 하면 되고, 스키마를 더 바꿀 것은 없다. 그래서 본문이 비어 있다.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "68dfd9642bb3"
down_revision: Union[str, Sequence[str], None] = ("2861d7594df1", "c472f0c9a6d1")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
