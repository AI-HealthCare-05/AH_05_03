export type ISODate = `${number}-${number}-${number}`;
export type ISODateTime = string;

export type LocalErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "VERSION_CONFLICT"
  | "ENCRYPTION_FAILED"
  | "DECRYPTION_FAILED"
  | "VAULT_LOCKED"
  | "DUPLICATE_RECORD"
  | "PROFILE_MERGE_CONFLICT"
  | "PROFILE_MERGE_NOT_SAFE"
  | "ROLLBACK_REQUIRED";

export type LocalResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: LocalErrorCode; message: string; retryable: boolean } };

export type Gender = "male" | "female";

export interface FamilyProfile {
  id: string;
  householdId: string;
  displayName: string;
  relationship: string;
  birthDate: ISODate | null;
  gender?: Gender | null;
  accountEmail?: string | null;
  opaqueServerRef: string | null;
  serverRefState: "none" | "pending" | "active" | "retired";
  status: "active" | "hidden" | "merged";
  mergedIntoProfileId: string | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  version: number;
}

export interface FamilyHistory {
  id: string;
  householdId: string;
  profileId: string;
  relativeRelationship: string;
  conditionName: string;
  onsetAge: number | null;
  note: string | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  version: number;
}

export type ShareableRecordType = "health-record" | "family-history" | "model-result";

export interface LocalAccessGrant {
  id: string;
  householdId: string;
  profileId: string;
  granteeAccountId: string;
  allowedRecordTypes: ShareableRecordType[];
  status: "active" | "revoked";
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  revokedAt: ISODateTime | null;
  version: number;
}

export interface ProfileMergeOperation {
  id: string;
  householdId: string;
  sourceProfileId: string;
  targetProfileId: string;
  restorePointId: string;
  status: "committed" | "reverted";
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  revertedAt: ISODateTime | null;
  version: number;
}

export type HealthRecordType =
  | "blood_pressure"
  | "blood_glucose"
  | "body_measurement"
  | "lab_result"
  | "vaccination"
  | "health_screening"
  | "pain"
  | "walking"
  // 대화로 남기는 두 가지. 백엔드 건강 비서가 `exercise_draft`·`medication_draft` 를
  // 내는데 프런트 타입에 자리가 없어 저장할 곳이 없었다. `walking` 은 걷기 전용이라
  // 근력·수영을 담지 못하고, 복약은 어느 종류에도 안 들어간다.
  | "exercise"
  | "medication"
  // 챌린지가 만들어 남기는 두 가지. 수면과 그날 컨디션은 어느 기존 종류에도
  // 들어가지 않는다.
  | "sleep"
  | "daily_condition"
  // 판정 시점 스냅샷. 추적 대시보드가 "같은 사람의 다른 시점"을 그리려면 그 시점의
  // 입력값과 결과를 함께 남겨야 한다. 서버는 판정을 저장하지 않으므로(NFR-01)
  // 남길 자리는 여기, 암호화 로컬 보관함뿐이다.
  | "assessment"
  | "note";

/**
 * `recordType: "assessment"` 의 payload.
 *
 * 등급까지 같이 남기는 이유는 **다시 계산하면 값이 달라질 수 있기** 때문이다. 모델
 * 번들은 재학습으로 갱신되고 규칙 임계값도 지침 개정으로 바뀐다. 그때 과거 시점을
 * 새 모델로 재채점하면 "그날 사용자가 본 화면"과 다른 그래프가 그려진다. 추적은
 * 그날 본 것을 이어야 뜻이 있다.
 */
export interface AssessmentSnapshotPayload {
  /** 그날 넣은 값. 키는 서버 DTO 필드명 그대로다. */
  inputs: Record<string, number | string | boolean>;
  /** 질환별 등급. 키는 `verdicts[].key`. */
  levels: Record<string, string>;
  /** 질환별 정본 엔진. 엔진이 바뀐 시점을 차트에 표시하는 재료다. */
  engines: Record<string, string>;
  bmi: number;
  evaluated: number;
  total: number;
  highestLevel: string;

