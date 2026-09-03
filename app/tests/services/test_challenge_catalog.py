"""정원 규칙 계약. DB 없이 순수 함수만 검사한다.

여기 걸린 못은 넷이다. 넷 다 화면 문구가 아니라 **식**으로 지켜야 하는 것들이라
구현이 바뀌어도 이 검사가 남아 있어야 한다.

1. 점수에 건강 수치가 들어가지 않는다
2. 나무는 절대 줄어들지 않는다
3. 결석은 결석으로 세어진다
4. 측정 없이 주가 완주되지 않는다
"""

from datetime import date, timedelta

from app.services.challenge_catalog import (
    DAILY_CHALLENGES,
    MEASURE_CHALLENGES,
    SEASON_EPOCH,
    SEASON_LENGTH_DAYS,
    TREE_STAGES,
    WATER_REQUIREMENT,
    CheckRecord,
    build_garden,
    earned_animals,
    season_bounds,
    season_index,
    week_start,
)

DAILY_IDS = [item.id for item in DAILY_CHALLENGES]
MONDAY = date(2026, 8, 3)


def _perfect_weeks(count: int, *, days: int = 6, measure: str | None = "weight", offset: int = 0) -> list[CheckRecord]:
    records: list[CheckRecord] = []
    for index in range(count):
        monday = MONDAY + timedelta(days=7 * (index + offset))
        for day in range(days):
            records.extend(CheckRecord(cid, monday + timedelta(days=day)) for cid in DAILY_IDS)
        if measure:
            records.append(CheckRecord(measure, monday + timedelta(days=6)))
    return records


def _sunday_of(week_count: int, *, offset: int = 0) -> date:
    return MONDAY + timedelta(days=7 * (week_count + offset) - 1)


class TestWatering:
    def test_partial_day_does_not_water(self) -> None:
        records = [CheckRecord(cid, MONDAY) for cid in DAILY_IDS[:-1]]
        state = build_garden(records, MONDAY)

        assert state.watered_today is False
        assert state.total_points == len(DAILY_IDS) - 1

    def test_full_day_waters(self) -> None:
        records = [CheckRecord(cid, MONDAY) for cid in DAILY_IDS]
        state = build_garden(records, MONDAY)

        assert state.watered_today is True
        assert len(state.checked_today) == WATER_REQUIREMENT

    def test_empty_history_is_a_seed_not_an_error(self) -> None:
        state = build_garden([], MONDAY)

        assert state.total_points == 0
        assert state.tree_stage is TREE_STAGES[0]
        assert state.nutrition.level == 0


class TestWeekCompletion:
    def test_measurement_is_required(self) -> None:
        """매일 전부 체크해도 한 번도 안 재면 주가 닫히지 않는다.

        측정이 게임 루프의 관문이라는 것이 이 제품의 목적과 직결된다 — 물만 주고
        자기 수치를 한 번도 안 보는 사용자가 생기면 안 된다.
        """
        state = build_garden(_perfect_weeks(3, days=7, measure=None), _sunday_of(3))

        assert state.this_week is not None
        assert state.this_week.completed is False
        assert state.current_streak == 0
        assert state.nutrition.level == 0

    def test_five_days_and_one_measurement_completes(self) -> None:
        state = build_garden(_perfect_weeks(1, days=5), _sunday_of(1))

        assert state.this_week is not None
        assert state.this_week.completed is True
        assert state.current_streak == 1

    def test_completed_week_rewards_immediately_on_sunday(self) -> None:
        """일요일 저녁에 조건을 채웠으면 그 자리에서 준다. 월요일로 넘기지 않는다."""
        state = build_garden(_perfect_weeks(2), _sunday_of(2))

        assert state.current_streak == 2
        assert "bird" in earned_animals(state, family_week_completed=False)

    def test_week_in_progress_is_never_penalised(self) -> None:
        """수요일에 미달이라고 영양을 깎으면 남은 나흘을 채울 이유가 사라진다."""
        history = _perfect_weeks(5)
        partial = [
            CheckRecord(cid, MONDAY + timedelta(days=35 + day)) for day in range(3) for cid in DAILY_IDS
        ]
        wednesday = MONDAY + timedelta(days=37)

        state = build_garden(history + partial, wednesday)

        assert state.nutrition.level == 4


