/**
 * `POST /api/v1/assessments/summary` 응답 타입.
 *
 * 서버의 `app/dtos/assessment_summary.py` 를 옮긴 것이다. 손으로 옮기는 대가로
 * 드리프트 위험이 생기므로 **화면이 실제로 읽는 필드만** 적었다 — 다 적으면 서버가
 * 필드를 더할 때마다 여기도 고쳐야 하고, 안 읽는 필드의 드리프트는 잡을 방법이 없다.
 */

export type RiskLevel = "INSUFFICIENT_DATA" | "NORMAL" | "CAUTION" | "HIGH" | "VERY_HIGH";
export type EngineCode = "E1" | "E2" | "E3";

export interface ModelAccuracy {
  headline_auroc: number;
  grade: string;
  measured_on: string;
  /**
   * 라벨 전체 기준 AUROC. `headline_auroc` 는 미진단자 값이 있으면 그쪽이다.
   *
   * 서버(`app/dtos/predictions.py` 의 `ModelAccuracy`)는 처음부터 이 셋을 실어
   * 보내고 있었는데 이 손 사본에만 없었다. 없는 필드는 화면이 못 읽으므로
   * "서버가 안 준다" 와 구별되지 않는다 — 자세히 보기를 붙이면서 드러났다.
   */
  auroc: number;
  auroc_undiagnosed: number | null;
  alert_ppv: number | null;
  alert_sensitivity: number | null;
  holdout_n: number | null;
  holdout_cycle: string | null;
}

/**
 * 2단계 발병 궤적. 서버 `OnsetTrajectory` 의 사본.
 *
 * `onset_probability[i]` 는 `horizons_years[i]` 년 안에 이 질환이 생길 누적 확률이고
 * `population_onset_probability` 는 같은 나이·성별 동년배의 값이다. 둘을 같이 그려야
 * "27%" 가 높은 건지 보통인 건지 읽힌다.
 */
export interface OnsetTrajectory {
  horizons_years: number[];
  onset_probability: number[];
  population_onset_probability: number[];
  relative_hazard: number;
  reference_prevalence: number;
  conditional_on: string;
  mortality_corrected: boolean;
  truncated_at_age?: number | null;
  method: string;
  caveats: string[];
}

export type TrajectoryStatus =
  | "projected"
  | "not_applicable"
  | "below_gate"
  | "already_met"
  | "already_present"
  | "withheld"
  | "age_out_of_range"
  | "unavailable";

/** "그 나이가 됐을 때 기준을 넘고 있을 확률". 발병 궤적과 다른 질문이다. */
export interface PrevalenceTrajectory {
  horizons_years: number[];
  prevalence_probability: number[];
  current_probability: number;
  direction: string;
  conditional_on: string;
  irreversible: boolean;
  truncated_at_age?: number | null;
  caveats: string[];
}

/** 1단계가 고른 의심 질환 한 장. 2단계 곡선이 붙는다. */
export interface SuspectCard {
  target: string;
  name: string;
  rank: number;
  score: number;
  suspected: boolean;
  probability?: number | null;
  /**
   * 순위 점수를 만든 재료. **배지로 쓰지 않는다** — 규칙 5단계와 의학 4단계
   * (낮음·관심·주의·높음)가 섞여 들어온다. 근거 문구에만 쓴다.
   */
  level: string;
  /**
   * 판정 카드와 같은 5단계 등급. 화면이 배지로 쓰는 값이다.
   *
   * 옛 응답(기록 화면이 그리는 스냅샷)에는 없을 수 있어 옵셔널이다 — 없으면
   * `level` 로 떨어진다.
   */
  risk_level?: RiskLevel | "";
  /** "측정" 이면 규칙 엔진이 검사값으로 준 판정, "예측" 이면 ML 확률 */
  basis: string;
  peer_ratio?: number | null;
  evidence_weight: number;
  reason: string;
  prevalence_trajectory?: PrevalenceTrajectory | null;
  onset_trajectory?: OnsetTrajectory | null;
  onset_status?: string | null;
}

/** 의학 기준 등급 묶음. 게이지와 "이 점수대 100명 중 몇 명" 의 재료다. */
export interface MedicalRisk {
  level: "낮음" | "관심" | "주의" | "높음";
  rate: number;
  basis: string;
  baseline?: number | null;
  lift?: number | null;
  anchored_on_rule_engine: boolean;
}

/** 이 확률대를 실제로 검사하면 학회 기준으로 몇 %가 넘는가. */
export interface RuleAnchor {
  society: string;
  positive_from: string;
  rule_positive_rate: number;
  overall_rate?: number | null;
  lift?: number | null;
  sample: number;
  levels: Record<string, number>;
}

