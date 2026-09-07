/**
 * 테스트용 수치 프로필 — 판정 화면을 값 하나 없이도 눌러 볼 수 있게 한다.
 *
 * 어디서 왔나
 * -----------
 * `app/apis/demo_routers.py` 의 `BASE_PROFILE` · `PROFILES` 를 그대로 옮겼다. 예측
 * 데모는 FastAPI 가 직접 내던 단일 HTML 이었고, 그 화면의 쓸모 절반이 이 프리셋이었다 —
 * 수치 34칸을 손으로 채우지 않고도 "당뇨인 사람" 을 한 번에 넣어 볼 수 있다는 것.
 * 데모를 지우면서 그 절반을 판정 화면으로 데려온다.
 *
 * **필드 이름이 다르다.** 데모는 규칙 엔진 이름(`total_cholesterol`·`ldl_c`·`hdl_c`·
 * `triglycerides`)을 썼는데 이 폼은 ML 이름(`total_chol`·`ldl`·`hdl`·`triglyceride`)을
 * 쓴다. `AssessmentSummaryRequest` 가 `RiskPredictionRequest` 를 상속하기 때문이고,
 * 이름 사상은 서버의 `RENAMED_FOR_RULES` 한 곳에만 산다. 옮길 때 그 넷을 바꿨다.
 *
 * 임계값은 `modeling/targets.py` 의 `Criterion` 과 같은 학회 기준을 따르고 여유를
 * 조금 둬서 경계에 걸치지 않게 했다 — 경계값 자체를 보고 싶으면 채운 뒤 손으로 고친다.
 *
 * **필수 다섯 칸(`age`·`sex`·`height_cm`·`weight_kg`·`self_rated_health`)은 어느
 * 프로필에서나 채워진다.** 기본 프로필이 다섯을 다 갖고 있고 질환별 프로필은 그 위에
 * 덮어쓰기만 하므로, 프리셋을 누르면 곧바로 판정할 수 있다. `presets.test.ts` 가 그 성질을
 * 고정한다 — 필드를 더하다가 필수 칸을 빼면 "채웠는데 판정이 안 된다" 가 된다.
 */

export interface AssessmentPreset {
  key: string;
  label: string;
  /** 이 프로필이 무엇을 노리는지. 버튼 아래 한 줄로 그대로 나간다. */
  note: string;
  /** 기본 프로필 위에 덮어쓸 값만. */
  set: Record<string, string | number>;
}

/**
 * 모든 값이 기준 안에 있는 사람. 질환별 프로필은 여기서 몇 칸만 바꾼다.
 *
 * 검사값을 전부 갖고 있으므로 프리셋을 쓰면 항상 **정밀형(lab) tier** 로 채점된다.
 * 일반형을 보고 싶으면 채운 뒤 검사값 칸을 비우면 된다.
 */
export const BASE_PRESET: Record<string, string | number> = {
  age: 52,
  sex: "M",
  height_cm: 172,
  weight_kg: 70,
  waist_cm: 84,
  self_rated_health: "3",
  sbp: 118,
  dbp: 74,
  fasting_glucose: 92,
  is_fasting: "true",
  hba1c: 5.3,
  total_chol: 180,
  ldl: 105,
  hdl: 55,
  triglyceride: 110,
  ast: 22,
  alt: 21,
  ggt: 24,
  uric_acid: 5.2,
  creatinine: 0.9,
  hemoglobin: 15.0,
  albumin: 4.4,
  urine_acr: 8,
  smoking_status: "never",
  sleep_hours: 7,
  moderate_min_per_week: 180,
  vigorous_min_per_week: 60,
  alcohol_days_per_year: 24,
  has_hypertension: "false",
  has_diabetes: "false",
  has_ascvd_history: "false",
};

export const ASSESSMENT_PRESETS: AssessmentPreset[] = [
  {
    key: "normal",
    label: "정상 범위",
    note: "모든 값이 기준 안에 있습니다. 여기서 한 칸만 고쳐 보면 무엇이 판정을 움직이는지 보입니다.",
    set: {},
  },
  {
    key: "dm",
    label: "당뇨",
    note: "공복혈당 148 · HbA1c 7.2 — 규칙 엔진이 기준 초과로 판정하고 ML 확률은 참고로 내려갑니다.",
    set: { fasting_glucose: 148, hba1c: 7.2, weight_kg: 84, waist_cm: 96, self_rated_health: "4" },
  },
  {
    key: "htn",
    label: "고혈압",
    note: "158/96 — 혈압은 고혈압 라벨을 정의하므로 ML 입력에서 차단돼 있습니다.",
    set: { sbp: 158, dbp: 96, weight_kg: 82, waist_cm: 95, age: 61 },
  },
  {
    key: "dlp",
    label: "이상지질혈증",
    note: "TC 268 · LDL 178 · TG 260 · HDL 34 — 하위유형 셋이 같이 움직입니다.",
    set: { total_chol: 268, ldl: 178, triglyceride: 260, hdl: 34 },
  },
  {
    key: "mets",
    label: "대사증후군",
    note: "5요소 중 4개 충족 — 규칙 엔진에 대응 영역이 없어 공개 공식(ATP III)이 답합니다.",
    set: {
      waist_cm: 98,
      triglyceride: 210,
      hdl: 38,
      sbp: 138,
      dbp: 88,
      fasting_glucose: 112,
      weight_kg: 88,
    },
  },
  {
    key: "ckd",
    label: "신기능",
    note: "크레아티닌 1.6 · 요알부민비 120 — eGFR 저하와 알부민뇨를 같이 봅니다(KDIGO).",
    set: { creatinine: 1.6, urine_acr: 120, age: 68, sbp: 142, dbp: 86 },
  },
  {
    key: "fatty_liver",
    label: "지방간",
    note: "BMI 31 · 허리 104 · γ-GTP 92 · ALT 68 — 공개 공식(HSI)이 답합니다.",
    set: { weight_kg: 92, waist_cm: 104, ggt: 92, alt: 68, ast: 44, triglyceride: 240 },
  },
  {
    key: "anemia",
    label: "빈혈",
    note: "혈색소 10.4 — WHO 기준(남 13 미만) 미달. 검사값이 있으니 규칙이 정본입니다.",
    set: { hemoglobin: 10.4, albumin: 3.6, self_rated_health: "4" },
  },
];

/** 프리셋 하나를 폼이 쓰는 문자열 사전으로 펼친다. */
export function presetValues(preset: AssessmentPreset): Record<string, string> {
  const merged = { ...BASE_PRESET, ...preset.set };
  return Object.fromEntries(Object.entries(merged).map(([name, value]) => [name, String(value)]));
}
