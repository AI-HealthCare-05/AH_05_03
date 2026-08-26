import uuid
from dataclasses import dataclass
from datetime import date
from typing import Any, cast

from sqlalchemy import CursorResult, delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.challenge_settings import ChallengeMode, ChallengeSettings
from app.models.challenges import ChallengeAward, ChallengeCheck
from app.models.households import HouseholdMembership, MembershipStatus, ProfileLink, ProfileLinkStatus
from app.models.service_accounts import ServiceAccount


@dataclass(frozen=True)
class HouseholdMemberRef:
    account_id: uuid.UUID
    email: str
    local_profile_ref: str | None


class ChallengeRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def add_check(self, account_id: uuid.UUID, challenge_id: str, checked_on: date) -> bool:
        """멱등하게 넣는다. 이미 있으면 False.

        두 번 눌러도 오류가 아니라 그대로여야 한다 — 체크박스를 연타하는 것은 사용자의
        실수가 아니라 네트워크가 느린 것이다.
        """
        statement = (
            pg_insert(ChallengeCheck)
            .values(account_id=account_id, challenge_id=challenge_id, checked_on=checked_on)
            .on_conflict_do_nothing(constraint="uq_challenge_checks_account_id_challenge_id_checked_on")
            .returning(ChallengeCheck.id)
        )
        return await self.session.scalar(statement) is not None

    async def remove_check(self, account_id: uuid.UUID, challenge_id: str, checked_on: date) -> bool:
        # DELETE 는 언제나 CursorResult 를 내지만 `execute()` 의 선언 타입은 Result 라
        # `rowcount` 가 안 보인다. 실행 시점 동작이 아니라 타입 폭이 문제다.
        result = cast(
            CursorResult[Any],
            await self.session.execute(
                delete(ChallengeCheck).where(
                    ChallengeCheck.account_id == account_id,
                    ChallengeCheck.challenge_id == challenge_id,
                    ChallengeCheck.checked_on == checked_on,
                )
            ),
        )
        return bool(result.rowcount)

    async def list_checks(self, account_id: uuid.UUID) -> list[ChallengeCheck]:
        result = await self.session.scalars(
            select(ChallengeCheck)
            .where(ChallengeCheck.account_id == account_id)
            .order_by(ChallengeCheck.checked_on)
        )
        return list(result)

    async def list_awards(self, account_id: uuid.UUID) -> list[ChallengeAward]:
        result = await self.session.scalars(
            select(ChallengeAward).where(ChallengeAward.account_id == account_id).order_by(ChallengeAward.awarded_on)
        )
        return list(result)

    async def grant_awards(self, account_id: uuid.UUID, animal_ids: list[str], awarded_on: date) -> None:
        if not animal_ids:
            return
        await self.session.execute(
            pg_insert(ChallengeAward)
            .values([{"account_id": account_id, "animal_id": animal_id, "awarded_on": awarded_on} for animal_id in animal_ids])
            .on_conflict_do_nothing(constraint="uq_challenge_awards_account_id_animal_id")
        )

    async def list_household_members(self, household_id: uuid.UUID) -> list[HouseholdMemberRef]:
        rows = await self.session.execute(
            select(HouseholdMembership.account_id, ServiceAccount.email, ProfileLink.local_profile_ref)
            .join(ServiceAccount, ServiceAccount.id == HouseholdMembership.account_id)
            .outerjoin(
                ProfileLink,
                (ProfileLink.household_id == HouseholdMembership.household_id)
                & (ProfileLink.account_id == HouseholdMembership.account_id)
                & (ProfileLink.status == ProfileLinkStatus.ACTIVE),
            )
            .where(
                HouseholdMembership.household_id == household_id,
                HouseholdMembership.status == MembershipStatus.ACTIVE,
            )
            .order_by(HouseholdMembership.joined_at)
        )
        return [HouseholdMemberRef(account_id=row[0], email=row[1], local_profile_ref=row[2]) for row in rows]

    async def list_checks_for_accounts(self, account_ids: list[uuid.UUID]) -> dict[uuid.UUID, list[ChallengeCheck]]:
        if not account_ids:
            return {}
        result = await self.session.scalars(
            select(ChallengeCheck)
            .where(ChallengeCheck.account_id.in_(account_ids))
            .order_by(ChallengeCheck.checked_on)
        )
        grouped: dict[uuid.UUID, list[ChallengeCheck]] = {account_id: [] for account_id in account_ids}
        for check in result:
            grouped[check.account_id].append(check)
        return grouped

    async def count_awards_for_accounts(self, account_ids: list[uuid.UUID]) -> dict[uuid.UUID, int]:
        if not account_ids:
            return {}
        result = await self.session.scalars(
            select(ChallengeAward).where(ChallengeAward.account_id.in_(account_ids))
        )
        counts: dict[uuid.UUID, int] = {account_id: 0 for account_id in account_ids}
        for award in result:
            counts[award.account_id] += 1
        return counts

    # -- 설정 -----------------------------------------------------------

    async def get_settings(self, account_id: uuid.UUID) -> ChallengeSettings | None:
        return await self.session.get(ChallengeSettings, account_id)

    async def upsert_settings(
        self, account_id: uuid.UUID, mode: ChallengeMode, weekly_water_goal: int, measure_weekday: int
    ) -> ChallengeSettings:
        statement = (
            pg_insert(ChallengeSettings)
            .values(
                account_id=account_id,
                mode=mode,
                weekly_water_goal=weekly_water_goal,
                measure_weekday=measure_weekday,
            )
            .on_conflict_do_update(
                index_elements=[ChallengeSettings.account_id],
                set_={
                    "mode": mode,
                    "weekly_water_goal": weekly_water_goal,
                    "measure_weekday": measure_weekday,
                },
            )
            .returning(ChallengeSettings)
        )
        result = await self.session.scalar(statement)
        assert result is not None
        return result

    async def settings_for_accounts(self, account_ids: list[uuid.UUID]) -> dict[uuid.UUID, ChallengeSettings]:
        if not account_ids:
            return {}
        rows = await self.session.scalars(
            select(ChallengeSettings).where(ChallengeSettings.account_id.in_(account_ids))
        )
        return {row.account_id: row for row in rows}
