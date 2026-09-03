import uuid
from datetime import date

from pydantic import Field

from app.dtos.base import BaseSerializerModel
from app.models.challenge_settings import ChallengeMode


class DailyItemData(BaseSerializerModel):
    id: str
    title: str
    detail: str
    points: int
    checked: bool


class MeasureItemData(BaseSerializerModel):
    id: str
    title: str
    detail: str
    points: int
    # 이 측정이 여는 판정 칸의 키. 서버는 실제로 열렸는지 모른다 — 판정은 브라우저 몫이다.
    opens: list[str]
    checked_this_week: bool


class TreeStageData(BaseSerializerModel):
    key: str
    label: str
    index: int
    total: int
    points_to_next: int
    next_label: str | None


class NutritionData(BaseSerializerModel):
    level: int
    key: str
    label: str
    multiplier: float
    current_streak: int
    max_streak: int


class AnimalData(BaseSerializerModel):
    id: str
    name: str
    hint: str
    earned: bool
    earned_on: date | None


class WeekDayData(BaseSerializerModel):
    """주간 달력 한 칸. 색은 화면이 정하고 서버는 사실만 낸다."""

    date: date
    weekday: int  # 0 = 월요일
    checked_count: int
    total_count: int
    watered: bool
    measured: bool
    is_today: bool
    is_future: bool


class WeekProgressData(BaseSerializerModel):
    start: date
    water_days: int
    water_required: int
    measure_count: int
    measure_required: int
    completed: bool
    days_left: int
    days: list[WeekDayData]


class GardenData(BaseSerializerModel):
    total_points: int
    season_points: int
    season_index: int
    season_start: date
    season_end: date
    tree: TreeStageData
    nutrition: NutritionData
    animals: list[AnimalData]
    week: WeekProgressData
    watered_today: bool
    measure_count: int


class ChallengeTodayData(BaseSerializerModel):
    today: date
    daily: list[DailyItemData]
    measures: list[MeasureItemData]
    water_requirement: int
    checked_count: int
    watered_today: bool
    garden: GardenData


class ChallengeCheckRequest(BaseSerializerModel):
    challenge_id: str = Field(min_length=1, max_length=32)


class ChallengeCheckResultData(BaseSerializerModel):
    challenge_id: str
    checked_on: date
    checked: bool
    # 이번 체크로 물주기가 방금 채워졌는가. 화면 연출의 트리거다.
    watered_now: bool
    new_animals: list[AnimalData]
    garden: GardenData


class HouseholdGardenItemData(BaseSerializerModel):
    account_id: uuid.UUID
    masked_email: str
    local_profile_ref: str | None
    is_me: bool
    rank: int
    season_points: int
    total_points: int
    tree_key: str
    tree_label: str
    # 목록에서는 개수만 낸다. 누가 무슨 동물을 가졌는지는 본인 화면에서만 보인다.
    animal_count: int
    week_completed: bool


class HouseholdGardenData(BaseSerializerModel):
    household_id: uuid.UUID
    season_index: int
    season_start: date
    season_end: date
    week_start: date
    # 이번 주에 완주한 사람 수 / 전체. "4명 중 3명이 쟀습니다" 의 재료.
    members_completed: int
    members_total: int
    all_completed: bool
    # 집 공동 목표. 구성원 각자 목표의 합이라 따로 저장하지 않는다.
    goal: "HouseholdGoalData"
    items: list[HouseholdGardenItemData]


class ChallengeSettingsData(BaseSerializerModel):
    mode: ChallengeMode
    weekly_water_goal: int
    measure_weekday: int
    # 아직 한 번도 고른 적이 없으면 셋업 화면을 띄운다.
    configured: bool


class ChallengeSettingsRequest(BaseSerializerModel):
    mode: ChallengeMode
    weekly_water_goal: int = Field(ge=3, le=7)
    measure_weekday: int = Field(ge=0, le=6)


class HouseholdGoalData(BaseSerializerModel):
    """집 공동 목표. 구성원 각자의 목표를 더한 값이라 따로 저장하지 않는다."""

    goal_days: int
    done_days: int
    reached: bool
