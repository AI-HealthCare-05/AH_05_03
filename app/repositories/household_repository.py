import uuid
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.exceptions import HouseholdStateConflictError
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
        household = Household(created_by_account_id=account_id, master_account_id=account_id)
        self.session.add(household)
        await self.session.flush()
        self.session.add(HouseholdMembership(household_id=household.id, account_id=account_id))
        await self.session.flush()
        return household

    async def get(self, household_id: uuid.UUID) -> Household | None:
        return await self.session.get(Household, household_id)

    async def get_for_update(self, household_id: uuid.UUID) -> Household | None:
        return await self.session.scalar(select(Household).where(Household.id == household_id).with_for_update())

    async def has_any_active_household(self, account_id: uuid.UUID) -> bool:
        result = await self.session.scalar(
            select(HouseholdMembership.id)
            .join(Household, Household.id == HouseholdMembership.household_id)
            .where(
                HouseholdMembership.account_id == account_id,
                HouseholdMembership.status == MembershipStatus.ACTIVE,
                Household.status == HouseholdStatus.ACTIVE,
            )
            .limit(1)
        )
        return result is not None

    async def get_oldest_active_member(
        self, household_id: uuid.UUID, exclude_account_id: uuid.UUID
    ) -> HouseholdMembership | None:
        return await self.session.scalar(
            select(HouseholdMembership)
            .where(
                HouseholdMembership.household_id == household_id,
                HouseholdMembership.account_id != exclude_account_id,
                HouseholdMembership.status == MembershipStatus.ACTIVE,
            )
            .order_by(HouseholdMembership.joined_at.asc(), HouseholdMembership.id.asc())
            .limit(1)
        )

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

    async def get_membership_by_id_for_update(self, membership_id: uuid.UUID) -> HouseholdMembership | None:
        return await self.session.scalar(
            select(HouseholdMembership).where(HouseholdMembership.id == membership_id).with_for_update()
        )

    async def delete_membership(self, membership: HouseholdMembership) -> None:
        await self.session.delete(membership)

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

            # 탈퇴하는 계정이 마스터인 경우, 남아 있는 활성 구성원에게 자동 승계
            household = await self.get_for_update(membership.household_id)
            if household is not None and household.master_account_id == account_id:
                next_master = await self.get_oldest_active_member(
                    membership.household_id, exclude_account_id=account_id
                )
                if next_master is not None:
                    household.master_account_id = next_master.account_id
                    household.row_version += 1

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

    async def prepare_for_household_transfer(self, account_id: uuid.UUID, target_household_id: uuid.UUID) -> None:
        """새 가정 초대를 수락하기 전, 기존 가정 소속 상태를 검사하고 단독 가정이면 자동 종료한다.

        - 기존 소속 가정이 타겟 가정과 같으면 통과.
        - 기존 소속 가정에 다른 활성 구성원이 있으면 HouseholdStateConflictError 발생 (무단 탈퇴/폭파 방지).
        - 기존 소속 가정에 나 혼자뿐인 단독 가정이면, 기존 가정을 CLOSED로 전환하고 멤버십을 LEFT로 내린다.
        """
        active_households = await self.list_for_account(account_id)
        now = datetime.now(tz=timezone.utc)
        for household in active_households:
            if household.id == target_household_id:
                continue

            other_count = await self.count_other_active_members(household.id, account_id)
            if other_count > 0:
                raise HouseholdStateConflictError(
                    "이미 다른 가족 구성원이 있는 가정에 소속되어 있어 초대를 수락할 수 없습니다. "
                    "기존 가정에서 먼저 탈퇴하거나 관리자에게 문의하세요."
                )

            # 단독 가정인 경우 자동 종료 처리
            locked_household = await self.get_for_update(household.id)
            if locked_household is not None and locked_household.status is HouseholdStatus.ACTIVE:
                locked_household.status = HouseholdStatus.CLOSED
                locked_household.closed_at = now
                locked_household.row_version += 1

            membership = await self.get_membership_for_update(household.id, account_id)
            if membership is not None and membership.status is MembershipStatus.ACTIVE:
                membership.status = MembershipStatus.LEFT
                membership.left_at = now
                membership.row_version += 1

            await self.unlink_active_profile(household.id, account_id)
