/**
 * 랜딩페이지가 들려주는 하나의 이야기. **문구와 예시 숫자는 전부 여기 한 곳에 둔다.**
 *
 * 섹션 컴포넌트마다 문구를 박아 두면 같은 사람("나")의 검진 수치가 OCR 장면과
 * 해석 장면에서 서로 달라진다 — 한 화면 안에서 말이 두 번 갈리면 데모가 무너진다
 * (AGENTS.md §2-5 "같은 판단을 두 곳에 복사하지 않는다" 와 같은 이유).
 *
 * ## 이 파일이 mock 데이터가 아닌 이유
 *
 * 여기 있는 값은 **랜딩페이지가 화면에서 보여 주는 예시 시나리오**이고, 앱의 기능이
 * 읽는 데이터가 아니다. 실제 검진 수치·챌린지·가족 기록은 로그인 뒤 서버 정본에서
 * 오며 그 경로는 이 폴더가 건드리지 않는다. 필드 이름(`ldl`·`hba1c` …)과 한글 라벨은
 * `shared/local/recordSummary.ts` 의 정본 라벨과 같은 것을 쓴다 — 랜딩에서 본 이름이
 * 가입 뒤 화면에서 달라지면 그것도 거짓말이다.
 *
 * ## 표현의 선 — 진단하지 않는다
 *
 * 상태는 `정상 / 주의 / 관리 필요` 셋뿐이다. "질환", "진단", "AI 가 발견" 같은 말을
 * 쓰지 않는다. 이어봄은 의료진을 대체하지 않고, 사용자가 자기 수치를 이해하도록
 * 돕는다(docs/22 · docs/31 의 판정 중재 원칙과 같은 선).
 */

export type ValueStatus = "normal" | "watch" | "manage";

export interface LandingValue {
  /** 판정 폼 칸 이름. 앱의 정본 필드명과 같은 것을 쓴다. */
  field: string;
  label: string;
  value: string;
  unit: string;
  status: ValueStatus;
  /** 사용자가 읽는 한 줄. 진단이 아니라 "기준과 견주면 어디쯤" 이다. */
  note: string;
  /** 참고 기준. 숫자 옆에 근거가 없으면 사용자는 그 말을 믿을 수 없다. */
  reference: string;
}

export const STATUS_LABEL: Record<ValueStatus, string> = {
  normal: "정상",
  watch: "주의",
  manage: "관리 필요",
};

/**
 * 검진표 한 장에서 읽히는 여덟 줄. OCR 장면에서 종이 위 행으로,
 * 해석 장면에서 카드로 — **같은 배열**을 두 번 쓴다.
 */
export const LANDING_VALUES: LandingValue[] = [
  {
    field: "ldl",
    label: "LDL 콜레스테롤",
    value: "167",
    unit: "mg/dL",
    status: "manage",
    note: "기준보다 높습니다",
    reference: "기준 130 미만",
  },
  {
    field: "hdl",
    label: "HDL 콜레스테롤",
    value: "48",
    unit: "mg/dL",
    status: "normal",
    note: "기준 안에 있습니다",
    reference: "기준 40 이상",
  },
  {
    field: "triglyceride",
    label: "중성지방",
    value: "212",
    unit: "mg/dL",
    status: "watch",
    note: "기준을 조금 넘었습니다",
    reference: "기준 150 미만",
  },
  {
    field: "fasting_glucose",
    label: "공복혈당",
    value: "108",
    unit: "mg/dL",
    status: "watch",
    note: "기준과 가까이 있습니다",
    reference: "기준 100 미만",
  },
  {
    field: "hba1c",
    label: "당화혈색소",
    value: "5.9",
    unit: "%",
    status: "watch",
    note: "기준과 가까이 있습니다",
    reference: "기준 5.7 미만",
  },
  {
    field: "creatinine",
    label: "크레아티닌",
    value: "0.9",
    unit: "mg/dL",
    status: "normal",
    note: "기준 안에 있습니다",
    reference: "기준 0.5–1.2",
  },
  {
    field: "egfr",
    label: "eGFR",
    value: "94",
    unit: "mL/min",
    status: "normal",
    note: "기준 안에 있습니다",
    reference: "기준 90 이상",
  },
  {
    field: "sbp",
    label: "혈압",
    value: "128/82",
    unit: "mmHg",
    status: "watch",
    note: "기준을 조금 넘었습니다",
    reference: "기준 120/80 미만",
  },
];

/** 해석 장면에서 크게 세우는 한 줄. 여덟 개를 한 번에 보여 주지 않는다. */
export const HEADLINE_VALUE_FIELD = "ldl";

/* ------------------------------------------------------------------ */
/* 3D 인체 장면                                                         */
/* ------------------------------------------------------------------ */

export type BodyMarkerId = "rightKnee" | "leftShoulder" | "abdomen";

export interface BodyScene {
  /** 장면 제목(큰 카피). 한 장면에 메시지는 하나다. */
  headline?: string;
  sub?: string;
  /** 이 장면에서 화면에 뜨는 대화 한 줄. 사용자가 실제로 챗봇에 적는 말투로 둔다. */
  message?: { from: "user" | "bomi"; text: string };
  /** 이 장면까지 몸 위에 남아 있는 기록. 앞 장면의 기록은 사라지지 않는다. */
  markers: BodyMarkerId[];
  /** 정보 패널을 여는 부위. 사용자가 직접 골랐을 때의 장면이다. */
  inspect?: BodyMarkerId;
}

