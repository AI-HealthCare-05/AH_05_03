"""챌린지 카탈로그와 정원 규칙. DB도 세션도 건드리지 않는 순수 계층.

이 파일에 값이 하나도 없는 것이 설계다. 서버는 "쟀다" 만 알고 "얼마였다" 는 모른다
(ADR-002 §4). 체중 78.4kg 은 브라우저 보관함에 남고 여기로 오는 것은 `weight` 라는
챌린지 id 와 날짜뿐이다.

점수 식에 건강 수치가 없는 것도 의도다. 당뇨 `HIGH` 인 사람과 `NORMAL` 인 사람이
같은 행동을 하면 같은 점수를 받는다. 가족 랭킹이 건강 랭킹으로 변하는 것을 식 차원에서
막는다 — 화면 문구로 막으면 언젠가 뚫린다.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone

# 국내 서비스이므로 하루의 경계를 KST 로 자른다. UTC 로 자르면 한국 사용자의
# 자정 직후 체크가 어제로 기록된다.
#
# `ZoneInfo("Asia/Seoul")` 대신 고정 오프셋을 쓴다. 한국은 1988년 이후 서머타임이 없어
# UTC+9 가 항상 맞고, `zoneinfo` 는 Windows 에서 `tzdata` 패키지가 없으면 **임포트
# 시점에** 터진다. 도커에서는 되고 호스트에서는 안 되는 모듈을 하나 더 만들 이유가 없다.
SERVICE_TZ = timezone(timedelta(hours=9), "KST")


def today_in_service_tz() -> date:
    return datetime.now(SERVICE_TZ).date()


# ---------------------------------------------------------------------------
# 카탈로그
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class DailyChallenge:
    id: str
    title: str
    detail: str
    points: int = 1


@dataclass(frozen=True)
class MeasureChallenge:
    id: str
    title: str
    detail: str
    points: int
    # 이 측정이 여는 판정 칸. 화면 카피("이거 하나면 네 칸이 열립니다")의 근거이고,
    # 서버는 실제로 열렸는지 모른다 — 판정은 브라우저에서 일어난다.
    opens: tuple[str, ...]


DAILY_CHALLENGES: tuple[DailyChallenge, ...] = (
    DailyChallenge("walk", "걸음 7,000보", "출퇴근에 한 정거장 걸어도 채워진다"),
    DailyChallenge("exercise", "운동 20분", "숨이 조금 찰 정도면 된다"),
    DailyChallenge("diet", "채소 한 접시 · 국물 남기기", "절주한 날도 여기에 체크한다"),
    DailyChallenge("sedentary", "한 시간에 한 번 일어나기", "앉아 있는 시간을 끊는 것만으로도 센다"),
)

MEASURE_CHALLENGES: tuple[MeasureChallenge, ...] = (
    MeasureChallenge("weight", "체중 · 허리둘레", "일요일 아침, 온 가족이 같은 날", 5, ("obesity", "mets")),
    MeasureChallenge("bp", "혈압", "약국 혈압계도 된다", 10, ("htn",)),
    MeasureChallenge("lab", "검사값 · 검진 결과지", "결과지 한 장이면 여러 칸이 한꺼번에 열린다", 20, ("dm", "dlp", "ckd", "liver")),
)

DAILY_BY_ID = {item.id: item for item in DAILY_CHALLENGES}
MEASURE_BY_ID = {item.id: item for item in MEASURE_CHALLENGES}
# 두 dataclass 를 한 순회로 묶으면 원소 타입이 `object` 로 넓어져 `.points` 가 사라진다.
POINTS_BY_ID: dict[str, int] = {
    **{item.id: item.points for item in DAILY_CHALLENGES},
    **{item.id: item.points for item in MEASURE_CHALLENGES},
}

# 하루 4종을 **전부** 채워야 물주기가 된다. 부분 달성도 점수는 들어가지만 물은 안 준다 —
# 물주기가 특별해야 "오늘 하나 남았다" 가 동작한다.
WATER_REQUIREMENT = len(DAILY_CHALLENGES)

# 주 완주 조건의 **기본값**. 사용자가 3·5·7 중에 고를 수 있고(`challenge_settings`),
# 7일 전부를 기본으로 요구하면 아프거나 여행 한 번에 끊긴다.
WEEK_WATER_REQUIREMENT = 5
WEEK_WATER_GOALS = (3, 5, 7)
WEEK_MEASURE_REQUIREMENT = 1


# ---------------------------------------------------------------------------
# 나무
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class TreeStage:
    key: str
    label: str
    threshold: int


# 앞을 촘촘히 뒀다. 4주 시연에서 눈에 띄게 자라야 하고, 뒤가 느린 것은 장기 사용자에게만
# 보이는 문제다. 하루 만점 4점 + 주간 측정이면 1주에 30점 안팎이 쌓인다.
TREE_STAGES: tuple[TreeStage, ...] = (
    TreeStage("seed", "씨앗", 0),
    TreeStage("sprout", "새싹", 12),
    TreeStage("sapling", "묘목", 30),
    TreeStage("young", "어린나무", 70),
    TreeStage("tree", "나무", 130),
    # 380 은 부엉이(8주 연속)와 맞춰 둔 값이다. 220 으로 뒀다가 만점 사용자가 6주에
    # 만렙에 닿아 뒤가 비었다. 마지막 단계와 마지막 동물이 같이 오는 편이 낫다.
    TreeStage("fruiting", "열매나무", 380),
)


# ---------------------------------------------------------------------------
# 영양
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class NutritionStage:
    level: int
    key: str
    label: str
    multiplier: float


# 주 단위로 한 칸씩 오르고 한 칸씩 내려간다. 0 으로 되돌리지 않는 것이 핵심이다 —
# 여덟 주 쌓은 사람이 한 주 쉬었다고 처음으로 가면 그냥 안 돌아온다.
NUTRITION_STAGES: tuple[NutritionStage, ...] = (
    NutritionStage(0, "none", "맨 흙", 1.0),
    NutritionStage(1, "water", "물", 1.2),
    NutritionStage(2, "compost", "거름", 1.5),
    NutritionStage(3, "soil", "좋은 흙", 2.0),
    NutritionStage(4, "rooted", "뿌리내림", 2.5),
)

MAX_NUTRITION_LEVEL = NUTRITION_STAGES[-1].level


# ---------------------------------------------------------------------------
# 동물 = 눈에 보이는 배지
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Animal:
    id: str
    name: str
    hint: str


# 한번 오면 떠나지 않는다. 그래서 조건은 전부 **최고 기록이나 처음 한 일**이고, 지금
# 상태가 아니다. 영양 단계는 오르내리지만 동물은 안 떠난다.
#
# 앞의 둘을 아주 쉽게 뒀다. 늦게 시작한 사람이 가족 화면에서 텅 빈 나무만 보면 접는다.
ANIMALS: tuple[Animal, ...] = (
    Animal("butterfly", "나비", "첫 물주기"),
    Animal("bee", "벌", "처음 재본 날"),
    Animal("bird", "새", "2주 연속 완주"),
    Animal("squirrel", "다람쥐", "4주 연속 완주"),
    Animal("cat", "고양이", "온 가족이 같은 주에 완주"),
    Animal("deer", "사슴", "측정 12번 누적"),
    Animal("owl", "부엉이", "8주 연속 완주"),
)

ANIMAL_BY_ID = {item.id: item for item in ANIMALS}


# ---------------------------------------------------------------------------
# 주와 시즌
# ---------------------------------------------------------------------------


def week_start(day: date) -> date:
    """그 날이 속한 주의 월요일. 결산은 일요일 밤에 닫힌다."""
    return day - timedelta(days=day.weekday())


# 시즌 경계를 고정 기준일에서 28일씩 끊는다. 나무와 동물은 시즌을 넘어 계속 가고
# 랭킹 점수만 리셋된다 — 늦게 시작한 사람에게도 순위에 들 기회를 준다.
SEASON_EPOCH = date(2026, 1, 5)  # 월요일
SEASON_LENGTH_DAYS = 28


def season_index(day: date) -> int:
    return (day - SEASON_EPOCH).days // SEASON_LENGTH_DAYS


def season_bounds(index: int) -> tuple[date, date]:
    start = SEASON_EPOCH + timedelta(days=index * SEASON_LENGTH_DAYS)
    return start, start + timedelta(days=SEASON_LENGTH_DAYS - 1)


# ---------------------------------------------------------------------------
# 정원 계산
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class CheckRecord:
    challenge_id: str
    checked_on: date


@dataclass(frozen=True)
class DaySummary:
    """그 주 하루의 상태. 주간 달력이 읽는다."""

    day: date
    checked: int
    watered: bool
    measured: bool


@dataclass(frozen=True)
class WeekSummary:
    start: date
    water_days: int
    measure_count: int
    completed: bool
    raw_points: int
    multiplier: float
    points: int
    days: tuple[DaySummary, ...] = ()


@dataclass
class GardenState:
    total_points: int = 0
    season_points: int = 0
    tree_stage: TreeStage = TREE_STAGES[0]
    next_stage: TreeStage | None = TREE_STAGES[1]
    points_to_next: int = TREE_STAGES[1].threshold
    nutrition: NutritionStage = NUTRITION_STAGES[0]
    current_streak: int = 0
    max_streak: int = 0
    watered_today: bool = False
    measure_count: int = 0
    checked_today: tuple[str, ...] = ()
    measured_this_week: tuple[str, ...] = ()
    water_goal: int = WEEK_WATER_REQUIREMENT
    this_week: WeekSummary | None = None
    weeks: tuple[WeekSummary, ...] = field(default_factory=tuple)


def _stage_for(points: int) -> tuple[TreeStage, TreeStage | None]:
    current = TREE_STAGES[0]
    following: TreeStage | None = None
    for index, stage in enumerate(TREE_STAGES):
        if points >= stage.threshold:
            current = stage
            following = TREE_STAGES[index + 1] if index + 1 < len(TREE_STAGES) else None
    return current, following


def build_garden(
    records: list[CheckRecord], today: date, *, water_goal: int = WEEK_WATER_REQUIREMENT
) -> GardenState:
    """체크 이력 전량을 주 단위로 훑어 정원 상태를 만든다.

    매 요청마다 전량을 다시 센다. 1인당 하루 최대 다섯 행이라 1년을 모아도 2천 행이
    안 되고, 무엇보다 **어디에도 누적값을 저장하지 않으므로 틀어질 수가 없다.**
    점수 규칙을 고치면 과거 점수도 같이 새 규칙으로 다시 계산된다.
    """
    state = GardenState(water_goal=water_goal)
    if not records:
        return state

    by_week: dict[date, list[CheckRecord]] = defaultdict(list)
    for record in records:
        by_week[week_start(record.checked_on)].append(record)

    this_week_start = week_start(today)
    current_season = season_index(today)

    level = 0
    streak = 0
    max_streak = 0
    total = 0
    season_total = 0
    summaries: list[WeekSummary] = []

    # **기록이 있는 주만 훑으면 안 된다.** 빈 주는 `by_week` 에 아예 없으므로 건너뛰게
    # 되고, 그러면 한 달 사라졌다 돌아온 사용자의 연속이 그대로 이어진다. 첫 주부터
    # 이번 주까지 한 주도 빠뜨리지 않고 걸어야 결석이 결석으로 세어진다.
    first_week = min(by_week)
    last_week = max(this_week_start, max(by_week))
    walk = first_week
    while walk <= last_week:
        start = walk
        walk += timedelta(days=7)
        entries = by_week.get(start, [])
        per_day: dict[date, set[str]] = defaultdict(set)
        measures: list[CheckRecord] = []
        raw = 0
        for entry in entries:
            raw += POINTS_BY_ID.get(entry.challenge_id, 0)
            if entry.challenge_id in DAILY_BY_ID:
                per_day[entry.checked_on].add(entry.challenge_id)
            elif entry.challenge_id in MEASURE_BY_ID:
                measures.append(entry)

        measured_on = {entry.checked_on for entry in measures}
        # 월~일 일곱 칸을 빠짐없이 만든다. 기록이 없는 날도 칸은 있어야 달력이 된다.
        days = tuple(
            DaySummary(
                day=start + timedelta(days=offset),
                checked=len(per_day.get(start + timedelta(days=offset), ())),
                watered=len(per_day.get(start + timedelta(days=offset), ())) >= WATER_REQUIREMENT,
                measured=(start + timedelta(days=offset)) in measured_on,
            )
            for offset in range(7)
        )

        water_days = sum(1 for ids in per_day.values() if len(ids) >= WATER_REQUIREMENT)
        completed = water_days >= water_goal and len(measures) >= WEEK_MEASURE_REQUIREMENT

        # 그 주에 들어갈 때의 영양 단계로 곱한다. 이번 주 성과로 이번 주를 부풀리지 않는다.
        multiplier = NUTRITION_STAGES[level].multiplier
        points = int(round(raw * multiplier))

        summary = WeekSummary(
            start=start,
            water_days=water_days,
            measure_count=len(measures),
            completed=completed,
            raw_points=raw,
            multiplier=multiplier,
            points=points,
            days=days,
        )
        summaries.append(summary)

        total += points
        if season_index(start) == current_season:
            season_total += points
        state.measure_count += len(measures)

        # 진행 중인 주는 **깎지만 않는다.** 수요일에 미달이라고 영양을 내리면 남은
        # 나흘을 채울 이유가 사라진다. 반대로 조건을 이미 채웠으면 그 자리에서 준다 —
        # 일요일 저녁에 마지막 칸을 채웠는데 보상이 월요일에 오면 그 순간을 놓친다.
        if start == this_week_start and not completed:
            continue

        if completed:
            streak += 1
            level = min(level + 1, MAX_NUTRITION_LEVEL)
        else:
            streak = 0
            level = max(level - 1, 0)
        max_streak = max(max_streak, streak)

    today_ids = tuple(
        sorted(r.challenge_id for r in records if r.checked_on == today and r.challenge_id in DAILY_BY_ID)
    )
    state.checked_today = today_ids
    state.watered_today = len(today_ids) >= WATER_REQUIREMENT
    state.measured_this_week = tuple(
        sorted(
            {
                r.challenge_id
                for r in records
                if week_start(r.checked_on) == this_week_start and r.challenge_id in MEASURE_BY_ID
            }
        )
    )

    state.total_points = total
    state.season_points = season_total
    state.tree_stage, state.next_stage = _stage_for(total)
    state.points_to_next = max(state.next_stage.threshold - total, 0) if state.next_stage else 0
    state.nutrition = NUTRITION_STAGES[level]
    state.current_streak = streak
    state.max_streak = max_streak
    state.weeks = tuple(summaries)
    state.water_goal = water_goal
    state.this_week = next((s for s in summaries if s.start == this_week_start), None)
    return state


def earned_animals(state: GardenState, *, family_week_completed: bool) -> set[str]:
    """지금까지 자격을 얻은 동물 id.

    `family_week_completed` 만 밖에서 받는다 — 가정 구성원 전체를 봐야 알 수 있고
    이 계층은 한 사람만 본다.
    """
    earned: set[str] = set()
    if any(week.water_days > 0 for week in state.weeks) or state.watered_today:
        earned.add("butterfly")
    if state.measure_count >= 1:
        earned.add("bee")
    if state.max_streak >= 2:
        earned.add("bird")
    if state.max_streak >= 4:
        earned.add("squirrel")
    if state.max_streak >= 8:
        earned.add("owl")
    if state.measure_count >= 12:
        earned.add("deer")
    if family_week_completed:
        earned.add("cat")
    return earned
