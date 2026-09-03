/**
 * 챌린지 응답 타입. 판정 응답처럼 계정 도메인이 아니라서 기능 폴더에 둔다
 * (`shared/api/contracts.ts` 가 아니라 여기).
 *
 * 이 타입 어디에도 측정값이 없다. 서버가 아는 것은 "쟀다" 와 날짜뿐이다.
 */

export type ChallengeMode = "personal" | "family";

export type TreeKey = "seed" | "sprout" | "sapling" | "young" | "tree" | "fruiting";
export type AnimalId = "butterfly" | "bee" | "bird" | "squirrel" | "cat" | "deer" | "owl";

export interface DailyItem {
  id: string;
  title: string;
  detail: string;
  points: number;
  checked: boolean;
}

export interface MeasureItem {
  id: string;
  title: string;
  detail: string;
  points: number;
  /** 이 측정이 여는 판정 칸. "이거 하나면 네 칸이 열립니다" 의 근거. */
  opens: string[];
  checked_this_week: boolean;
}

export interface TreeStage {
  key: TreeKey;
  label: string;
  index: number;
  total: number;
  points_to_next: number;
  next_label: string | null;
}

export interface Nutrition {
  level: number;
  key: string;
  label: string;
  multiplier: number;
  current_streak: number;
  max_streak: number;
}

export interface Animal {
  id: AnimalId;
  name: string;
  hint: string;
  earned: boolean;
  earned_on: string | null;
}

export interface WeekDay {
  date: string;
  /** 0 = 월요일 */
  weekday: number;
  checked_count: number;
  total_count: number;
  watered: boolean;
  measured: boolean;
  is_today: boolean;
  is_future: boolean;
}

export interface WeekProgress {
  start: string;
  water_days: number;
  water_required: number;
  measure_count: number;
  measure_required: number;
  completed: boolean;
  days_left: number;
  days: WeekDay[];
}

export interface Garden {
  total_points: number;
  season_points: number;
  season_index: number;
  season_start: string;
  season_end: string;
  tree: TreeStage;
  nutrition: Nutrition;
  animals: Animal[];
  week: WeekProgress;
  watered_today: boolean;
  measure_count: number;
}

export interface ChallengeToday {
  today: string;
  daily: DailyItem[];
  measures: MeasureItem[];
  water_requirement: number;
  checked_count: number;
  watered_today: boolean;
  garden: Garden;
}

export interface ChallengeCheckResult {
  challenge_id: string;
  checked_on: string;
  checked: boolean;
  watered_now: boolean;
  new_animals: Animal[];
  garden: Garden;
}

export interface HouseholdGardenItem {
  account_id: string;
  masked_email: string;
  local_profile_ref: string | null;
  is_me: boolean;
  rank: number;
  season_points: number;
  total_points: number;
  tree_key: TreeKey;
  tree_label: string;
  animal_count: number;
  week_completed: boolean;
}

export interface HouseholdGarden {
  household_id: string;
  season_index: number;
  season_start: string;
  season_end: string;
  week_start: string;
  members_completed: number;
  members_total: number;
  all_completed: boolean;
  goal: HouseholdGoal;
  items: HouseholdGardenItem[];
}

export interface ChallengeSettings {
  mode: ChallengeMode;
  weekly_water_goal: number;
  measure_weekday: number;
  /** 아직 한 번도 고른 적이 없으면 셋업 화면을 띄운다. */
  configured: boolean;
}

export interface HouseholdGoal {
  goal_days: number;
  done_days: number;
  reached: boolean;
}