  /**
   * 그날 화면에 뜬 판정 카드 원본.
   *
   * `levels` 만으로는 "고혈압 높음" 까지만 복원된다. 사용자가 그날 실제로 읽은
   * 것은 어느 엔진이 왜 답했는지, 무슨 수치를 보고 그랬는지, 밀려난 ML 확률이
   * 얼마였는지다. **그게 없으면 기록을 열어도 등급 이름만 남는다.**
   *
   * 다시 계산하지 않고 저장하는 이유는 `snapshots.ts` 머리말과 같다 — 번들은
   * 재학습으로, 임계값은 지침 개정으로 바뀐다. 그날 본 화면을 재현하려면 저장본
   * 말고는 방법이 없다.
   *
   * **선택 필드다.** 이 필드가 생기기 전에 남긴 기록에는 없다. 읽는 쪽은 없을 때를
   * 반드시 다뤄야 한다.
   */
  verdicts?: StoredVerdict[];
  /** 수치가 가리키는 앞날 축. 같은 이유로 저장한다. */
  matrix?: StoredRisk[];

  /**
   * 이 판정이 쓴 **수치 기록**의 id.
   *
   * 판정은 수치에서 나온 것이다. 목록에 둘이 나란히 서면 같은 일이 두 줄로 보이므로,
   * 이 고리가 있는 판정은 목록에서 빠지고 그 수치 기록의 자세히에서 열린다.
   *
   * **선택 필드다.** 이 고리가 생기기 전에 남긴 판정에는 없고, 그런 기록은 갈 곳이
   * 없으므로 목록에 그대로 선다 — 숨기면 사라진다.
   */
  sourceRecordId?: string;

  /**
   * 같은 값으로 다시 채점한 회차.
   *
   * **기록 하나 = 입력값 한 벌**이다. 판정하기를 누를 때마다 새 기록을 만들면, 값을
   * 되불러와 다시 돌리는 것만으로 타임라인이 늘어난다(실측: 같은 날 8.6KB 짜리 행이
   * 두 번). 추적 그래프에서 변화 없는 점은 정보가 아니라 가로축만 먹는다.
   *
   * 그렇다고 버리지도 않는다. **같은 값을 다시 채점했는데 등급이 달라졌다면 그건
   * 모델이나 임계값이 바뀐 증거**이고, 이 제품에서 그건 남길 값어치가 있다
   * (`snapshots.ts` 머리말 — 번들은 재학습으로, 임계값은 지침 개정으로 바뀐다).
   *
   * 그래서 규칙이 셋이다.
   *
   *     값이 다르다              새 기록
   *     값 같고 등급도 같다      회차를 늘리지 않고 `checkedAt` 만 갱신
   *     값 같고 등급이 다르다    회차를 하나 더 쌓는다 (2차·3차…)
   *
   * `runs[0]` 이 1차다. 기록이 만들어질 때 항상 하나 들어간다.
   * **선택 필드다** — 이 필드가 생기기 전 기록에는 없다.
   */
  runs?: AssessmentRun[];
  /** 마지막으로 같은 값을 다시 확인한 시각. 회차가 안 늘어도 갱신된다. */
  checkedAt?: string;
}

/** 같은 입력을 채점한 한 회차. 등급이 달라졌을 때만 쌓인다. */
export interface AssessmentRun {
  /** 이 회차를 채점한 시각. */
  at: string;
  /** 질환별 등급. `levels` 와 같은 모양이다. */
  levels: Record<string, string>;
  /** 그때의 최고 등급. 목록이 한 줄로 보여줄 값이다. */
  highestLevel: string;
}

/**
 * 저장용으로 줄인 판정 카드. 서버 응답에서 **화면이 실제로 그리는 것만** 남긴다.
 *
 * 뺀 것: `reliability`(구간 10개 배열)·`top_factors`. 화면이 안 쓰는데 기록마다
 * 쌓이면 보관함이 그만큼 커진다.
 */
