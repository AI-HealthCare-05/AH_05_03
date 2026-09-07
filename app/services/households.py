import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import Depends

from app.core.db.session import SessionDep
from app.dtos.households import (
    HouseholdData,
    HouseholdListData,
    HouseholdMembershipData,
    HouseholdMembershipListData,
    HouseholdMembershipListItemData,
)
from app.exceptions import (
    HouseholdHasOtherMembersError,
    HouseholdMembershipRequiredError,
    HouseholdNotFoundError,
    HouseholdStateConflictError,
    MembershipStateConflictError,
)
from app.models.households import HouseholdStatus, MembershipStatus
from app.models.service_accounts import ServiceAccount
from app.repositories.household_repository import HouseholdRepository


def get_household_repository(session: SessionDep) -> HouseholdRepository:
    return HouseholdRepository(session)


class HouseholdService:
    def __init__(
        self,
        session: SessionDep,
        household_repo: Annotated[HouseholdRepository, Depends(get_household_repository)],
    ) -> None:
        self.session = session
        self.household_repo = household_repo

    async def create(self, account: ServiceAccount) -> HouseholdData:
        if await self.household_repo.has_any_active_household(account.id):
            raise HouseholdStateConflictError(
                "이미 소속된 가정이 있어 새 가정을 만들 수 없습니다. 새 가정을 만들려면 기존 가정에서 먼저 나와야 합니다."
            )
        household = await self.household_repo.create_for_account(account.id)
        await self.session.commit()
        await self.session.refresh(household)
        return HouseholdData.model_validate(household)

    async def list_for_account(self, account: ServiceAccount) -> HouseholdListData:
        households = await self.household_repo.list_for_account(account.id)
        return HouseholdListData(items=[HouseholdData.model_validate(item) for item in households])

    async def get_for_account(self, household_id: uuid.UUID, account: ServiceAccount) -> HouseholdData:
        household = await self.household_repo.get(household_id)
        if household is None or household.status is not HouseholdStatus.ACTIVE:
            raise HouseholdNotFoundError()
        if not await self.household_repo.has_active_membership(household_id, account.id):
            raise HouseholdNotFoundError()
        return HouseholdData.model_validate(household)

    async def list_members(self, household_id: uuid.UUID, account: ServiceAccount) -> HouseholdMembershipListData:
        household_data = await self.get_for_account(household_id, account)
        memberships = await self.household_repo.list_memberships(household_id)
        return HouseholdMembershipListData(
            items=[
                HouseholdMembershipListItemData(
                    id=item.membership.id,
                    household_id=item.membership.household_id,
                    account_id=item.membership.account_id,
                    masked_email=item.account_email,
                    local_profile_ref=item.local_profile_ref,
                    status=item.membership.status,
                    joined_at=item.membership.joined_at,
                    left_at=item.membership.left_at,
                    row_version=item.membership.row_version,
                    is_master=(item.membership.account_id == household_data.master_account_id),
                )
                for item in memberships
            ]
        )

    async def transfer_master(
        self, household_id: uuid.UUID, account: ServiceAccount, target_account_id: uuid.UUID
    ) -> HouseholdData:
        household = await self.household_repo.get_for_update(household_id)
        if household is None or household.status is not HouseholdStatus.ACTIVE:
            raise HouseholdNotFoundError()
        if household.master_account_id != account.id:
            raise HouseholdStateConflictError("가정의 마스터만 마스터 권한을 위임할 수 있습니다.")
        if account.id == target_account_id:
            raise HouseholdStateConflictError("이미 마스터인 계정입니다.")
        if not await self.household_repo.has_active_membership(household_id, target_account_id):
            raise HouseholdStateConflictError("해당 가정의 활동 중인 구성원에게만 마스터 권한을 위임할 수 있습니다.")

        household.master_account_id = target_account_id
        household.row_version += 1
        await self.session.commit()
        await self.session.refresh(household)
        return HouseholdData.model_validate(household)

    async def leave(self, household_id: uuid.UUID, account: ServiceAccount) -> HouseholdMembershipData:
        household = await self.household_repo.get_for_update(household_id)
        if household is None or household.status is not HouseholdStatus.ACTIVE:
            raise HouseholdNotFoundError()
        membership = await self.household_repo.get_membership_for_update(household_id, account.id)
        if membership is None:
            raise HouseholdMembershipRequiredError()
        if membership.status is not MembershipStatus.ACTIVE:
            raise MembershipStateConflictError()
        if household.master_account_id == account.id:
            if await self.household_repo.count_other_active_members(household_id, account.id) > 0:
                raise MembershipStateConflictError(
                    "가정 마스터는 다른 활성 구성원이 있는 동안 탈퇴할 수 없습니다. 먼저 다른 구성원에게 마스터를 위임하거나 가정을 종료해 주세요."
                )
        membership.status = MembershipStatus.LEFT
        membership.left_at = datetime.now(tz=timezone.utc)
        membership.row_version += 1
        await self.household_repo.unlink_active_profile(household_id, account.id)
        await self.session.commit()
        await self.session.refresh(membership)
        return HouseholdMembershipData.model_validate(membership)

    async def close(self, household_id: uuid.UUID, account: ServiceAccount) -> None:
        household = await self.household_repo.get_for_update(household_id)
        if household is None:
            raise HouseholdNotFoundError()
        if household.status is not HouseholdStatus.ACTIVE:
            raise HouseholdStateConflictError()
        # **생성자 전용에서 '활성 구성원' 으로 넓혔다.** 생성자만 닫을 수 있게 두면,
        # 생성자가 계정을 탈퇴한 순간 그 가구는 아무도 닫을 수 없다 — 생성자는
        # 로그인이 막히고(`ACCOUNT_CLOSED`) 남은 사람은 생성자가 아니기 때문이다.
        # 실제로 그렇게 영구히 잠긴 가구를 재현했다.
        #
        # 넓혀도 남의 가구를 함부로 닫지는 못한다. 바로 아래 "다른 활성 구성원이
        # 있으면 거절" 이 그대로 남아 있어서, **혼자 남은 사람만** 닫을 수 있다.
        if not await self.household_repo.has_active_membership(household_id, account.id):
            raise HouseholdMembershipRequiredError()
        if await self.household_repo.count_other_active_members(household_id, account.id):
            raise HouseholdHasOtherMembersError()

        membership = await self.household_repo.get_membership_for_update(household_id, account.id)
        if membership is not None and membership.status is MembershipStatus.ACTIVE:
            membership.status = MembershipStatus.LEFT
            membership.left_at = datetime.now(tz=timezone.utc)
            membership.row_version += 1
        await self.household_repo.unlink_active_profile(household_id, account.id)
        household.status = HouseholdStatus.CLOSED
        household.closed_at = datetime.now(tz=timezone.utc)
        household.row_version += 1
        await self.session.commit()

    async def delete_member_history(
        self, household_id: uuid.UUID, membership_id: uuid.UUID, account: ServiceAccount
    ) -> None:
        household = await self.household_repo.get(household_id)
        if household is None or household.status is not HouseholdStatus.ACTIVE:
            raise HouseholdNotFoundError()
        if not await self.household_repo.has_active_membership(household_id, account.id):
            raise HouseholdMembershipRequiredError()

        membership = await self.household_repo.get_membership_by_id_for_update(membership_id)
        if membership is None or membership.household_id != household_id:
            raise HouseholdMembershipRequiredError("해당 구성원 이력을 찾을 수 없습니다.")

        if membership.status is not MembershipStatus.LEFT:
            raise MembershipStateConflictError(
                "활동 중인 구성원은 삭제할 수 없습니다. 탈퇴한 이력만 삭제할 수 있습니다."
            )

        is_master = household.master_account_id == account.id
        is_owner = membership.account_id == account.id
        if not (is_master or is_owner):
            raise HouseholdStateConflictError("가정 마스터 또는 본인만 이력을 삭제할 수 있습니다.")

        await self.household_repo.delete_membership(membership)
        await self.session.commit()


def _mask_email(email: str) -> str:
    local, separator, domain = email.rpartition("@")
    if not separator:
        return "***"
    visible_length = 1 if len(local) < 3 else 3
    visible = local[:visible_length]
    hidden = "*" * max(3, min(8, len(local) - visible_length))
    return f"{visible}{hidden}@{domain}"
