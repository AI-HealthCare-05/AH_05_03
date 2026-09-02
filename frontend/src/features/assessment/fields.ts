/**
 * 입력 필드 스펙 — 서버 DTO(`AssessmentSummaryRequest`) 36필드를 그대로 옮긴다.
 *
 * 손으로 input 을 36개 쓰지 않고 선언으로 둔 이유가 둘이다. 하나, 서버가 필드를
 * 더하거나 범위를 바꿀 때 고칠 자리가 한 곳이다. 둘, **단위와 범위가 라벨 옆에
 * 붙어 있어야 사용자가 검진결과지를 보고 옮겨 적을 수 있다** — mg/dL 인지 mmol/L
 * 인지 모르면 10배 틀린 값이 그대로 들어간다.
 *
 * 그룹 순서는 기본 → 혈압 → 혈당 → 지질 → 간·신장·혈액 → 생활습관 →
 * 진단 이력. 검진결과지에 인쇄된 순서와 비슷해서
 * 위에서 아래로 옮겨 적을 수 있다.
 */

export type FieldKind = "number" | "select" | "bool";

export interface FieldSpec {
  name: string;
  label: string;
  kind: FieldKind;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  required?: boolean;
  options?: { value: string; label: string }[];
  hint?: string;
}

export interface FieldGroup {
  key: string;
  title: string;
  note?: string;
  fields: FieldSpec[];
}

const SELF_RATED = [
  { value: "1", label: "1 · 매우 좋음" },
  { value: "2", label: "2 · 좋음" },
  { value: "3", label: "3 · 보통" },
  { value: "4", label: "4 · 나쁨" },
  { value: "5", label: "5 · 매우 나쁨" },
];