export interface StoredVerdict {
  key: string;
  name: string;
  engine: string;
  engine_label: string;
  engine_reason: string;
  risk_level: string;
  sub_status: string;
  display_label: string;
  reason: string;
  criteria_reference: string;
  recommendation: string;
  missing_fields: string[];
  flags: string[];
  superseded_by: string | null;
  disclaimer: string;
  reference?: {
    probability?: number | null;
    peer_percentile?: number | null;
    peer_group?: string | null;
    peer_ratio?: number | null;
    accuracy?: {
      headline_auroc: number;
      grade: string;
      measured_on: string;
      alert_ppv: number | null;
      alert_sensitivity: number | null;
      holdout_n: number | null;
    } | null;
  } | null;
}

export interface StoredRisk {
  category: string;
  risk_level: string;
  sub_status: string;
  display_label: string;
  reason: string;
  criteria_reference: string;
  recommendation: string;
  missing_fields: string[];
  contributors: {
    key: string;
    label: string;
    detail: string;
    weight: 1 | 2 | 3;
    effect: string;
    source: string;
    causal: boolean | null;
  }[];
  score: number;
}

export interface HealthRecord<TPayload extends object = Record<string, unknown>> {
  id: string;
  householdId: string;
  profileId: string;
  recordType: HealthRecordType;
  recordedAt: ISODateTime;
  source: "manual" | "ocr" | "import" | "local_ai";
  payload: TPayload;
  sourceDocumentId: string | null;
  deletedAt: ISODateTime | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  version: number;
}

export interface LocalDocument {
  id: string;
  householdId: string;
  profileId: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
  chunkCount: number;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  version: number;
}

export interface DashboardSummary {
  profileId: string;
  totalRecords: number;
  latestRecordedAt: ISODateTime | null;
  countsByType: Partial<Record<HealthRecordType, number>>;
}


export type ChallengeTaskStatus =
  | "pending"
  | "completed"
  | "partial"
  | "rest"
  | "postponed"
  | "skipped";

export interface ChallengeTask {
  id: string;
  week: number;
  dayOfWeek: number; // 0 (일) ~ 6 (토)
  type: "exercise" | "sleep" | "check_in";
  title: string;
  targetMinutes?: number;
  targetDistanceKm?: number;
  note?: string;
}

export interface ChallengePlan {
  id: string;
  householdId: string;
  profileId: string;
  title: string;
  goal: string;
  startDate: ISODate;
  endDate: ISODate;
  status: "draft" | "active" | "completed" | "archived";
  weeks: number;
  tasks: ChallengeTask[];
  createdBy: "health_assistant" | "manual";
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  version: number;
}

export interface ChallengeTaskProgressState {
  status: ChallengeTaskStatus;
  completedAt?: ISODateTime;
  adjustedMinutes?: number;
  note?: string;
}

export interface ChallengeProgress {
  id: string;
  challengeId: string;
  profileId: string;
  date: ISODate;
  dayStatus: ChallengeTaskStatus;
  taskStatuses: Record<string, ChallengeTaskProgressState>;
  completedAt: ISODateTime | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  version: number;
}

export interface ChallengeWeeklyProgress {
  challengeId: string;
  profileId: string;
  weekNumber: number;
  totalDays: number;
  completedDays: number;
  ratePercent: number;
  currentStreakDays: number;
  dailyStatuses: Array<{
    date: ISODate;
    dayOfWeek: number;
    status: ChallengeTaskStatus;
    tasksCount: number;
    completedCount: number;
  }>;
}

export interface TodayTaskItem {
  task: ChallengeTask;
  status: ChallengeTaskStatus;
  adjustedMinutes?: number;
  completedAt?: ISODateTime;
}

export interface TodayChallengeSummary {
  hasActiveChallenge: boolean;
  plan?: ChallengePlan;
  todayDate: ISODate;
  tasks: TodayTaskItem[];
  allCompleted: boolean;
  weeklyProgress?: ChallengeWeeklyProgress;
}
