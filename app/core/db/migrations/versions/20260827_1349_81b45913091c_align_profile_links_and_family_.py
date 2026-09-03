"""align profile_links and family_invitation indexes with models

Revision ID: 81b45913091c
Revises: c3d5e7f91a24
Create Date: 2026-08-27 13:49:11.373752+09:00

**이 리비전은 아무것도 하지 않는다.** 자동 생성 당시의 비교 대상이 이 브랜치의
계보가 아니었던 탓에, 여기 담겼던 조작이 전부 앞선 리비전이 이미 해 둔 것과
겹쳤다. 그대로 두면 없는 인덱스를 떨구다 `alembic upgrade head` 가 죽는다.

    index "uq_family_invitations_pending_target" does not exist
    index "ix_profile_links_account_status" does not exist

겹친 내역은 이렇다.

    family_invitations 인덱스 교체(pending_target -> profile_ref_lifetime)
        -> c472f0c9a6d1 이 이미 했다.
    profile_links 의 ix_account_id · uq_active_household_account ·
    uq_household_profile_ref · ck_profile_link_ref_format · status 길이 20
        -> 91c8e40c547a 가 테이블을 만들 때 이미 그 모양으로 만든다.

떨구려던 `ix_profile_links_account_status` ·
`uq_profile_links_one_active_account_per_profile` ·
`uq_profile_links_one_active_profile_per_account_household` ·
`ck_profile_links_local_profile_ref_format` 은 이 계보에 존재한 적이 없다. 전부
`2861d7594df1`(다른 갈래의 profile_links)이 만들던 이름이고, 이 갈래는
`91c8e40c547a` 를 쓴다.

리비전 자체는 남긴다. 이미 이 id 를 stamp 한 DB 가 있을 수 있어서, 지우면 그쪽이
"모르는 리비전" 으로 멈춘다. 모델과 스키마가 맞는지는 CI 의 `alembic check` 가
계속 지킨다.
"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "81b45913091c"
down_revision: Union[str, Sequence[str], None] = "c3d5e7f91a24"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
