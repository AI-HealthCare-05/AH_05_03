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
        await self.get_for_account(household_id, account)
        memberships = await self.household_repo.list_memberships(household_id)
        return HouseholdMembershipListData(
            items=[
                HouseholdMembershipListItemData(
                    id=item.membership.id,
                    household_id=item.membership.household_id,
                    account_id=item.membership.account_id,
                    masked_email=_mask_email(item.account_email),
                    local_profile_ref=item.local_profile_ref,
                    status=item.membership.status,
                    joined_at=item.membership.joined_at,
                    left_at=item.membership.left_at,
                    row_version=item.membership.row_version,
                )
                for item in memberships
            ]
        )

    async def leave(self, household_id: uuid.UUID, account: ServiceAccount) -> HouseholdMembershipData:
        household = await self.household_repo.get_for_update(household_id)
        if household is None or household.status is not HouseholdStatus.ACTIVE:
            raise HouseholdNotFoundError()
        membership = await self.household_repo.get_membership_for_update(household_id, account.id)
        if membership is None:
            raise HouseholdMembershipRequiredError()
        if membership.status is not MembershipStatus.ACTIVE:
            raise MembershipStateConflictError()
        if household.created_by_account_id == account.id:
            raise MembershipStateConflictError(
                "가정 생성자는 다른 활성 구성원이 있는 동안 탈퇴할 수 없습니다. 먼저 가정을 폐쇄하거나 후속 소유권 정책을 확정해 주세요."
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
        if household.created_by_account_id != account.id:
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


def _mask_email(email: str) -> str:
    local, separator, domain = email.rpartition("@")
    if not separator:
        return "***"
    visible_length = 1 if len(local) < 3 else 3
    visible = local[:visible_length]
    hidden = "*" * max(3, min(8, len(local) - visible_length))
    return f"{visible}{hidden}@{domain}"