export const FIELD_GROUPS: FieldGroup[] = [
  {
    key: "basic",
    title: "기본",
    note: "이 다섯 개만 채우면 결과가 나옵니다.",
    fields: [
      { name: "age", label: "나이", kind: "number", unit: "세", min: 19, max: 100, required: true },
      {
        name: "sex",
        label: "성별",
        kind: "select",
        required: true,
        options: [
          { value: "M", label: "남성" },
          { value: "F", label: "여성" },
        ],
      },
      { name: "height_cm", label: "키", kind: "number", unit: "cm", min: 101, max: 229, step: 0.1, required: true },
      { name: "weight_kg", label: "체중", kind: "number", unit: "kg", min: 26, max: 299, step: 0.1, required: true },
      {
        name: "self_rated_health",
        label: "전반적 건강",
        kind: "select",
        required: true,
        options: SELF_RATED,
        hint: "평소 본인의 건강이 어떻다고 느끼시나요",
      },
      { name: "waist_cm", label: "허리둘레", kind: "number", unit: "cm", min: 41, max: 199, step: 0.1 },
    ],
  },
  {
    key: "bp",
    title: "혈압",
    note: "넣으면 고혈압을 추정이 아니라 학회 기준으로 판정합니다.",
    fields: [
      { name: "sbp", label: "수축기", kind: "number", unit: "mmHg", min: 60, max: 260 },
      { name: "dbp", label: "이완기", kind: "number", unit: "mmHg", min: 30, max: 200 },
    ],
  },
  {
    key: "glucose",
    title: "혈당",
    fields: [
      { name: "fasting_glucose", label: "공복혈당", kind: "number", unit: "mg/dL", min: 20, max: 800 },
      { name: "hba1c", label: "당화혈색소", kind: "number", unit: "%", min: 2, max: 20, step: 0.1 },
      { name: "ogtt_2h", label: "경구당부하 2시간", kind: "number", unit: "mg/dL", min: 21, max: 600 },
      { name: "is_fasting", label: "공복 측정이었나", kind: "bool" },
    ],
  },
  {
    key: "lipid",
    title: "지질",
    fields: [
      { name: "total_chol", label: "총콜레스테롤", kind: "number", unit: "mg/dL", min: 50, max: 600 },
      { name: "hdl", label: "HDL", kind: "number", unit: "mg/dL", min: 5, max: 200 },
      { name: "ldl", label: "LDL", kind: "number", unit: "mg/dL", min: 5, max: 500 },
      { name: "triglyceride", label: "중성지방", kind: "number", unit: "mg/dL", min: 10, max: 3000 },
      { name: "non_hdl_c", label: "비HDL", kind: "number", unit: "mg/dL", min: 1, max: 1000, hint: "비우면 총콜레스테롤에서 HDL 을 빼 계산합니다" },
    ],
  },
  {
    key: "organ",
    title: "간 · 신장 · 혈액",
    note: "크레아티닌은 콩팥, AST·ALT·γ-GTP 는 간, 혈색소는 빈혈을 봅니다.",
    fields: [
      { name: "ast", label: "AST(SGOT)", kind: "number", unit: "IU/L", min: 1, max: 2000 },
      { name: "alt", label: "ALT(SGPT)", kind: "number", unit: "IU/L", min: 1, max: 2000 },
      { name: "ggt", label: "감마지티피", kind: "number", unit: "IU/L", min: 1, max: 2000 },
      { name: "uric_acid", label: "요산", kind: "number", unit: "mg/dL", min: 0.5, max: 30, step: 0.1 },
      { name: "creatinine", label: "크레아티닌", kind: "number", unit: "mg/dL", min: 0.1, max: 20, step: 0.01 },
      { name: "hemoglobin", label: "혈색소", kind: "number", unit: "g/dL", min: 3, max: 25, step: 0.1 },
      { name: "albumin", label: "알부민", kind: "number", unit: "g/dL", min: 1, max: 7, step: 0.1 },
      { name: "urine_acr", label: "요알부민/크레아티닌비", kind: "number", unit: "mg/g", min: 0, max: 20000 },
    ],
  },
  {
    key: "lifestyle",
    title: "생활습관",
    fields: [
      {
        name: "smoking_status",
        label: "흡연",
        kind: "select",
        options: [
          { value: "never", label: "피운 적 없음" },
          { value: "former", label: "과거에 피움" },
          { value: "current", label: "현재 피움" },
        ],
      },
      { name: "alcohol_days_per_year", label: "연간 음주일", kind: "number", unit: "일", min: 0, max: 365 },
      { name: "moderate_min_per_week", label: "중강도 운동", kind: "number", unit: "분/주", min: 0, max: 5000 },
      { name: "vigorous_min_per_week", label: "고강도 운동", kind: "number", unit: "분/주", min: 0, max: 5000 },
      { name: "sedentary_min_per_day", label: "앉아 있는 시간", kind: "number", unit: "분/일", min: 0, max: 1440 },
      { name: "sleep_hours", label: "수면", kind: "number", unit: "시간", min: 0, max: 24, step: 0.5 },
      { name: "difficulty_walking", label: "걷는 데 불편이 있나", kind: "bool" },
      {
        name: "education_level",
        label: "교육 수준",
        kind: "select",
        options: [
          { value: "1", label: "1 · 중학교 미만" },
          { value: "2", label: "2" },
          { value: "3", label: "3" },
          { value: "4", label: "4" },
          { value: "5", label: "5 · 대졸 이상" },
        ],
      },
    ],
  },
  {
    key: "history",
    title: "진단 이력",
    note: "이미 진단받은 질환은 위험도를 다시 매기지 않습니다.",
    fields: [
      { name: "has_hypertension", label: "고혈압 진단", kind: "bool" },
      { name: "has_diabetes", label: "당뇨 진단", kind: "bool" },
      { name: "has_ascvd_history", label: "심혈관질환 병력", kind: "bool" },
    ],
  },
];

/** 서버가 숫자로 받는 선택 필드. `select` 인데 문자열로 보내면 422 가 된다. */
const NUMERIC_SELECTS = new Set(["self_rated_health", "education_level"]);

export const REQUIRED_FIELDS = FIELD_GROUPS.flatMap((g) => g.fields.filter((f) => f.required).map((f) => f.name));

/**
 * 필드 이름 → 화면 라벨.
 *
 * 경고문이 "필수 1개가 남았습니다"에서 멈추면 사용자는 서른여섯 칸을 눈으로 훑어야
 * 한다. **어느 칸인지 이름으로 말하려면** 이 표가 필요하다.
 */
