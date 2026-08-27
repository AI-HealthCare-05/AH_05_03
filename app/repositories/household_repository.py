import uuid
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.households import (
    Household,
    HouseholdMembership,
    HouseholdStatus,
    MembershipStatus,
    ProfileLink,
    ProfileLinkStatus,
)
from app.models.service_accounts import ServiceAccount


@dataclass(frozen=True)
class HouseholdMembershipView:
    membership: HouseholdMembership
    account_email: str
    local_profile_ref: str | None


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

    async def list_memberships(self, household_id: uuid.UUID) -> list[HouseholdMembershipView]:
        result = await self.session.execute(
            select(HouseholdMembership, ServiceAccount.email, ProfileLink.local_profile_ref)
            .join(ServiceAccount, ServiceAccount.id == HouseholdMembership.account_id)
            .outerjoin(
                ProfileLink,
                and_(
                    ProfileLink.household_id == HouseholdMembership.household_id,
                    ProfileLink.account_id == HouseholdMembership.account_id,
                    ProfileLink.status == ProfileLinkStatus.ACTIVE,
                ),
            )
            .where(HouseholdMembership.household_id == household_id)
            .order_by(HouseholdMembership.joined_at, HouseholdMembership.id)
        )
        return [
            HouseholdMembershipView(
                membership=membership,
                account_email=account_email,
                local_profile_ref=local_profile_ref,
            )
            for membership, account_email, local_profile_ref in result.all()
        ]

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

    async def release_all_memberships(self, account_id: uuid.UUID) -> list[uuid.UUID]:
        """이 계정의 활성 멤버십을 전부 LEFT 로 내리고 프로필 연결도 끊는다.

        계정 탈퇴 경로가 부른다. **이게 없어서 가구가 영구히 잠겼다** — 닫힌 계정의
        멤버십이 `active` 로 남아 `count_other_active_members` 에 계속 잡히고,
        그 계정은 로그인이 안 되니 스스로 정리할 수도 없었다.

        건드린 가구 id 를 돌려준다 — 호출부가 뒤처리(빈 가구 폐쇄)를 할 수 있게.
        """
        memberships = (
            await self.session.scalars(
                select(HouseholdMembership)
                .where(
                    HouseholdMembership.account_id == account_id,
                    HouseholdMembership.status == MembershipStatus.ACTIVE,
                )
                .with_for_update()
            )
        ).all()

        now = datetime.now(tz=timezone.utc)
        touched = []
        for membership in memberships:
            membership.status = MembershipStatus.LEFT
            membership.left_at = now
            membership.row_version += 1
            await self.unlink_active_profile(membership.household_id, account_id)
            touched.append(membership.household_id)
        return touched

    async def close_if_empty(self, household_ids: list[uuid.UUID]) -> list[uuid.UUID]:
        """활성 구성원이 아무도 없는 가구를 닫는다.

        마지막 사람이 계정을 탈퇴하면 빈 가구만 남는다. 그 상태로 두면 아무도
        접근할 수 없는데 `status=active` 라서 정리 대상으로도 안 잡힌다.
        """
        closed = []
        for household_id in household_ids:
            remaining = await self.session.scalar(
                select(func.count(HouseholdMembership.id)).where(
                    HouseholdMembership.household_id == household_id,
                    HouseholdMembership.status == MembershipStatus.ACTIVE,
                )
            )
            if remaining:
                continue
            household = await self.get_for_update(household_id)
            if household is not None and household.status is HouseholdStatus.ACTIVE:
                household.status = HouseholdStatus.CLOSED
                household.closed_at = datetime.now(tz=timezone.utc)
                household.row_version += 1
                closed.append(household_id)
        return closed

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