export interface VerdictReference {
  /**
   * 이 확률을 낸 ML 번들의 타깃 이름. **카드 키와 다를 수 있다.**
   *
   * `liver` 카드는 `liver_enzyme_high` 번들이, `uric_acid` 카드는 `hyperuricemia`
   * 번들이 답한다. `/predictions/model-info` 에서 번들을 찾을 때 카드 키로 찾으면
   * "이 모델이 쓰지 않은 입력" 과 "더 넣으면 정밀해지는 값" 이 조용히 빈다.
   */
  model_target?: string | null;
  probability?: number | null;
  peer_percentile?: number | null;
  peer_group?: string | null;
  peer_median?: number | null;
  peer_ratio?: number | null;
  medical_level?: string | null;
  /** `medical_level` 은 이 안의 `level` 하나다. 게이지는 `rate` 가 있어야 그린다. */
  medical?: MedicalRisk | null;
  model_auroc?: number | null;
  tier?: string | null;
  accuracy?: ModelAccuracy | null;
  rule_anchor?: RuleAnchor | null;
  top_factors?: { feature: string; contribution: number }[];
  trajectory?: OnsetTrajectory | null;
  trajectory_status?: TrajectoryStatus | null;
  /**
   * "그 나이가 됐을 때 기준을 넘고 있을 확률" — **열 질환 전부**에 있다.
   *
   * 발병 궤적은 비가역 셋(당뇨·고혈압·신기능)에만 붙는다. 나머지 일곱은 가역이거나
   * 유병률이 비단조라 누적 발병 곡선이 거짓이 된다(`app/services/trajectory.py` 의
   * `EXCLUDED_TARGETS`: 이상지질혈증은 65세+ 사망연계 C 0.43 으로 방향이 뒤집힌다).
   * 그래서 앞날을 말할 자리가 일곱 장에 아예 없었다. 이쪽은 다른 물음이라 답이 있다.
   */
  prevalence_trajectory?: PrevalenceTrajectory | null;
}

export interface DiseaseVerdict {
  key: string;
  name: string;
  engine: EngineCode;
  engine_label: string;
  engine_reason: string;
  risk_level: RiskLevel;
  sub_status: string;
  display_label: string;
  reason: string;
  criteria_reference: string;
  recommendation: string;
  missing_fields: string[];
  flags: string[];
  superseded_by: string | null;
  reference: VerdictReference | null;
  disclaimer: string;
}

export interface RiskContributor {
  key: string;
  label: string;
  detail: string;
  weight: 1 | 2 | 3;
  effect: string;
  source: string;
  causal: boolean | null;
}

export interface DiseaseRisk {
  category: string;
  risk_level: RiskLevel;
  sub_status: string;
  display_label: string;
  reason: string;
  criteria_reference: string;
  recommendation: string;
  missing_fields: string[];
  contributors: RiskContributor[];
  score: number;
  /**
   * 이 질환에 걸린 신호 목록의 크기와, 그중 실제로 확인한 수.
   *
   * **`contributors` 가 0 일 때 이 둘이 있어야 "다 보고 깨끗하다" 와 "못 봤다" 가
   * 구분된다.** "위험 신호 0개" 만 적으면 안 낸 검사를 통과했다고 말하는 셈이다.
   * 옛 스냅샷에는 없으므로 옵셔널이다.
   */
  signals_total?: number;
  signals_checked?: number;
}

export interface AssessmentSummary {
  evaluated: number;
  total: number;
  insufficient: string[];
  by_engine: Record<string, number>;
  needs_attention: string[];
  highest_level: RiskLevel;
  matrix_evaluated: number;
  matrix_total: number;
  matrix_needs_attention: string[];
}

export interface AssessmentSummaryData {
  bmi: number;
  summary: AssessmentSummary;
  verdicts: DiseaseVerdict[];
  disease_risks: Record<string, DiseaseRisk>;
  top_suspects: SuspectCard[];
  disclaimers: string[];
  inputs_provided: number;
  inputs_total: number;
  model_available: boolean;
}

/** 등급 표시. 규칙 엔진 5단계를 그대로 쓴다 — 엔진이 달라도 "주의"가 같은 뜻이다. */
export const LEVEL_LABEL: Record<RiskLevel, string> = {
  VERY_HIGH: "매우 높음",
  HIGH: "높음",
  CAUTION: "주의",
  NORMAL: "정상 범위",
  INSUFFICIENT_DATA: "정보 부족",
};

export const LEVEL_ORDER: RiskLevel[] = ["VERY_HIGH", "HIGH", "CAUTION", "NORMAL", "INSUFFICIENT_DATA"];

export const ENGINE_SHORT: Record<EngineCode, string> = {
  E1: "규칙 엔진",
  E2: "ML 예측",
  E3: "공개 공식",
};

/**
 * 질환 키 → 이름.
 *
 * 판정 화면은 응답의 `verdicts[].name` 을 그대로 쓰므로 이 표가 필요 없다. 필요한
 * 곳은 **판정 응답 없이 스냅샷만 들고 있는 화면**이다 — 건강 현황의 추이 그래프가
 * 그렇다. 스냅샷 payload 는 `levels` 를 질환 키로만 담고 이름을 남기지 않는다.
 *
 * 서버 `app/services/assessment.py` 의 `SPECS` 와 순서·표기를 맞춘다. 서버가 질환을
 * 더하면 여기 없는 키가 오는데, 부르는 쪽이 키를 그대로 보여 주게 두었다 —
 * 화면에서 빈칸이 되는 것보다 낫다.
 */
export const DISEASE_NAMES: Record<string, string> = {
  dm: "당뇨병",
  htn: "고혈압",
  dlp: "이상지질혈증",
  hyperchol: "고콜레스테롤혈증",
  hypertg: "고중성지방혈증",
  low_hdl: "낮은 HDL 콜레스테롤",
  obesity: "비만",
  mets: "대사증후군",
  ckd: "만성콩팥병",
  fatty_liver: "지방간",
  liver: "간기능",
  anemia: "빈혈",
  uric_acid: "요산",
  inflammation: "만성염증",
};