export const FIELD_LABELS: Record<string, string> = Object.fromEntries(
  FIELD_GROUPS.flatMap((g) => g.fields.map((f) => [f.name, f.label] as const)),
);

/**
 * 화면 상태(전부 문자열)를 요청 본문으로 바꾼다.
 *
 * 빈 문자열은 **키 자체를 빼야** 한다. `null` 이나 `""` 를 보내면 서버가 타입
 * 오류로 422 를 낸다 — 안 낸 검사와 0 은 다른 값이고, DTO 가 그 구분을 지킨다.
 */
export function toRequestBody(values: Record<string, string>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const group of FIELD_GROUPS) {
    for (const field of group.fields) {
      const raw = values[field.name];
      if (raw === undefined || raw === "") continue;
      if (field.kind === "bool") {
        body[field.name] = raw === "true";
      } else if (field.kind === "number" || NUMERIC_SELECTS.has(field.name)) {
        const parsed = Number(raw);
        if (Number.isFinite(parsed)) body[field.name] = parsed;
      } else {
        body[field.name] = raw;
      }
    }
  }
  return body;
}

/** 검사값을 몇 개 넣었나. "넣을수록 칸이 늘어난다"를 화면이 보여줄 재료다. */
export const LAB_FIELDS = [
  "sbp",
  "dbp",
  "fasting_glucose",
  "hba1c",
  "total_chol",
  "hdl",
  "ldl",
  "triglyceride",
  "ast",
  "alt",
  "ggt",
  "uric_acid",
  "creatinine",
  "hemoglobin",
  "albumin",
  "urine_acr",
];

/**
 * 필드명 → 라벨·단위. 인식한 수치를 사람이 읽을 수 있게 보여줄 때 쓴다.
 *
 * `FIELD_GROUPS` 에서 파생시킨다. 따로 적어 두면 라벨을 고칠 때 한쪽만 바뀌고,
 * 그러면 문서 화면과 판정 화면이 같은 값을 다른 이름으로 부르게 된다.
 */
export const FIELD_META: Record<string, { label: string; unit?: string }> = Object.fromEntries(
  FIELD_GROUPS.flatMap((group) => group.fields.map((field) => [field.name, { label: field.label, unit: field.unit }])),
);

/**
 * 질환 카드가 크게 띄울 **근거 수치**.
 *
 * 판정 문장("수축기 혈압 149.0mmHg, 이완기 혈압 90.0mmHg는 '고혈압 1기' 구간에
 * 해당합니다")에서 숫자를 파싱해 오지 않는다. 문장은 서버가 언제든 바꿀 수 있고,
 * 정규식으로 뽑은 숫자는 문구가 바뀌는 날 조용히 사라진다.
 *
 * 대신 **사용자가 방금 그 칸에 넣은 값**을 그대로 보여 준다. 판정의 재료가 곧
 * 그 값이라 어긋날 일이 없고, 화면이 이미 들고 있어서 서버에 더 물을 것도 없다.
 *
 * 값이 없는 질환(ML 이 추정으로 답한 것)은 여기서 아무것도 안 낸다 — 그 카드는
 * 확률을 대신 크게 띄운다.
 */
export const DISEASE_MEASURES: Record<string, string[]> = {
  htn: ["sbp", "dbp"],
  dm: ["fasting_glucose", "hba1c"],
  dlp: ["ldl", "hdl", "triglyceride"],
  hyperchol: ["total_chol", "ldl"],
  hypertg: ["triglyceride"],
  low_hdl: ["hdl"],
  obesity: ["waist_cm"],
  mets: ["waist_cm", "triglyceride", "hdl", "fasting_glucose"],
  ckd: ["creatinine", "urine_acr"],
  fatty_liver: ["waist_cm", "triglyceride", "ggt"],
  liver: ["ast", "alt", "ggt"],
  anemia: ["hemoglobin"],
  uric_acid: ["uric_acid"],
};

/** 라벨 옆에 붙일 단위. 카드가 "149" 만 띄우면 무엇의 149 인지 알 수 없다. */
export const FIELD_UNITS: Record<string, string> = Object.fromEntries(
  FIELD_GROUPS.flatMap((g) => g.fields.filter((f) => f.unit).map((f) => [f.name, f.unit as string] as const)),
);
