import uuid
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.households import (
    Household,
    HouseholdMembership,
    HouseholdStatus,
    MembershipStatus,
    ProfileLink,
    ProfileLinkStatus,
)


class HouseholdRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create_for_account(self, account_id: uuid.UUID) -> Household:
        household = Household(created_by_account_id=account_id)
        self.session.add(household)
        await self.session.flush()
        self.session.add(HouseholdMembership(household_id=household.id, account_id=account_id))
        await self.session.flush()
        return household

    async def get(self, household_id: uuid.UUID) -> Household | None:
        return await self.session.get(Household, household_id)

    async def get_for_update(self, household_id: uuid.UUID) -> Household | None:
        return await self.session.scalar(select(Household).where(Household.id == household_id).with_for_update())

    async def list_for_account(self, account_id: uuid.UUID) -> list[Household]:
        result = await self.session.scalars(
            select(Household)
            .join(HouseholdMembership, HouseholdMembership.household_id == Household.id)
            .where(
                HouseholdMembership.account_id == account_id,
                HouseholdMembership.status == MembershipStatus.ACTIVE,
                Household.status == HouseholdStatus.ACTIVE,
            )
            .order_by(Household.created_at)
        )
        return list(result)

    async def has_active_membership(self, household_id: uuid.UUID, account_id: uuid.UUID) -> bool:
        membership_id = await self.session.scalar(
            select(HouseholdMembership.id).where(
                HouseholdMembership.household_id == household_id,
                HouseholdMembership.account_id == account_id,
                HouseholdMembership.status == MembershipStatus.ACTIVE,
            )
        )
        return membership_id is not None

    async def list_memberships(self, household_id: uuid.UUID) -> list[HouseholdMembership]:
        result = await self.session.scalars(
            select(HouseholdMembership)
            .where(HouseholdMembership.household_id == household_id)
            .order_by(HouseholdMembership.joined_at, HouseholdMembership.id)
        )
        return list(result)

    async def get_membership_for_update(
        self, household_id: uuid.UUID, account_id: uuid.UUID
    ) -> HouseholdMembership | None:
        return await self.session.scalar(
            select(HouseholdMembership)
            .where(
                HouseholdMembership.household_id == household_id,
                HouseholdMembership.account_id == account_id,
            )
            .with_for_update()
        )

    async def count_other_active_members(self, household_id: uuid.UUID, account_id: uuid.UUID) -> int:
        return int(
            await self.session.scalar(
                select(func.count(HouseholdMembership.id)).where(
                    HouseholdMembership.household_id == household_id,
                    HouseholdMembership.account_id != account_id,
                    HouseholdMembership.status == MembershipStatus.ACTIVE,
                )
            )
            or 0
        )

    async def unlink_active_profile(self, household_id: uuid.UUID, account_id: uuid.UUID) -> None:
        link = await self.session.scalar(
            select(ProfileLink)
            .where(
                ProfileLink.household_id == household_id,
                ProfileLink.account_id == account_id,
                ProfileLink.status == ProfileLinkStatus.ACTIVE,
            )
            .with_for_update()
        )
        if link is not None:
            link.status = ProfileLinkStatus.UNLINKED
            link.unlinked_at = datetime.now(tz=timezone.utc)
            link.row_version += 1

    async def ensure_active_membership(self, household_id: uuid.UUID, account_id: uuid.UUID) -> HouseholdMembership:
        membership = await self.session.scalar(
            select(HouseholdMembership)
            .where(
                HouseholdMembership.household_id == household_id,
                HouseholdMembership.account_id == account_id,
            )
            .with_for_update()
        )
        if membership is None:
            membership = HouseholdMembership(household_id=household_id, account_id=account_id)
            self.session.add(membership)
        elif membership.status is MembershipStatus.LEFT:
            membership.status = MembershipStatus.ACTIVE
            membership.left_at = None
            membership.joined_at = datetime.now(tz=timezone.utc)
            membership.row_version += 1
        await self.session.flush()
        return membership