class TestAbsence:
    def test_a_skipped_week_breaks_the_streak(self) -> None:
        """빈 주는 레코드가 없어서 조회에 안 잡힌다. 그래도 결석으로 세야 한다."""
        history = _perfect_weeks(5) + _perfect_weeks(1, offset=6)

        state = build_garden(history, _sunday_of(1, offset=6))

        assert state.current_streak == 1
        assert state.max_streak == 5

    def test_tree_never_shrinks(self) -> None:
        """여섯 주 사라졌다 돌아와도 나무는 그대로다. 잃는 것은 속도지 성장이 아니다."""
        before = build_garden(_perfect_weeks(5), _sunday_of(5))
        after = build_garden(_perfect_weeks(5) + _perfect_weeks(1, offset=12), _sunday_of(1, offset=12))

        assert after.total_points >= before.total_points
        assert TREE_STAGES.index(after.tree_stage) >= TREE_STAGES.index(before.tree_stage)
        assert after.nutrition.level < before.nutrition.level

    def test_nutrition_drops_one_level_not_to_zero(self) -> None:
        state = build_garden(_perfect_weeks(5) + _perfect_weeks(1, offset=6), _sunday_of(1, offset=6))

        assert state.nutrition.level > 0


class TestAnimalsArePermanent:
    def test_conditions_are_records_not_current_state(self) -> None:
        """최고 기록으로 주기 때문에 연속이 끊겨도 자격이 유지된다."""
        kept = build_garden(_perfect_weeks(4), _sunday_of(4))
        lapsed = build_garden(_perfect_weeks(4) + _perfect_weeks(1, offset=8), _sunday_of(1, offset=8))

        assert "squirrel" in earned_animals(kept, family_week_completed=False)
        assert "squirrel" in earned_animals(lapsed, family_week_completed=False)
        assert lapsed.current_streak == 1

    def test_first_two_animals_arrive_almost_at_once(self) -> None:
        """늦게 시작한 사람이 가족 화면에서 텅 빈 나무만 보면 접는다."""
        records = [CheckRecord(cid, MONDAY) for cid in DAILY_IDS] + [CheckRecord("weight", MONDAY)]
        earned = earned_animals(build_garden(records, MONDAY), family_week_completed=False)

        assert {"butterfly", "bee"} <= earned

    def test_family_animal_needs_the_family(self) -> None:
        state = build_garden(_perfect_weeks(4), _sunday_of(4))

        assert "cat" not in earned_animals(state, family_week_completed=False)
        assert "cat" in earned_animals(state, family_week_completed=True)


class TestScoreHasNoHealthValues:
    def test_identical_behaviour_scores_identically(self) -> None:
        """이 검사가 존재하는 이유는 회귀 방지가 아니라 설계 선언이다.

        점수 입력이 (challenge_id, 날짜) 뿐이므로 등급이 `VERY_HIGH` 인 사람과
        `NORMAL` 인 사람이 같은 행동을 하면 같은 점수를 받는다. 가족 랭킹이 건강
        랭킹으로 변할 수 없다는 뜻이고, 화면 문구가 아니라 식이 그것을 보장한다.
        """
        signature = {field for field in CheckRecord.__dataclass_fields__}

        assert signature == {"challenge_id", "checked_on"}

    def test_only_catalog_ids_score(self) -> None:
        known = {item.id for item in (*DAILY_CHALLENGES, *MEASURE_CHALLENGES)}
        state = build_garden([CheckRecord("systolic_142", MONDAY)], MONDAY)

        assert "systolic_142" not in known
        assert state.total_points == 0


class TestCalendar:
    def test_week_starts_on_monday(self) -> None:
        for offset in range(7):
            assert week_start(MONDAY + timedelta(days=offset)) == MONDAY

    def test_season_is_a_28_day_block(self) -> None:
        # 기준일에서 재야 한다. 임의의 월요일은 시즌 중간일 수 있다.
        first = season_index(SEASON_EPOCH)

        assert first == 0
        assert season_index(SEASON_EPOCH + timedelta(days=27)) == 0
        assert season_index(SEASON_EPOCH + timedelta(days=28)) == 1

    def test_season_bounds_cover_exactly_28_days(self) -> None:
        start, end = season_bounds(season_index(MONDAY))

        assert start <= MONDAY <= end
        assert (end - start).days == SEASON_LENGTH_DAYS - 1
        assert start.weekday() == 0