export const BODY_MARKER_LABEL: Record<BodyMarkerId, string> = {
  rightKnee: "오른쪽 무릎",
  leftShoulder: "왼쪽 어깨",
  abdomen: "복부",
};

export const BODY_SCENES: BodyScene[] = [
  {
    headline: "몸이 기억하는 건강까지.",
    sub: "검진표에 적히지 않는 신호가 있습니다.",
    markers: [],
  },
  {
    message: { from: "user", text: "요즘 오른쪽 무릎이 계속 아파요." },
    sub: "대화에서 말한 부위가 몸 위에 남습니다.",
    markers: ["rightKnee"],
  },
  {
    message: { from: "user", text: "어제부터 어깨가 좀 뻐근해요." },
    sub: "앞의 기록은 지워지지 않습니다.",
    markers: ["rightKnee", "leftShoulder"],
  },
  {
    sub: "직접 부위를 골라 기록할 수도 있습니다.",
    markers: ["rightKnee", "leftShoulder", "abdomen"],
    inspect: "abdomen",
  },
  {
    headline: "흩어진 건강 이야기를,\n하나의 몸 위에 이어봅니다.",
    markers: ["rightKnee", "leftShoulder", "abdomen"],
  },
];

/** 복부를 골랐을 때 옆에 뜨는 패널. 증상 기록이지 진단이 아니다. */
export const INSPECT_PANEL = {
  region: "복부",
  countLabel: "최근 불편 기록",
  count: "2건",
  latestLabel: "최근 기록",
  latestText: "식후 더부룩함",
  latestWhen: "3일 전",
} as const;

/* ------------------------------------------------------------------ */
/* 챌린지 · 변화 · 가족                                                  */
/* ------------------------------------------------------------------ */

export interface LandingChallenge {
  id: string;
  title: string;
  detail: string;
  /** 완주 장면에서 보여 줄 값. "6/7" 처럼 보이는 진행 표시의 분모. */
  total: number;
  done: number;
}

export const LANDING_CHALLENGES: LandingChallenge[] = [
  { id: "walk", title: "저녁 식사 후 10분 걷기", detail: "중성지방과 혈당이 함께 움직입니다", total: 7, done: 6 },
  { id: "veggie", title: "채소 한 접시 더하기", detail: "하루 한 끼만 바꿔도 충분합니다", total: 7, done: 5 },
  { id: "sleep", title: "자정 전에 잠들기", detail: "수면은 혈압 기록과 같이 봅니다", total: 7, done: 7 },
];

export interface LandingWeek {
  label: string;
  /** 챌린지 수행률(%). 그래프가 이 값을 따라 그려진다. */
  rate: number;
  /** 같은 주에 남긴 수치 하나. 기록이 쌓이면 수치가 따라 움직인다는 이야기. */
  metricValue: number;
}

/** 변화 장면의 두 줄. 수행률과 공복혈당을 같은 시간축 위에 겹쳐 놓는다. */
export const LANDING_METRIC_LABEL = "공복혈당";
export const LANDING_METRIC_UNIT = "mg/dL";

export const LANDING_WEEKS: LandingWeek[] = [
  { label: "1주차", rate: 43, metricValue: 108 },
  { label: "2주차", rate: 57, metricValue: 104 },
  { label: "3주차", rate: 71, metricValue: 101 },
  { label: "4주차", rate: 86, metricValue: 98 },
];

export interface LandingFamilyMember {
  id: string;
  name: string;
  relation: string;
  /** 요약 한 줄. 가족을 감시하는 화면이 아니라 서로 챙기는 화면이다. */
  summary: string;
  highlightLabel: string;
  highlightValue: string;
  highlightStatus: ValueStatus;
  note: string;
}

export const LANDING_FAMILY: LandingFamilyMember[] = [
  {
    id: "me",
    name: "나",
    relation: "본인 · 34세",
    summary: "4주째 저녁 걷기를 이어가는 중",
    highlightLabel: "공복혈당",
    highlightValue: "98 mg/dL",
    highlightStatus: "normal",
    note: "지난달보다 10 낮아졌습니다",
  },
  {
    id: "mom",
    name: "엄마",
    relation: "어머니 · 62세",
    summary: "혈압을 이틀에 한 번 기록하는 중",
    highlightLabel: "혈압",
    highlightValue: "142/88 mmHg",
    highlightStatus: "watch",
    note: "이번 주 3회 기록, 한 번 더 재면 좋겠습니다",
  },
  {
    id: "dad",
    name: "아빠",
    relation: "아버지 · 65세",
    summary: "검진표를 올린 지 11개월 되었습니다",
    highlightLabel: "다음 검진",
    highlightValue: "D-28",
    highlightStatus: "normal",
    note: "지난 검진표가 저장되어 있어 바로 비교할 수 있습니다",
  },
];

/** 챗봇 장면에서 보여 주는 질문. 전부 "내 기록" 을 향한다. */
export const ASSISTANT_TURNS = [
  {
    question: "지난 검진에서 LDL이 어땠어?",
    answer: "가장 최근 검진표의 LDL은 167 mg/dL 이었어요. 기준(130 미만)보다 높아 관리 대상으로 표시해 두었어요.",
  },
  {
    question: "이번 주 챌린지 얼마나 했어?",
    answer: "이번 주는 7일 중 6일 걷기를 지켰어요. 저녁 걷기는 4주째 이어지고 있습니다.",
  },
  {
    question: "어깨가 아프다고 했던 게 언제였지?",
    answer: "왼쪽 어깨 뻐근함은 3주 전에 처음 말씀하셨고, 그 뒤로 두 번 더 기록되어 있어요.",
  },
] as const;
