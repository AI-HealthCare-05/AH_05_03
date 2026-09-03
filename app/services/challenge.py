"""챌린지 서비스 — 체크를 받고 정원 상태를 낸다.

두 가지를 지킨다.

1. **점수 식에 건강 수치가 없다.** 무엇을 했는지와 언제인지만으로 계산한다. 그래서 가족
   랭킹이 건강 랭킹으로 변할 수 없다. 당뇨 `HIGH` 인 사람이 성실하면 나무가 가장 크다.
2. **누적값을 저장하지 않는다.** 점수·나무 단계·영양 단계는 매 요청마다 체크 이력에서
   다시 계산한다. 규칙을 고치면 과거도 같이 새 규칙으로 다시 계산된다.

예외는 동물 하나다. 동물은 최고 기록으로 주므로 규칙을 고치면 이미 받은 것이 사라질 수
있어 `challenge_awards` 에 남긴다. 받은 것은 빼앗지 않는다.
"""

import uuid
from datetime import date, timedelta
from typing import Annotated

from fastapi import Depends

from app.core.db.session import SessionDep
from app.dtos.challenges import (
    AnimalData,
    ChallengeCheckResultData,
    ChallengeSettingsData,
    ChallengeSettingsRequest,
    ChallengeTodayData,
    DailyItemData,
    GardenData,
    HouseholdGardenData,
    HouseholdGardenItemData,
    HouseholdGoalData,
    MeasureItemData,
    NutritionData,
    TreeStageData,
    WeekDayData,
    WeekProgressData,
)
from app.exceptions import ChallengeNotFoundError, HouseholdNotFoundError
from app.models.challenge_settings import ChallengeMode, ChallengeSettings
from app.models.households import HouseholdStatus
from app.models.service_accounts import ServiceAccount
from app.repositories.challenge_repository import ChallengeRepository
from app.repositories.household_repository import HouseholdRepository
from app.services.challenge_catalog import (
    ANIMAL_BY_ID,
    ANIMALS,
    DAILY_BY_ID,
    DAILY_CHALLENGES,
    MEASURE_BY_ID,
    MEASURE_CHALLENGES,
    TREE_STAGES,
    WATER_REQUIREMENT,
    WEEK_MEASURE_REQUIREMENT,
    WEEK_WATER_GOALS,
    WEEK_WATER_REQUIREMENT,
    CheckRecord,
    GardenState,
    WeekSummary,
    build_garden,
    earned_animals,
    season_bounds,
    season_index,
    today_in_service_tz,
    week_start,
)
from app.services.households import _mask_email


def get_challenge_repository(session: SessionDep) -> ChallengeRepository:
    return ChallengeRepository(session)


def get_household_repository_for_challenge(session: SessionDep) -> HouseholdRepository:
    return HouseholdRepository(session)


class ChallengeService:
    def __init__(
        self,
        session: SessionDep,
        challenge_repo: Annotated[ChallengeRepository, Depends(get_challenge_repository)],
        household_repo: Annotated[HouseholdRepository, Depends(get_household_repository_for_challenge)],
    ) -> None:
        self.session = session
        self.challenge_repo = challenge_repo
        self.household_repo = household_repo

    # -- 조회 -----------------------------------------------------------

    async def today(self, account: ServiceAccount) -> ChallengeTodayData:
        today = today_in_service_tz()
        state, awards = await self._load(account.id, today)
        return self._today_payload(today, state, awards)

    async def garden(self, account: ServiceAccount) -> GardenData:
        today = today_in_service_tz()
        state, awards = await self._load(account.id, today)
        return self._garden_payload(today, state, awards)

    async def settings(self, account: ServiceAccount) -> ChallengeSettingsData:
        found = await self.challenge_repo.get_settings(account.id)
        return self._settings_payload(found)

    async def save_settings(
        self, account: ServiceAccount, payload: ChallengeSettingsRequest
    ) -> ChallengeSettingsData:
        if payload.weekly_water_goal not in WEEK_WATER_GOALS:
            raise ChallengeNotFoundError("주간 목표는 3·5·7일 중에서 고를 수 있습니다.")
        saved = await self.challenge_repo.upsert_settings(
            account.id, payload.mode, payload.weekly_water_goal, payload.measure_weekday
        )
        await self.session.commit()
        return self._settings_payload(saved)

    @staticmethod
    def _settings_payload(found: ChallengeSettings | None) -> ChallengeSettingsData:
        # 저장된 적이 없으면 기본값을 내되 `configured=False` 로 알린다 — 화면이
        # 셋업을 띄울지 본 화면으로 갈지 이 한 칸으로 정한다.
        return ChallengeSettingsData(
            mode=found.mode if found else ChallengeMode.PERSONAL,
            weekly_water_goal=found.weekly_water_goal if found else WEEK_WATER_REQUIREMENT,
            measure_weekday=found.measure_weekday if found else 6,
            configured=found is not None,
        )

    # -- 체크 -----------------------------------------------------------

    async def check(self, account: ServiceAccount, challenge_id: str) -> ChallengeCheckResultData:
        """오늘 자로만 기록한다. 지난 날짜를 열어 주면 게임이 아니라 서류가 된다."""
        if challenge_id not in DAILY_BY_ID and challenge_id not in MEASURE_BY_ID:
            raise ChallengeNotFoundError()

        today = today_in_service_tz()
        inserted = await self.challenge_repo.add_check(account.id, challenge_id, today)
        await self.session.flush()

        state, awards = await self._load(account.id, today)
        newly = await self._grant_new_animals(account.id, state, today, awards)
        await self.session.commit()

        # 물주기가 **방금** 채워졌는가. 첫 판에서는 체크 전 상태를 한 번 더 읽어
        # 비교했는데, 이력 전량 조회가 두 번이 된다. 4/4 에 닿는 유일한 방법이
        # 매일 항목을 새로 넣는 것이므로 삽입 여부만 알면 같은 답이 나온다.
        watered_now = inserted and challenge_id in DAILY_BY_ID and state.watered_today

        # 방금 준 것을 다시 조회하지 않는다. 무엇을 줬는지 이미 알고 있다.
        awards = {**awards, **{animal_id: today for animal_id in newly}}
        return ChallengeCheckResultData(
            challenge_id=challenge_id,
            checked_on=today,
            checked=True,
            watered_now=watered_now,
            new_animals=[self._animal_payload(animal_id, awards) for animal_id in newly],
            garden=self._garden_payload(today, state, awards),
        )

    async def uncheck(self, account: ServiceAccount, challenge_id: str) -> ChallengeCheckResultData:
        """실수로 누른 것을 되돌린다. 동물은 회수하지 않는다."""
        if challenge_id not in DAILY_BY_ID and challenge_id not in MEASURE_BY_ID:
            raise ChallengeNotFoundError()

        today = today_in_service_tz()
        await self.challenge_repo.remove_check(account.id, challenge_id, today)
        await self.session.commit()

        state, awards = await self._load(account.id, today)
        return ChallengeCheckResultData(
            challenge_id=challenge_id,
            checked_on=today,
            checked=False,
            watered_now=False,
            new_animals=[],
            garden=self._garden_payload(today, state, awards),
        )

    # -- 가정 -----------------------------------------------------------

    async def household_garden(self, household_id: uuid.UUID, account: ServiceAccount) -> HouseholdGardenData:
        household = await self.household_repo.get(household_id)
        if household is None or household.status is not HouseholdStatus.ACTIVE:
            raise HouseholdNotFoundError()
        if not await self.household_repo.has_active_membership(household_id, account.id):
            raise HouseholdNotFoundError()

        today = today_in_service_tz()
        members = await self.challenge_repo.list_household_members(household_id)
        account_ids = [member.account_id for member in members]
        checks = await self.challenge_repo.list_checks_for_accounts(account_ids)
        award_counts = await self.challenge_repo.count_awards_for_accounts(account_ids)
        member_settings = await self.challenge_repo.settings_for_accounts(account_ids)

        states: dict[uuid.UUID, GardenState] = {
            member.account_id: build_garden(
                [CheckRecord(c.challenge_id, c.checked_on) for c in checks.get(member.account_id, [])],
                today,
                water_goal=(
                    member_settings[member.account_id].weekly_water_goal
                    if member.account_id in member_settings
                    else WEEK_WATER_REQUIREMENT
                ),
            )
            for member in members
        }

        rows: list[HouseholdGardenItemData] = []
        for member in members:
            state = states[member.account_id]
            week = state.this_week
            rows.append(
                HouseholdGardenItemData(
                    account_id=member.account_id,
                    masked_email=_mask_email(member.email),
                    local_profile_ref=member.local_profile_ref,
                    is_me=member.account_id == account.id,
                    rank=0,
                    season_points=state.season_points,
                    total_points=state.total_points,
                    tree_key=state.tree_stage.key,
                    tree_label=state.tree_stage.label,
                    animal_count=award_counts.get(member.account_id, 0),
                    week_completed=bool(week and week.completed),
                )
            )

        # 시즌 점수로 순위를 매긴다. 나무 크기(누적)로 매기면 늦게 시작한 사람이
        # 영원히 못 올라온다.
        rows.sort(key=lambda row: (-row.season_points, row.masked_email))
        for index, row in enumerate(rows, start=1):
            row.rank = index

        completed = sum(1 for row in rows if row.week_completed)
        # 집 공동 목표 = 구성원 각자 목표의 합. 저장하지 않고 매번 더한다 — 사람이
        # 들어오고 나가면 목표도 같이 움직여야 한다.
        goal_days = sum(states[member.account_id].water_goal for member in members)
        done_days = 0
        for member in members:
            week = states[member.account_id].this_week
            done_days += week.water_days if week else 0
        index = season_index(today)
        start, end = season_bounds(index)
        return HouseholdGardenData(
            household_id=household_id,
            season_index=index,
            season_start=start,
            season_end=end,
            week_start=week_start(today),
            members_completed=completed,
            members_total=len(rows),
            all_completed=bool(rows) and completed == len(rows),
            goal=HouseholdGoalData(goal_days=goal_days, done_days=done_days, reached=done_days >= goal_days),
            items=rows,
        )

    # -- 내부 -----------------------------------------------------------

    async def _load(self, account_id: uuid.UUID, today: date) -> tuple[GardenState, dict[str, date]]:
        """체크 이력과 수여 이력을 함께 읽는다.

        수여 이력을 ORM 객체가 아니라 `animal_id -> 받은 날` 맵으로 좁혀서 넘긴다.
        체크 경로에서 방금 준 동물을 이 맵에 얹어야 하는데, 세션에 붙지 않은
        `ChallengeAward` 인스턴스를 만들어 섞으면 나중에 커밋 위치가 바뀔 때
        autoflush 가 그것을 저장 대상으로 볼 수 있다. 맵이면 그런 여지가 없다.
        """
        checks = await self.challenge_repo.list_checks(account_id)
        awards = await self.challenge_repo.list_awards(account_id)
        settings = await self.challenge_repo.get_settings(account_id)
        state = build_garden(
            [CheckRecord(c.challenge_id, c.checked_on) for c in checks],
            today,
            water_goal=settings.weekly_water_goal if settings else WEEK_WATER_REQUIREMENT,
        )
        return state, {award.animal_id: award.awarded_on for award in awards}

    async def _family_week_completed(self, account_id: uuid.UUID, today: date) -> bool:
        """온 가족이 이번 주를 완주했는가. 고양이 조건이다.

        가정이 없거나 혼자면 False — 1인 사용자에게 "온 가족" 이 자동 달성되면
        조건의 뜻이 사라진다.
        """
        households = await self.household_repo.list_for_account(account_id)
        for household in households:
            members = await self.challenge_repo.list_household_members(household.id)
            if len(members) < 2:
                continue
            checks = await self.challenge_repo.list_checks_for_accounts([m.account_id for m in members])
            done = True
            for member in members:
                state = build_garden(
                    [CheckRecord(c.challenge_id, c.checked_on) for c in checks.get(member.account_id, [])],
                    today,
                )
                if not (state.this_week and state.this_week.completed):
                    done = False
                    break
            if done:
                return True
        return False

    async def _grant_new_animals(
        self, account_id: uuid.UUID, state: GardenState, today: date, awards: dict[str, date]
    ) -> list[str]:
        already = set(awards)

        # 고양이 조건만 가정 전체를 훑는다(구성원 수만큼 쿼리가 는다). 두 경우에는
        # 답이 이미 정해져 있으므로 훑지 않는다 — 이미 받았거나, **내 주가 아직
        # 안 닫혔거나.** "온 가족" 에는 나도 들어가니 내가 미완주면 무조건 거짓이다.
        # 주중 대부분의 체크가 이 두 번째 갈래로 빠진다.
        my_week_done = bool(state.this_week and state.this_week.completed)
        family = (
            False
            if "cat" in already or not my_week_done
            else await self._family_week_completed(account_id, today)
        )

        deserved = earned_animals(state, family_week_completed=family)
        newly = [animal.id for animal in ANIMALS if animal.id in deserved and animal.id not in already]
        await self.challenge_repo.grant_awards(account_id, newly, today)
        return newly

    def _animal_payload(self, animal_id: str, awards: dict[str, date]) -> AnimalData:
        animal = ANIMAL_BY_ID[animal_id]
        earned_on = awards.get(animal_id)
        return AnimalData(
            id=animal.id, name=animal.name, hint=animal.hint, earned=earned_on is not None, earned_on=earned_on
        )

    def _garden_payload(self, today: date, state: GardenState, awards: dict[str, date]) -> GardenData:
        index = season_index(today)
        start, end = season_bounds(index)
        stage_index = TREE_STAGES.index(state.tree_stage)
        week = state.this_week
        monday = week_start(today)
        return GardenData(
            total_points=state.total_points,
            season_points=state.season_points,
            season_index=index,
            season_start=start,
            season_end=end,
            tree=TreeStageData(
                key=state.tree_stage.key,
                label=state.tree_stage.label,
                index=stage_index,
                total=len(TREE_STAGES),
                points_to_next=state.points_to_next,
                next_label=state.next_stage.label if state.next_stage else None,
            ),
            nutrition=NutritionData(
                level=state.nutrition.level,
                key=state.nutrition.key,
                label=state.nutrition.label,
                multiplier=state.nutrition.multiplier,
                current_streak=state.current_streak,
                max_streak=state.max_streak,
            ),
            animals=[self._animal_payload(animal.id, awards) for animal in ANIMALS],
            week=WeekProgressData(
                start=monday,
                water_days=week.water_days if week else 0,
                water_required=state.water_goal,
                measure_count=week.measure_count if week else 0,
                measure_required=WEEK_MEASURE_REQUIREMENT,
                completed=bool(week and week.completed),
                days_left=(monday + timedelta(days=6) - today).days,
                days=self._week_days(monday, week, today),
            ),
            watered_today=state.watered_today,
            measure_count=state.measure_count,
        )

    @staticmethod
    def _week_days(monday: date, week: WeekSummary | None, today: date) -> list[WeekDayData]:
        """월~일 일곱 칸. 기록이 아직 없는 주에도 칸은 만들어야 달력이 성립한다."""
        by_day = {summary.day: summary for summary in (week.days if week else ())}
        result: list[WeekDayData] = []
        for offset in range(7):
            day = monday + timedelta(days=offset)
            summary = by_day.get(day)
            result.append(
                WeekDayData(
                    date=day,
                    weekday=offset,
                    checked_count=summary.checked if summary else 0,
                    total_count=WATER_REQUIREMENT,
                    watered=bool(summary and summary.watered),
                    measured=bool(summary and summary.measured),
                    is_today=day == today,
                    # 아직 오지 않은 날은 "못 한 날" 이 아니다. 화면이 둘을 갈라 칠해야 한다.
                    is_future=day > today,
                )
            )
        return result

    def _today_payload(self, today: date, state: GardenState, awards: dict[str, date]) -> ChallengeTodayData:
        checked = set(state.checked_today)
        measured = set(state.measured_this_week)
        return ChallengeTodayData(
            today=today,
            daily=[
                DailyItemData(
                    id=item.id, title=item.title, detail=item.detail, points=item.points, checked=item.id in checked
                )
                for item in DAILY_CHALLENGES
            ],
            measures=[
                MeasureItemData(
                    id=item.id,
                    title=item.title,
                    detail=item.detail,
                    points=item.points,
                    opens=list(item.opens),
                    checked_this_week=item.id in measured,
                )
                for item in MEASURE_CHALLENGES
            ],
            water_requirement=WATER_REQUIREMENT,
            checked_count=len(checked),
            watered_today=state.watered_today,
            garden=self._garden_payload(today, state, awards),
        )
