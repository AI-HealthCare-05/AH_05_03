import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthContext, type AuthContextValue } from "../../app/authContext";
import { LocalDomainProvider } from "../../app/LocalDomainProvider";
import { ServerApiError, serverApiClient } from "../../shared/api/serverApiClient";
import { AssessmentPage } from "./AssessmentPage";
import type { AssessmentSummaryData } from "./contracts";
import { FIELD_LABELS, toRequestBody } from "./fields";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  // 모듈 바깥에서 만든 스파이는 restoreAllMocks 가 건드리지 않는다.
  markSignedOut.mockClear();
});

/**
 * 화면이 지켜야 하는 것 넷.
 *
 * 1. 필수 칸을 안 채우면 보내지 않는다
 * 2. **어느 엔진이 왜 답했는지가 화면에 있다** — 이게 없으면 검사값을 넣었을 때
 *    숫자가 왜 바뀌었는지 사용자가 알 수 없다
 * 3. 밀려난 ML 확률을 지우지 않는다
 * 4. 매트릭스 축이 별도 섹션으로 그려진다 — 심혈관질환은 그 축에만 있다
 */
const RESPONSE: AssessmentSummaryData = {
  bmi: 26.06,
  summary: {
    evaluated: 2,
    total: 2,
    insufficient: [],
    by_engine: { E1: 1, E2: 1 },
    needs_attention: ["htn"],
    highest_level: "HIGH",
    matrix_evaluated: 1,
    matrix_total: 1,
    matrix_needs_attention: ["cvd_risk"],
  },
  verdicts: [
    {
      key: "htn",
      name: "고혈압",
      engine: "E1",
      engine_label: "규칙 엔진 (국내 학회 임계값)",
      engine_reason: "측정값이 있어 규칙 엔진이 정본입니다. ML 확률은 참고로 내려갑니다.",
      risk_level: "HIGH",
      sub_status: "고혈압 1기",
      display_label: "혈압이 기준을 넘었어요.",
      reason: "수축기 148 mmHg",
      criteria_reference: "대한고혈압학회 진료지침",
      recommendation: "재측정 후에도 같으면 진료를 권합니다.",
      missing_fields: [],
      flags: [],
      superseded_by: "E1",
      reference: {
        probability: 0.7998,
        peer_percentile: 88,
        peer_group: "50대 남성",
        peer_median: 0.62,
        peer_ratio: 1.29,
        medical_level: "주의",
        medical: {
          level: "주의" as const,
          rate: 0.68,
          basis: "대한고혈압학회 기준 '주의' 이상",
          baseline: 0.5,
          lift: 1.36,
          anchored_on_rule_engine: true,
        },
        model_auroc: 0.796,
        tier: "lab",
        accuracy: {
          headline_auroc: 0.796,
          grade: "좋음",
          measured_on: "미진단자",
          auroc: 0.813,
          auroc_undiagnosed: 0.796,
          alert_ppv: 0.71,
          alert_sensitivity: 0.24,
          holdout_n: 4021,
          holdout_cycle: "2021_2023",
        },
        rule_anchor: {
          society: "대한고혈압학회",
          positive_from: "CAUTION",
          rule_positive_rate: 0.68,
          overall_rate: 0.5,
          lift: 1.36,
          sample: 1420,
          levels: {},
        },
        top_factors: [{ feature: "age", contribution: 0.42 }],
      },
      disclaimer: "의료 진단이 아닙니다.",
    },
    {
      key: "anemia",
      name: "빈혈",
      engine: "E2",
      engine_label: "ML 시드 앙상블",
      engine_reason: "측정값이 없어 ML 이 답했습니다.",
      risk_level: "NORMAL",
      sub_status: "선별 추정",
      display_label: "측정값 없이 추정한 값이에요.",
      reason: "이 점수대에서 진단 기준 충족 비율이 8%",
      criteria_reference: "WHO",
      recommendation: "정확히 알려면 해당 검사를 받아 값을 입력해 주세요.",
      missing_fields: ["혈색소"],
      flags: [],
      superseded_by: null,
      reference: {
        probability: 0.0753,
        peer_percentile: 40,
        peer_group: "50대 남성",
        // 실제로는 당뇨·고혈압·신기능에만 붙는다. 여기서는 그리는지만 본다.
        trajectory: {
          horizons_years: [5, 10],
          onset_probability: [0.12, 0.27],
          population_onset_probability: [0.07, 0.15],
          relative_hazard: 1.8,
          reference_prevalence: 0.21,
          conditional_on: "현재 이 질환이 없다는 가정",
          mortality_corrected: true,
          truncated_at_age: null,
          method: "baseline_hazard",
          caveats: ["종단 추적이 아니라 단면 자료의 나이 기울기에서 유도한 추정입니다."],
        },
        trajectory_status: "projected",
      },
      disclaimer: "의료 진단이 아닙니다.",
    },
  ],
  disease_risks: {
    cvd_risk: {
      category: "심혈관질환",
      risk_level: "VERY_HIGH",
      sub_status: "위험 신호 7개 (가중 10점)",
      display_label: "심혈관질환 위험 신호가 많이 겹쳐요.",
      reason: "혈압·지질·혈당이 함께 걸립니다.",
      criteria_reference: "복합 근거",
      recommendation: "진료를 권합니다.",
      missing_fields: [],
      contributors: [
        {
          key: "bp_hypertensive",
          label: "혈압 140/90 이상",
          detail: "수축기 148 mmHg",
          weight: 3,
          effect: "혈압은 뇌졸중·심근경색의 가장 큰 교정 가능 위험인자",
          source: "대한고혈압학회 진료지침",
          causal: true,
        },
      ],
      score: 10,
    },
  },
  top_suspects: [
    {
      target: "htn", name: "고혈압", rank: 1, score: 3.0, suspected: true, probability: 0.7998,
      level: "주의", basis: "측정", peer_ratio: 1.5, evidence_weight: 1.0,
      reason: "입력한 검사값으로 '주의' 판정 · 동년배 중간값의 1.5배 · 이 항목은 장기 추적에서 근거가 확인된 축.",
      prevalence_trajectory: {
        horizons_years: [5, 10],
        prevalence_probability: [0.85, 0.88],
        current_probability: 0.7998, direction: "상승",
        conditional_on: "지금의 수치가 유지된다는 가정", irreversible: true,
        truncated_at_age: null, caveats: ["새로 생길 확률과 다릅니다."],
      },
      onset_trajectory: {
        horizons_years: [5, 10],
        onset_probability: [0.24, 0.42],
        population_onset_probability: [0.2, 0.36],
        relative_hazard: 1.2, reference_prevalence: 0.42,
        conditional_on: "현재 이 질환이 없다는 가정", mortality_corrected: true,
        truncated_at_age: null, method: "baseline_hazard", caveats: ["추정입니다."],
      },
      onset_status: "projected",
    },
    {
      target: "anemia", name: "빈혈", rank: 2, score: 1.0, suspected: true, probability: 0.0753,
      level: "관심", basis: "추정", peer_ratio: 1.1, evidence_weight: 1.0, reason: "검사값 없이 추정한 등급이 '관심'.",
      prevalence_trajectory: {
        horizons_years: [5, 10],
        prevalence_probability: [0.1, 0.13],
        current_probability: 0.0753, direction: "상승",
        conditional_on: "지금의 수치가 유지된다는 가정", irreversible: false,
        truncated_at_age: null, caveats: ["새로 생길 확률과 다릅니다."],
      },
      onset_trajectory: null, onset_status: "not_applicable",
    },
    {
      target: "ckd", name: "만성콩팥병", rank: 3, score: 0.0, suspected: false, probability: 0.05,
      level: "낮음", basis: "추정", peer_ratio: 0.9, evidence_weight: 1.0,
      reason: "의심 신호는 없지만 함께 볼 만한 항목이에요.",
      prevalence_trajectory: null, onset_trajectory: null, onset_status: "below_gate",
    },
  ],
  disclaimers: ["의료 진단이 아닙니다.", "입력한 값은 저장하지 않습니다."],
  inputs_provided: 6,
  inputs_total: 36,
  model_available: true,
};


/**
 * 진짜 `AuthProvider` 를 쓰지 않는 이유: 그쪽은 마운트하자마자 `refresh()` 를 던져
 * 네트워크를 탄다. 이 화면이 auth 에서 쓰는 것은 401 을 만났을 때 부르는
 * `markSignedOut` 하나뿐이라, 그 하나만 지켜보면 된다.
 */
const markSignedOut = vi.fn();

function authValue(): AuthContextValue {
  return {
    status: "signed-in",
    email: "tester@example.com",
    signIn: vi.fn(),
    signOut: vi.fn(),
    markSignedOut,
  };
}

/**
 * `Evidence` 의 큰 숫자는 소수부를 `<small>` 로 쪼개 그린다(예측 데모의 `bigNumber`
 * 를 옮긴 것 — 자릿수가 흔들려도 시선이 정수부에 머문다). 그래서 `getByText("80.0%")`
 * 로는 안 잡힌다. 사용자가 읽는 것은 한 덩어리이므로 내용으로 찾는다.
 */
function bigNumberIn(scope: HTMLElement, text: string) {
  return within(scope).getByText(
    (_, element) => element?.tagName === "STRONG" && element.textContent === text,
  );
}

function renderPage(state?: unknown) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: "/assessment", state }]}>
      <AuthContext.Provider value={authValue()}>
        <LocalDomainProvider databaseName={`ieobom-assess-test-${crypto.randomUUID()}`}>
          <AssessmentPage />
        </LocalDomainProvider>
      </AuthContext.Provider>
    </MemoryRouter>,
  );
}

/** 이미 값이 있는 칸에 이어 붙지 않도록 지우고 넣는다 — "54" 를 두 번 치면 5454 다. */
async function retype(user: ReturnType<typeof userEvent.setup>, name: RegExp, value: string) {
  const input = screen.getByRole("spinbutton", { name });
  await user.clear(input);
  await user.type(input, value);
}

async function fillRequired(user: ReturnType<typeof userEvent.setup>) {
  await retype(user, /나이/, "54");
  await user.selectOptions(screen.getByRole("combobox", { name: /성별/ }), "M");
  await retype(user, /^키/, "173");
  await retype(user, /체중/, "78");
  await user.selectOptions(screen.getByRole("combobox", { name: /전반적 건강/ }), "3");
  // 혈압·공복혈당도 필수다. 검진결과지에서 옮겨 적는 화면이라 이 값들은 거의
  // 항상 손에 있고, 있는 값을 안 받으면 고혈압·당뇨를 추정으로만 답하게 된다.
  await retype(user, /수축기/, "128");
  await retype(user, /이완기/, "82");
  await retype(user, /공복혈당/, "113");
}

describe("AssessmentPage", () => {
  it("필수 칸을 채우기 전에는 보내지 않는다", async () => {
    const user = userEvent.setup();
    const spy = vi.spyOn(serverApiClient, "assessSummary");
    renderPage();

    // 버튼은 잠기지 않는다 — 눌러야 어디가 비었는지 알려 줄 수 있다.
    const button = screen.getByRole("button", { name: /판정하기/ });
    expect(button).toBeEnabled();
    await user.click(button);
    expect(spy).not.toHaveBeenCalled();

    await fillRequired(user);
    expect(button).toBeEnabled();
    expect(spy).not.toHaveBeenCalled();
  });

  it("비어 있는 필수 칸을 이름으로 세우고 첫 칸으로 커서를 옮긴다", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: /판정하기/ }));

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/필수 항목 8개가 비어 있어요/);
    // 몇 개인지가 아니라 **어느 칸인지**를 말한다.
    expect(within(alert).getByRole("button", { name: "전반적 건강" })).toBeInTheDocument();
    // 첫 칸에 커서가 가 있다.
    expect(screen.getByRole("spinbutton", { name: /나이/ })).toHaveFocus();
  });

  it("경고문의 칸 이름을 누르면 그 칸으로 옮겨 간다", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: /판정하기/ }));
    await user.click(within(screen.getByRole("alert")).getByRole("button", { name: "체중" }));

    expect(screen.getByRole("spinbutton", { name: /체중/ })).toHaveFocus();
  });

  it("채우면 경고가 그 칸부터 사라진다", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: /판정하기/ }));
    expect(screen.getByRole("spinbutton", { name: /나이/ })).toHaveAttribute("aria-invalid", "true");

    await user.type(screen.getByRole("spinbutton", { name: /나이/ }), "54");
    expect(screen.getByRole("spinbutton", { name: /나이/ })).not.toHaveAttribute("aria-invalid");
    expect(screen.getByRole("alert")).toHaveTextContent(/필수 항목 7개가 비어 있어요/);

    await fillRequired(user);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("어느 엔진이 왜 답했는지를 카드에 적는다", async () => {
    const user = userEvent.setup();
    vi.spyOn(serverApiClient, "assessSummary").mockResolvedValue(RESPONSE as never);
    renderPage();

    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: /판정하기/ }));

    const card = (await screen.findByRole("heading", { name: "고혈압" })).closest("article") as HTMLElement;
    expect(card).not.toBeNull();
    // 훑을 때 보이는 것: 단계 이름과 등급 막대.
    expect(within(card).getByText("고혈압 1기")).toBeInTheDocument();
    // 앞면의 두 엔진 칸에는 **어느 엔진인지만**. 같은 이름이 접이 안 근거표에도
    // 있으므로 앞면 블록으로 좁혀서 본다.
    const engines = card.querySelector(".assess-engines") as HTMLElement;
    expect(within(engines).getByText("규칙 엔진")).toBeInTheDocument();
    // 사유는 열기 전에는 화면에 없다. 근거는 카드 위에 겹쳐 띄운다 — 격자에서
    // 카드 안으로 펼치면 같은 줄의 다른 카드까지 키가 늘고 아래가 통째로 밀린다.
    expect(screen.queryByText(/측정값이 있어 규칙 엔진이 정본입니다/)).not.toBeInTheDocument();

    await user.click(within(card).getByRole("button", { name: /고혈압 판정 근거 자세히/ }));
    const modal = await screen.findByRole("dialog");
    expect(within(modal).getByText(/측정값이 있어 규칙 엔진이 정본입니다/)).toBeInTheDocument();
    expect(within(modal).getByText(/대한고혈압학회 진료지침/)).toBeInTheDocument();
    await user.keyboard("{Escape}");

    // ML 이 답한 칸은 무엇을 넣으면 정확해지는지 적는다.
    const anemia = screen.getByRole("heading", { name: "빈혈" }).closest("article");
    expect(within(anemia as HTMLElement).getByText(/넣으면 정확해져요/)).toHaveTextContent("혈색소");
  });

  it("먼저 볼 세 가지를 맨 위에 놓고 측정·추정을 구분해 적는다", async () => {
    const user = userEvent.setup();
    vi.spyOn(serverApiClient, "assessSummary").mockResolvedValue(RESPONSE as never);
    renderPage();

    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: /판정하기/ }));

    const panel = (await screen.findByRole("region", { name: /만성질환 발병 예측/ })) as HTMLElement;

    // 1순위는 검사값으로 판정한 것이라 "측정" 이라고 적힌다.
    const first = within(panel).getByRole("heading", { name: /1순위 고혈압/ }).closest("article") as HTMLElement;
    expect(within(first).getByText("측정")).toBeInTheDocument();
    expect(within(first).getByText(/입력한 검사값으로/)).toBeInTheDocument();

    // 지평은 5·10년 둘. 곡선이 아니라 숫자로 읽힌다.
    expect(within(first).getAllByText("5년 뒤").length).toBeGreaterThan(0);
    expect(within(first).getAllByText("10년 뒤").length).toBeGreaterThan(0);
    expect(within(first).getByText("42%")).toBeInTheDocument();
    expect(within(first).getByText(/동년배 36%/)).toBeInTheDocument();

    // 2순위는 검사값 없이 추정한 것이다.
    const second = within(panel).getByRole("heading", { name: /2순위 빈혈/ }).closest("article") as HTMLElement;
    expect(within(second).getByText("추정")).toBeInTheDocument();

    // 3순위는 의심이 아니라 자리를 채운 것이고, 예측이 없으면 그 사실을 적는다.
    const third = within(panel).getByRole("heading", { name: /3순위 만성콩팥병/ }).closest("article") as HTMLElement;
    expect(within(third).getByText(/의심 신호는 없/)).toBeInTheDocument();
    expect(within(third).getByText(/앞으로의 발병 확률을 낼 근거가 아직 없어요/)).toBeInTheDocument();

    // 두 숫자의 뜻은 카드마다가 아니라 패널에 한 번만 적는다.
    expect(within(panel).getAllByText(/그 나이에 기준을 넘고 있을 확률/)).toHaveLength(1);
  });

  it("급한 셋이 전부 이미 넘었어도 나머지 질환의 5년 뒤는 보여준다", async () => {
    const user = userEvent.setup();
    // 카드 세 장은 **급한 순** 셋이다. 그 셋이 전부 이미 기준을 넘은 상태이면
    // 세 장 모두 "지금 넘었어요" 만 적고 앞날 숫자가 하나도 안 남는다 — 실측으로
    // 그런 화면이 나왔고(지질 셋이 전부 '높음'), 제목이 "발병 예측" 인데 예측이
    // 한 줄도 없었다. 순위를 흔들지 않고 나머지 질환의 앞날을 같이 싣는다.
    const response = structuredClone(RESPONSE) as typeof RESPONSE;
    (response.verdicts[0].reference as Record<string, unknown>).prevalence_trajectory = {
      horizons_years: [1, 2, 3, 4, 5],
      prevalence_probability: [0.58, 0.6, 0.62, 0.64, 0.66],
      current_probability: 0.57,
      direction: "상승",
      conditional_on: "지금의 수치가 유지된다는 가정",
      irreversible: false,
      truncated_at_age: null,
      caveats: ["지금 넘었는지와 무관합니다.", "내려가는 구간은 치료 시작 때문입니다.", "NHANES 기준입니다."],
    };
    // 이미 넘어서 서버가 곡선을 지운 칸 하나. 이 자리를 비우면 "그 질환은 어떻게
    // 됐나" 를 사용자가 다시 찾아야 한다.
    const settled = structuredClone(response.verdicts[0]);
    settled.key = "hyperchol";
    settled.name = "고콜레스테롤혈증";
    settled.risk_level = "HIGH";
    delete (settled.reference as Record<string, unknown>).trajectory;
    delete (settled.reference as Record<string, unknown>).prevalence_trajectory;
    response.verdicts.push(settled);

    vi.spyOn(serverApiClient, "assessSummary").mockResolvedValue(response as never);
    renderPage();

    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: /판정하기/ }));

    const outlook = await screen.findByRole("region", { name: /년 뒤/ });
    // **뜻이 다른 둘을 블록으로 가른다.** 한 줄로 정렬하면 동년배보다 낮은 발병
    // 확률이 기준 초과 옆에 나란히 서고, 훑는 사람은 꼬리표보다 순서를 먼저 읽는다.
    expect(within(outlook).getByText(/새로 생길 확률/)).toBeInTheDocument();
    expect(within(outlook).getByText(/기준을 넘고 있을 확률/)).toBeInTheDocument();

    // 유병 줄은 **움직였을 때만** 변화폭을 적는다. 57% -> 66% 라 오른 줄이다.
    const htn = within(outlook).getByText("고혈압").closest("li") as HTMLElement;
    expect(htn).toHaveTextContent("66%");
    expect(htn).toHaveTextContent(/지금 57% → ▲ 9%p/);
    expect(htn.querySelector(".outlook-note.is-up")).not.toBeNull();

    // 발병 줄은 동년배와의 비교가 답이다 — 절대값만으로는 크고 작음을 못 읽는다.
    const anemia = within(outlook).getByText("빈혈").closest("li") as HTMLElement;
    expect(anemia).toHaveTextContent(/동년배 \d+%(보다|와)/);

    // 곡선이 없는 칸도 자리를 지우지 않고 왜 없는지 적는다.
    // 이미 넘은 것은 줄마다 반복하지 않고 한 줄로 묶는다.
    const settledRow = outlook.querySelector(".outlook-settled") as HTMLElement;
    expect(settledRow).toHaveTextContent("앞날 숫자를 내지 않은 1가지");
    expect(settledRow).toHaveTextContent("고콜레스테롤혈증");
    // 그 줄에는 숫자를 적지 않는다 — 라벨 검사값이 ML 입력에서 차단돼 모델이 낮은
    // 값을 내므로, "높음" 배지 밑에 놓으면 어느 쪽을 믿어야 하는지 알 수 없다.
    expect(settledRow.querySelector(".outlook-value")).toBeNull();
    expect(within(outlook).queryAllByText("고콜레스테롤혈증").length).toBe(1);
  });

  it("서버가 지운 곡선을 화면이 되살리지 않는다 — 판단은 한 곳이다", async () => {
    const user = userEvent.setup();
    // 측정과 모델이 서로 반대 방향을 가리키면 서버가 곡선을 지운다
    // (`assessment.model_contradicts_measurement`). 예전에는 화면도 따로 막았는데,
    // 같은 판단이 두 곳에 있으면 한쪽만 고쳐진다 — 실제로 판정과 어긋나지 않는
    // 값(비만 91% · 지방간 66%)까지 화면 쪽 규칙이 같이 지우고 있었다.
    const settled = {
      ...RESPONSE,
      top_suspects: [
        {
          ...RESPONSE.top_suspects[0],
          target: "dlp",
          name: "이상지질혈증",
          rank: 1,
          score: 0,
          suspected: false,
          basis: "측정",
          level: "정상 범위",
          risk_level: "NORMAL",
          reason: "의심 신호는 없지만 함께 볼 만한 항목이에요.",
          onset_trajectory: null,
          onset_status: "not_applicable",
          prevalence_trajectory: null,
        },
      ],
    };
    vi.spyOn(serverApiClient, "assessSummary").mockResolvedValue(settled as never);
    renderPage();
    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: /판정하기/ }));

    const panel = (await screen.findByRole("region", { name: /만성질환 발병 예측/ })) as HTMLElement;
    const card = within(panel).getByRole("heading", { name: /이상지질혈증/ }).closest("article") as HTMLElement;
    expect(within(card).getByText("정상 범위")).toBeInTheDocument();
    expect(within(card).queryByText("74%")).not.toBeInTheDocument();
    expect(within(card).getByText(/검사값이 기준 안에 있어/)).toBeInTheDocument();
  });

  it("서버가 보낸 곡선은 확진 카드에서도 그대로 그린다", async () => {
    const user = userEvent.setup();
    // 이미 넘은 카드라도 모델이 같은 방향을 가리키면 5년 숫자가 배지와 다투지
    // 않는다. 실측으로 비만 91% · 지방간 66% · 대사증후군 58% 가 그 자리다.
    const confirmed = {
      ...RESPONSE,
      top_suspects: [
        {
          ...RESPONSE.top_suspects[0],
          target: "obesity",
          name: "비만",
          rank: 1,
          basis: "측정",
          level: "높음",
          risk_level: "HIGH",
          onset_trajectory: null,
          onset_status: "not_applicable",
          prevalence_trajectory: {
            horizons_years: [1, 2, 3, 4, 5],
            prevalence_probability: [0.91, 0.91, 0.91, 0.91, 0.91],
            current_probability: 0.91,
            direction: "유지",
            conditional_on: "지금의 수치가 유지된다는 가정",
            irreversible: false,
            truncated_at_age: null,
            caveats: ["지금 넘었는지와 무관합니다.", "치료 시작 때문입니다.", "NHANES 기준입니다."],
          },
        },
      ],
    };
    vi.spyOn(serverApiClient, "assessSummary").mockResolvedValue(confirmed as never);
    renderPage();
    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: /판정하기/ }));

    const panel = (await screen.findByRole("region", { name: /만성질환 발병 예측/ })) as HTMLElement;
    const card = within(panel).getByRole("heading", { name: /비만/ }).closest("article") as HTMLElement;
    expect(within(card).getAllByText("91%").length).toBeGreaterThan(0);
    // 숫자를 보여주더라도 "지금 넘었다" 는 사실과 다음 행동은 같이 적는다.
    expect(within(card).getByText(/재측정과 진료 상담/)).toBeInTheDocument();
  });

  it("발병 궤적이 있는 카드는 앞면에 한 줄, 접이에 동년배와 나란한 표를 그린다", async () => {
    const user = userEvent.setup();
    vi.spyOn(serverApiClient, "assessSummary").mockResolvedValue(RESPONSE as never);
    renderPage();

    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: /판정하기/ }));

    const anemia = (await screen.findByRole("heading", { name: "빈혈" })).closest("article") as HTMLElement;
    // **5년과 10년을 둘 다** 적는다. 마지막 하나만 적으면 "당장은 어떤가" 를 물어볼
    // 자리가 없고 두 숫자 사이의 기울기도 사라진다.
    // 같은 숫자가 접이 안 표에도 있으므로 앞면 한 줄로 좁혀서 본다.
    const line = anemia.querySelector(".assess-trajectory-line") as HTMLElement;
    expect(within(line).getByText("새로 생길 확률")).toBeInTheDocument();
    expect(within(line).getByText("12%")).toBeInTheDocument();
    expect(within(line).getByText("27%")).toBeInTheDocument();
    expect(within(line).getByText(/5년 뒤/)).toHaveTextContent("동년배 7%");
    expect(within(line).getByText(/10년 뒤/)).toHaveTextContent("동년배 15%");
    // 궤적이 없는 카드에는 그 칸이 없다 — 규칙 엔진이 이미 HIGH 로 판정한 고혈압.
    const htn = screen.getByRole("heading", { name: "고혈압" }).closest("article") as HTMLElement;
    expect(htn.querySelector(".assess-trajectory-line")).toBeNull();

    await user.click(within(anemia).getByText(/빈혈 판정 근거 자세히/));
    const block = anemia.querySelector("section.assess-trajectory") as HTMLElement;
    expect(within(block).getByText(/앞으로의 발병 가능성/)).toBeInTheDocument();
    expect(within(block).getByText(/동년배의 1\.8배/)).toBeInTheDocument();
    expect(within(block).getByRole("img", { name: /누적 발병 확률/ })).toBeInTheDocument();
    const table = within(block).getByRole("table");
    expect(within(table).getByRole("columnheader", { name: "10년" })).toBeInTheDocument();
    expect(within(table).getAllByRole("cell").map((cell) => cell.textContent)).toEqual(
      expect.arrayContaining(["27%", "15%", "12%", "7%"]),
    );
    expect(within(block).getByText(/현재 이 질환이 없다는 가정/)).toBeInTheDocument();
  });

  it("발병 궤적이 없는 질환에는 '기준 초과 확률' 을 대신 적는다", async () => {
    const user = userEvent.setup();
    // 고혈압에는 발병 궤적이 없고(규칙 엔진이 HIGH 로 판정) 유병 곡선만 있다.
    // 가역·비단조 질환에 누적 발병 곡선을 붙이면 거짓이 되므로 열 질환 중 셋에만
    // 있는데, 그렇다고 나머지 열 장에 앞날이 없어도 되는 것은 아니다.
    const response = structuredClone(RESPONSE) as typeof RESPONSE;
    (response.verdicts[0].reference as Record<string, unknown>).prevalence_trajectory = {
      horizons_years: [5, 10],
      prevalence_probability: [0.62, 0.7],
      current_probability: 0.57,
      direction: "상승",
      conditional_on: "지금의 수치가 유지된다는 가정",
      irreversible: false,
      truncated_at_age: null,
      caveats: ["지금 넘었는지와 무관합니다.", "내려가는 구간은 치료 시작 때문입니다.", "NHANES 기준입니다."],
    };
    vi.spyOn(serverApiClient, "assessSummary").mockResolvedValue(response as never);
    renderPage();

    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: /판정하기/ }));

    const htn = (await screen.findByRole("heading", { name: "고혈압" })).closest("article") as HTMLElement;
    const line = htn.querySelector(".assess-trajectory-line") as HTMLElement;
    // 이름을 섞으면 안 된다 — "새로 생길" 과 "그 나이에 넘고 있을" 은 다른 숫자다.
    expect(within(line).getByText("기준 초과 확률")).toBeInTheDocument();
    expect(within(line).queryByText("새로 생길 확률")).not.toBeInTheDocument();
    expect(line).toHaveTextContent("57%");
    expect(line).toHaveTextContent("70%");
  });

  it("세 지평이 같은 칸에 떨어지면 숫자를 세 번 적지 않는다", async () => {
    const user = userEvent.setup();
    // GBDT 는 나이를 계단으로 쓴다. 19·19·19% 를 그대로 적으면 정보가 없는 자리에서
    // 눈이 "왜 셋이지" 를 해석하게 된다.
    const response = structuredClone(RESPONSE) as typeof RESPONSE;
    (response.verdicts[0].reference as Record<string, unknown>).prevalence_trajectory = {
      horizons_years: [5, 10],
      prevalence_probability: [0.19, 0.19],
      current_probability: 0.19,
      direction: "유지",
      conditional_on: "지금의 수치가 유지된다는 가정",
      irreversible: false,
      truncated_at_age: null,
      caveats: ["지금 넘었는지와 무관합니다.", "내려가는 구간은 치료 시작 때문입니다.", "NHANES 기준입니다."],
    };
    vi.spyOn(serverApiClient, "assessSummary").mockResolvedValue(response as never);
    renderPage();

    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: /판정하기/ }));

    const htn = (await screen.findByRole("heading", { name: "고혈압" })).closest("article") as HTMLElement;
    const line = htn.querySelector(".assess-trajectory-line") as HTMLElement;
    expect(within(line).getAllByText("19%")).toHaveLength(1);
    expect(within(line).getByText(/10년 뒤까지 거의 그대로/)).toBeInTheDocument();
  });

  it("자세히 보기 모달을 닫으면 열었던 버튼으로 포커스가 돌아온다", async () => {
    const user = userEvent.setup();
    vi.spyOn(serverApiClient, "assessSummary").mockResolvedValue(RESPONSE as never);
    renderPage();

    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: /판정하기/ }));

    // 카드마다 있던 근거 모달은 없앴다 — 눌러도 카드 접이와 같은 것이 나왔다.
    // 남은 모달은 화면에 하나뿐인 "예측 근거 자세히 보기" 이고, 포커스 복귀는
    // 그쪽에서 그대로 지킨다.
    const opener = await screen.findByRole("button", { name: "예측 근거 자세히 보기" });
    await user.click(opener);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "닫기" }));

    // 안 돌려주면 키보드 사용자는 탭을 처음부터 다시 밟아야 한다.
    expect(opener).toHaveFocus();
  });

  it("검사값을 넣은 카드는 그 수치를, 추정한 카드는 확률을 크게 띄운다", async () => {
    const user = userEvent.setup();
    vi.spyOn(serverApiClient, "assessSummary").mockResolvedValue(RESPONSE as never);
    renderPage();

    await fillRequired(user);
    await retype(user, /수축기/, "148");
    await user.click(screen.getByRole("button", { name: /판정하기/ }));

    // 고혈압은 값을 넣었으므로 그 값을 그대로 보여 준다 — 판정 문장에서 뽑아 오지 않는다.
    const htn = (await screen.findByRole("heading", { name: "고혈압" })).closest("article");
    expect(within(htn as HTMLElement).getByText("148")).toBeInTheDocument();

    // 빈혈은 혈색소를 안 넣었으므로 추정 확률을 띄운다. `~` 가 추정임을 알린다.
    const anemia = screen.getByRole("heading", { name: "빈혈" }).closest("article");
    expect(within(anemia as HTMLElement).getByText(/^~\d+%$/)).toBeInTheDocument();
  });

  it("밀려난 ML 확률을 지우지 않는다", async () => {
    const user = userEvent.setup();
    vi.spyOn(serverApiClient, "assessSummary").mockResolvedValue(RESPONSE as never);
    renderPage();

    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: /판정하기/ }));

    // 규칙이 정본이라 밀려난 칸.
    const htn = (await screen.findByRole("heading", { name: "고혈압" })).closest("article") as HTMLElement;
    await user.click(within(htn).getByText(/고혈압 판정 근거 자세히/));
    expect(within(htn).getByText(/밀린 ML 예측/)).toBeInTheDocument();
    expect(bigNumberIn(htn, "80.0%")).toBeInTheDocument();
    // AUROC 를 "정확도"로 읽지 않게 하는 문구가 확률 있는 칸마다 붙는다.
    expect(within(htn).getByText(/100명 중 몇 명을 맞힌다/)).toBeInTheDocument();
    // 경보 적중률이 AUROC 옆에 같이 나온다 — 사용자가 실제로 겪는 값이다.
    expect(within(htn).getByText(/71%/)).toBeInTheDocument();

    // ML 이 정본인 칸은 "밀려난" 이라고 적지 않는다. 그 한 단어가 "이 숫자를 읽어도
    // 되는가" 를 가르므로, 두 경우의 문구가 섞이면 안 된다.
    const anemia = screen.getByRole("heading", { name: "빈혈" }).closest("article") as HTMLElement;
    await user.click(within(anemia).getByText(/빈혈 판정 근거 자세히/));
    expect(within(anemia).getByText(/ML 시드 앙상블/)).toBeInTheDocument();
    expect(within(anemia).queryByText(/밀린 ML 예측/)).not.toBeInTheDocument();
  });

  it("구성원이 없으면 기록 대신 등록을 안내한다", async () => {
    const user = userEvent.setup();
    vi.spyOn(serverApiClient, "assessSummary").mockResolvedValue(RESPONSE as never);
    renderPage();

    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: /판정하기/ }));
    await screen.findByRole("heading", { name: "고혈압" });

    // 판정은 보여주되 시점을 이을 자리가 없다는 것을 말해야 한다. 버튼만 비활성으로
    // 두면 사용자는 왜 못 누르는지 모른다.
    expect(screen.getByText(/구성원을 등록해 주세요/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /이 시점을 기록에 남기기/ })).not.toBeInTheDocument();
    // 시점이 없으니 대시보드 자체가 안 나온다.
    expect(screen.queryByRole("heading", { name: /추적 대시보드/ })).not.toBeInTheDocument();
  });

  it("다시 판정하면 지난 저장 안내를 지운다", async () => {
    const user = userEvent.setup();
    vi.spyOn(serverApiClient, "assessSummary").mockResolvedValue(RESPONSE as never);
    renderPage();

    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: /판정하기/ }));
    await screen.findByRole("heading", { name: "고혈압" });

    // 저장 안내가 남아 있으면 방금 판정한 것이 저장된 줄로 읽힌다.
    expect(screen.queryByText(/기록에 남겼습니다/)).not.toBeInTheDocument();
    await user.clear(screen.getByRole("spinbutton", { name: /나이/ }));
    await user.type(screen.getByRole("spinbutton", { name: /나이/ }), "61");
    await user.click(screen.getByRole("button", { name: /판정하기/ }));
    expect(screen.queryByText(/기록에 남겼습니다/)).not.toBeInTheDocument();
  });

  it("매트릭스 축을 별도 섹션으로 그리고 근거 출처를 적는다", async () => {
    const user = userEvent.setup();
    vi.spyOn(serverApiClient, "assessSummary").mockResolvedValue(RESPONSE as never);
    renderPage();

    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: /판정하기/ }));

    expect(await screen.findByRole("heading", { name: /수치가 가리키는 앞날/ })).toBeInTheDocument();
    // 심혈관질환은 열세 칸에 없고 이 축에만 있다.
    expect(screen.getByRole("heading", { name: "심혈관질환" })).toBeInTheDocument();
    expect(screen.getByText("혈압 140/90 이상")).toBeInTheDocument();

    // **출처와 인과 여부는 접이 안이다.** 신호마다 네 줄을 항상 펼쳐 두면 카드
    // 하나가 스무 줄이 된다 — 근거를 확인하러 온 사람만 연다.
    const signal = screen.getByText("혈압 140/90 이상").closest("li") as HTMLElement;
    expect(within(signal).getByText("인과")).toBeInTheDocument();
    await user.click(within(signal).getByText("근거"));
    expect(within(signal).getByText(/대한고혈압학회 진료지침/)).toBeInTheDocument();

    // 무게는 색이 아니라 형태로도 읽힌다 — 낭독기에는 숫자로 나간다.
    expect(within(signal).getByText("가중 3 / 3")).toBeInTheDocument();
  });

  it("교육 수준은 묻지 않는다", () => {
    renderPage();
    expect(screen.queryByText("교육 수준")).not.toBeInTheDocument();
    expect(FIELD_LABELS.education_level).toBeUndefined();
  });

  it("서버가 되돌려준 칸을 빨갛게 세우고 그 칸으로 커서를 옮긴다", async () => {
    const user = userEvent.setup();
    // **화면 검사를 통과한 값**이어야 요청이 실제로 나간다. 서버가 화면보다 좁게
    // 볼 수 있으므로(교차 검사·범위 조정) 이 경로는 따로 살아 있어야 한다.
    const assess = vi.spyOn(serverApiClient, "assessSummary").mockRejectedValue(
      new ServerApiError(
        422,
        "VALIDATION_ERROR",
        "hba1c: Input should be less than or equal to 20; hemoglobin: Input should be less than or equal to 25",
      ),
    );
    renderPage();
    await fillRequired(user);
    await user.type(screen.getByRole("spinbutton", { name: /^당화혈색소/ }), "6.1");
    await user.type(screen.getByRole("spinbutton", { name: /^혈색소/ }), "14.5");
    await user.click(screen.getByRole("button", { name: /판정하기/ }));

    expect(assess).toHaveBeenCalledTimes(1);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/값이 범위를 벗어난 칸이 2개/);
    // 영어 원문이 아니라 **얼마까지 되는지**를 말한다.
    expect(alert).toHaveTextContent(/2~20 % 사이여야 해요/);
    expect(alert).not.toHaveTextContent(/Input should be/);

    const hba1c = screen.getByRole("spinbutton", { name: /^당화혈색소/ });
    expect(hba1c).toHaveAttribute("aria-invalid", "true");
    expect(hba1c).toHaveFocus();
  });

  it("범위를 벗어난 값은 서버에 묻지 않고 그 자리에서 세운다", async () => {
    const user = userEvent.setup();
    // 판정 API 는 인증을 요구한다. 세션이 풀려 있으면 422 대신 401 이 먼저 와서
    // 어느 칸이 틀렸는지 끝내 못 말했다 — 그래서 보내기 전에 화면이 먼저 본다.
    const assess = vi.spyOn(serverApiClient, "assessSummary");
    renderPage();
    await fillRequired(user);
    await user.type(screen.getByRole("spinbutton", { name: /^당화혈색소/ }), "61");
    await user.type(screen.getByRole("spinbutton", { name: /^혈색소/ }), "145");
    await user.click(screen.getByRole("button", { name: /판정하기/ }));

    expect(assess).not.toHaveBeenCalled();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/값이 범위를 벗어난 칸이 2개/);
    expect(alert).toHaveTextContent(/2~20 % 사이여야 해요/);

    const hba1c = screen.getByRole("spinbutton", { name: /^당화혈색소/ });
    expect(hba1c).toHaveAttribute("aria-invalid", "true");
    expect(hba1c).toHaveFocus();
  });

  it("칸을 떠나는 순간 그 칸만 붉어진다 — 판정을 누를 필요가 없다", async () => {
    const user = userEvent.setup();
    renderPage();

    const sbp = screen.getByRole("spinbutton", { name: /수축기/ });
    await user.type(sbp, "999");
    // 치는 동안에는 조용하다. 120 을 향해 가는 "1" 이 매번 빨개지면 안 된다.
    expect(sbp).not.toHaveAttribute("aria-invalid");

    await user.tab();
    expect(sbp).toHaveAttribute("aria-invalid", "true");
    // 칸 옆에 붙는 안내. 위쪽 요약에도 같은 문구가 있어 id 로 집는다.
    expect(document.getElementById("sbp-range")).toHaveTextContent(
      /60~260 mmHg 사이여야 해요/,
    );
  });

  it("값을 고치면 그 칸의 표시만 즉시 풀린다", async () => {
    const user = userEvent.setup();
    renderPage();
    await fillRequired(user);
    await user.type(screen.getByRole("spinbutton", { name: /^당화혈색소/ }), "61");
    await user.type(screen.getByRole("spinbutton", { name: /^혈색소/ }), "145");
    await user.click(screen.getByRole("button", { name: /판정하기/ }));

    const hba1c = screen.getByRole("spinbutton", { name: /^당화혈색소/ });
    await user.clear(hba1c);
    await user.type(hba1c, "6.1");

    expect(hba1c).not.toHaveAttribute("aria-invalid");
    // 아직 안 고친 칸은 그대로 남는다.
    expect(screen.getByRole("spinbutton", { name: /^혈색소/ })).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/칸이 1개/);
  });

  it("세션이 풀렸으면 토큰 사정이 아니라 로그인하라고 말한다", async () => {
    const user = userEvent.setup();
    // 서버가 실제로 내는 문구. 그대로 띄우면 사용자가 할 일을 알 수 없다.
    vi.spyOn(serverApiClient, "assessSummary").mockRejectedValue(
      new ServerApiError(401, "TOKEN_INVALID", "Refresh Token 쿠키가 필요합니다."),
    );
    renderPage();
    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: /판정하기/ }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/로그인이 필요합니다/);
    expect(alert).not.toHaveTextContent(/Refresh Token/);
    // 관문에도 알린다 — `RootLayout` 이 로그인 화면으로 바꿔 그린다.
    expect(markSignedOut).toHaveBeenCalledTimes(1);
  });

  it("혈압과 공복혈당이 없으면 판정을 보내지 않는다", async () => {
    const user = userEvent.setup();
    const assess = vi.spyOn(serverApiClient, "assessSummary");
    renderPage();

    // 예전의 "필수 다섯" 만 채운 상태.
    await retype(user, /나이/, "54");
    await user.selectOptions(screen.getByRole("combobox", { name: /성별/ }), "M");
    await retype(user, /^키/, "173");
    await retype(user, /체중/, "78");
    await user.selectOptions(screen.getByRole("combobox", { name: /전반적 건강/ }), "3");
    await user.click(screen.getByRole("button", { name: /판정하기/ }));

    expect(assess).not.toHaveBeenCalled();
    const alert = screen.getByRole("alert");
    expect(within(alert).getByRole("button", { name: "수축기" })).toBeInTheDocument();
    expect(within(alert).getByRole("button", { name: "이완기" })).toBeInTheDocument();
    expect(within(alert).getByRole("button", { name: "공복혈당" })).toBeInTheDocument();
  });
});

describe("toRequestBody", () => {
  it("빈 값은 키 자체를 뺀다", () => {
    const body = toRequestBody({ age: "54", sex: "M", sbp: "", hba1c: "6.1" });
    expect(body).toEqual({ age: 54, sex: "M", hba1c: 6.1 });
    expect("sbp" in body).toBe(false);
  });

  it("숫자로 받는 select 는 숫자로 보낸다", () => {
    // `self_rated_health` 를 문자열로 보내면 서버가 422 를 낸다.
    expect(toRequestBody({ self_rated_health: "3" })).toEqual({ self_rated_health: 3 });
    expect(toRequestBody({ smoking_status: "current" })).toEqual({ smoking_status: "current" });
  });

  it("불리언은 참·거짓으로 바꾼다", () => {
    expect(toRequestBody({ has_diabetes: "false" })).toEqual({ has_diabetes: false });
  });
});

describe("건강자료에서 넘어온 수치", () => {
  it("판정 폼에 미리 채워지고, 몇 개인지 알려 준다", () => {
    renderPage({ prefill: { fasting_glucose: 113, hdl: 52, sbp: 128 } });

    expect(screen.getByRole("spinbutton", { name: /공복혈당/ })).toHaveValue(113);
    expect(screen.getByRole("spinbutton", { name: /^HDL/ })).toHaveValue(52);
    expect(screen.getByRole("spinbutton", { name: /수축기/ })).toHaveValue(128);
    // 사용자가 "이건 내가 안 적었는데" 하고 놀라지 않도록 출처를 밝힌다.
    expect(screen.getByText(/건강자료에서 읽은 수치/)).toBeInTheDocument();
  });

  it("지난 기록에서 넘어왔으면 그 사실을 밝히고, 숫자 아닌 값도 채운다", () => {
    // `sex` 를 못 받으면 필수 다섯 중 하나가 비어 값이 다 있는데도 경고부터 뜬다.
    renderPage({
      prefill: { age: 54, sex: "M", sbp: 128, has_diabetes: false },
      prefillSource: "record",
    });

    expect(screen.getByRole("combobox", { name: /성별/ })).toHaveValue("M");
    expect(screen.getByRole("spinbutton", { name: /나이/ })).toHaveValue(54);
    expect(screen.getByRole("combobox", { name: /당뇨 진단/ })).toHaveValue("false");
    expect(screen.getByText(/지난 기록의 값/)).toBeInTheDocument();
    expect(screen.queryByText(/건강자료에서 읽은 수치/)).not.toBeInTheDocument();
  });

  it("넘어온 수치가 없으면 안내도 없다", () => {
    renderPage();
    expect(screen.queryByText(/건강자료에서 읽은 수치/)).not.toBeInTheDocument();
  });

  it("숫자가 아닌 값은 채우지 않는다", () => {
    // 서버는 관문에 걸린 행의 값을 NaN 으로 내보낸다. 그게 폼에 들어가면 안 된다.
    renderPage({ prefill: { fasting_glucose: Number.NaN, hdl: 52 } });

    expect(screen.getByRole("spinbutton", { name: /공복혈당/ })).toHaveValue(null);
    expect(screen.getByRole("spinbutton", { name: /^HDL/ })).toHaveValue(52);
  });
});

/**
 * 예측 데모(`/api/demo`)를 이 화면으로 합쳤다. 지켜야 하는 것 셋.
 *
 * 1. 프리셋을 누르면 **필수 칸이 다 차서 곧바로 판정할 수 있다** — 데모의 쓸모 절반이
 *    수치 34칸을 손으로 안 채우는 것이었고, 필수 칸 하나가 비면 그 쓸모가 없어진다
 * 2. **누른 것만으로 채점하지 않는다** — 프로필을 고른 뒤 몇 칸 고쳐 보는 것이
 *    쓰임새인데, 자동으로 돌면 고치기 전 결과가 먼저 떠서 헷갈린다
 * 3. 결과에 **자세히 보기가 있고** 데모가 보여주던 게이지·정확도·안 쓴 입력이 나온다
 */
describe("테스트 프로필과 자세히 보기", () => {
  it("프리셋을 누르면 필수 칸이 전부 차고, 채점은 하지 않는다", async () => {
    const user = userEvent.setup();
    const call = vi.spyOn(serverApiClient, "assessSummary");
    renderPage();

    await user.click(screen.getByRole("button", { name: "당뇨" }));

    expect(screen.getByRole("spinbutton", { name: /나이/ })).toHaveValue(52);
    expect(screen.getByRole("combobox", { name: /성별/ })).toHaveValue("M");
    expect(screen.getByRole("spinbutton", { name: /^키/ })).toHaveValue(172);
    expect(screen.getByRole("spinbutton", { name: /체중/ })).toHaveValue(84);
    expect(screen.getByRole("combobox", { name: /전반적 건강/ })).toHaveValue("4");
    // 이 프로필이 노리는 값
    expect(screen.getByRole("spinbutton", { name: /공복혈당/ })).toHaveValue(148);
    // 필수를 다 채웠어도 서버를 부르지 않는다.
    expect(call).not.toHaveBeenCalled();
    expect(screen.queryByText("판정 요약")).not.toBeInTheDocument();
  });

  it("프리셋은 앞 프리셋의 값을 남기지 않는다 — 섞인 사람이 만들어지면 안 된다", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: "당뇨" }));
    expect(screen.getByRole("spinbutton", { name: /공복혈당/ })).toHaveValue(148);

    await user.click(screen.getByRole("button", { name: "고혈압" }));
    // 고혈압 프로필은 혈당을 건드리지 않는다 → 기본값으로 되돌아가야 한다.
    expect(screen.getByRole("spinbutton", { name: /공복혈당/ })).toHaveValue(92);
    expect(screen.getByRole("spinbutton", { name: /수축기/ })).toHaveValue(158);
  });

  it("고른 프로필이 무엇을 노리는지 화면에 적는다", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: "고혈압" }));

    expect(screen.getByText(/혈압은 고혈압 라벨을 정의하므로 ML 입력에서 차단/)).toBeInTheDocument();
  });

  it("결과의 자세히 보기가 게이지·정확도·안 쓴 입력을 보여준다", async () => {
    const user = userEvent.setup();
    vi.spyOn(serverApiClient, "assessSummary").mockResolvedValue(RESPONSE);
    // 모델 입력 목록. `htn` 이 혈압을 받지 않는다는 사실이 화면에 나와야 한다.
    vi.spyOn(serverApiClient, "modelInfo").mockResolvedValue({
      models: [
        {
          target: "htn",
          tier: "lab",
          required_inputs: ["age", "sex", "bmi", "self_rated_health"],
          optional_inputs: ["waist_cm"],
        },
      ],
    });
    renderPage();

    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: "판정하기" }));
    await screen.findByText("판정 요약");

    await user.click(screen.getByRole("button", { name: "예측 근거 자세히 보기" }));

    const dialog = await screen.findByRole("dialog");
    // 의학 기준 비율과 그 뜻
    expect(within(dialog).getByText(/이 점수대의/)).toBeInTheDocument();
    // 정확도 줄 — AUROC 한 숫자만 두지 않는다
    expect(within(dialog).getByText(/상위 10% 경보 적중/)).toBeInTheDocument();
    expect(within(dialog).getByText(/AUROC 는 "100명 중 몇 명을 맞힌다"가 아닙니다/)).toBeInTheDocument();
    // 학회 기준 대조 (rule_anchor). `medical.basis` 도 같은 학회명을 쓰므로
    // 앵커에만 있는 문구로 찾는다.
    expect(within(dialog).getByText(/실제로 검사했을 때/)).toBeInTheDocument();
    // 등급 코드를 그대로 띄우지 않는다.
    expect(within(dialog).queryByText(/CAUTION/)).not.toBeInTheDocument();

    // 모델이 받고도 쓰지 않은 입력. 혈압을 넣었는데 htn 모델은 안 쓴다.
    // **개요 화면에서는 접지 않는다** — 여기까지 들어온 사람은 근거를 보러 온 것이고,
    // 접이는 카드 쪽에 있다(`VerdictCard` 의 `assess-card-evidence`).
    expect(within(dialog).getByText(/고혈압 모델이 쓰지 않은 입력/)).toBeInTheDocument();
    // 타일 배지는 카드와 같은 5단계다. 의학 4단계('주의')를 배지로 쓰면 측정과 부딪힌다.
    expect(within(dialog).getAllByText("높음").length).toBeGreaterThan(0);
  });

  it("질환마다 더 넣으면 무엇이 좋아지는지 카드에 적는다", async () => {
    const user = userEvent.setup();
    vi.spyOn(serverApiClient, "assessSummary").mockResolvedValue(RESPONSE);
    vi.spyOn(serverApiClient, "modelInfo").mockResolvedValue({
      models: [
        {
          target: "htn",
          tier: "lab",
          required_inputs: ["age", "sex", "bmi", "self_rated_health"],
          optional_inputs: ["waist_cm", "uric_acid"],
        },
      ],
    });
    renderPage();

    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: "판정하기" }));
    await screen.findByText("판정 요약");

    // 고혈압은 규칙 엔진이 이미 단계까지 답했다(`missing_fields` 가 비어 있다).
    // 그래도 ML 쪽에 안 넣은 입력이 남아 있으면 그 사실을 적는다 — 예전에는 판정이
    // 난 카드에 아무 줄도 안 떠서 "더 넣을 게 없다" 로 읽혔다.
    const htn = screen.getByRole("heading", { name: "고혈압", level: 3 }).closest("article") as HTMLElement;
    const refining = within(htn).getByText(/넣으면 예측이 정밀해져요/);
    expect(refining).toHaveTextContent("허리둘레");
    expect(refining).toHaveTextContent("요산");
    // 목적격 조사는 받침을 보고 고른다 — `요산를` 이 아니라 `요산을`.
    expect(refining.textContent).toContain("요산을 넣으면");

    // 두 줄은 뜻이 다르다 — 위는 등급이 바뀔 수 있고 아래는 확률만 정밀해진다.
    // 빈혈은 위 목록에 번들이 없으므로 아래 줄이 붙지 않는다.
    const anemia = screen.getByRole("heading", { name: "빈혈", level: 3 }).closest("article") as HTMLElement;
    expect(within(anemia).getByText(/넣으면 정확해져요/)).toHaveTextContent("혈색소");
    expect(within(anemia).queryByText(/넣으면 예측이 정밀해져요/)).not.toBeInTheDocument();
  });

  it("모델 정보를 못 받아도 나머지 근거는 나온다", async () => {
    const user = userEvent.setup();
    vi.spyOn(serverApiClient, "assessSummary").mockResolvedValue(RESPONSE);
    vi.spyOn(serverApiClient, "modelInfo").mockRejectedValue(new Error("boom"));
    renderPage();

    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: "판정하기" }));
    await screen.findByText("판정 요약");
    await user.click(screen.getByRole("button", { name: "예측 근거 자세히 보기" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/이 점수대의/)).toBeInTheDocument();
    // 없는 것을 없다고 말할 수 없을 뿐이다 — 그 블록만 빠진다.
    expect(within(dialog).queryByText(/쓰지 않은 입력/)).not.toBeInTheDocument();
  });
});

/**
 * 세 자리가 같은 것을 보여준다 — 예측 데모를 카드로 옮기면서 세운 계약.
 *
 * 옮기기 전 실측(52세 남 · 118/74 · 이상지질 프리셋)에서 고혈압 하나가 이렇게
 * 나왔다: 판정 카드 **정상** · 자세히 보기 **주의** · 먼저 볼 세 가지 **정상 범위**.
 * 숫자도 27.1% / 50.2% / 11.4% 로 셋이었다. 배지를 `risk_level` 하나로 못 박고
 * ML 값은 `Evidence` 한 컴포넌트가 두 자리에 같은 것을 내게 해서 닫았다.
 */
describe("카드와 자세히 보기가 같은 것을 보여준다", () => {
  it("카드의 근거를 열면 게이지·앵커·정확도가 한자리에 선다", async () => {
    const user = userEvent.setup();
    vi.spyOn(serverApiClient, "assessSummary").mockResolvedValue(RESPONSE as never);
    vi.spyOn(serverApiClient, "modelInfo").mockResolvedValue({ models: [] });
    renderPage();

    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: "판정하기" }));
    await screen.findByText("판정 요약");

    // 규칙이 정본인 칸이라 "밀려난" 이라고 적는다.
    await user.click(screen.getByRole("button", { name: "고혈압 판정 근거 자세히" }));

    // 접이 때와 **같은 컴포넌트 넷**을 그린다. 자리만 카드 위로 옮겼다.
    const modal = await screen.findByRole("dialog");
    expect(within(modal).getByText(/이 점수대의/)).toBeInTheDocument();
    expect(within(modal).getByText(/실제로 검사했을 때/)).toBeInTheDocument();
    expect(within(modal).getByText(/상위 10% 경보 적중/)).toBeInTheDocument();
  });

  it("카드 배지와 자세히 보기 배지가 같은 등급이다", async () => {
    const user = userEvent.setup();
    vi.spyOn(serverApiClient, "assessSummary").mockResolvedValue(RESPONSE as never);
    vi.spyOn(serverApiClient, "modelInfo").mockResolvedValue({ models: [] });
    renderPage();

    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: "판정하기" }));
    await screen.findByText("판정 요약");

    // 카드: 고혈압은 규칙 엔진이 HIGH 를 줬다.
    // `header` 안의 배지만 본다 — `LevelBar` 가 네 구간을 항상 그려서 "높음" 이
    // 구간 이름으로도 나온다.
    const heading3 = screen.getByRole("heading", { name: "고혈압", level: 3 });
    expect(within(heading3.parentElement as HTMLElement).getByText("높음")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "예측 근거 자세히 보기" }));
    const dialog = await screen.findByRole("dialog");

    // 자세히 보기: 같은 5단계 배지. 의학 4단계('주의')를 배지로 쓰지 않는다 —
    // 그 값은 집단 통계라 실측 118/74 인 사람과 부딪힌다.
    // 제목 안의 배지만 본다. `LevelBar` 가 네 칸을 항상 그려서 "높음" 이라는 글자가
    // 구간 이름으로도 한 번 더 나온다.
    const heading = within(dialog).getByRole("heading", { name: /고혈압/, level: 4 });
    expect(within(heading).getByText("높음")).toBeInTheDocument();
    // 의학 4단계가 배지로 새지 않았는지. `assess-badge` 클래스를 단 '주의' 가 없어야 한다.
    const section = heading.closest("section") as HTMLElement;
    expect(
      [...section.querySelectorAll(".assess-badge")].map((el) => el.textContent),
    ).not.toContain("주의");
  });

  it("엔진 태그가 카드 앞면에 있다 — 무엇이 이 등급을 정했는지 열지 않고 안다", async () => {
    const user = userEvent.setup();
    vi.spyOn(serverApiClient, "assessSummary").mockResolvedValue(RESPONSE as never);
    vi.spyOn(serverApiClient, "modelInfo").mockResolvedValue({ models: [] });
    renderPage();

    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: "판정하기" }));
    await screen.findByText("판정 요약");

    // 접이 안 근거표에도 같은 엔진 이름이 있으므로 앞면 블록으로 좁혀서 본다.
    const card = screen.getByRole("heading", { name: "고혈압", level: 3 }).closest("article") as HTMLElement;
    const engines = card.querySelector(".assess-engines") as HTMLElement;
    expect(within(engines).getByText("규칙 엔진")).toBeInTheDocument();
    const anemia = screen.getByRole("heading", { name: "빈혈", level: 3 }).closest("article") as HTMLElement;
    const anemiaEngines = anemia.querySelector(".assess-engines") as HTMLElement;
    // ML 이 정본인 칸에서는 엔진 이름을 두 번 쓰지 않는다 — 왼쪽이 이미 "ML 예측"
    // 이라 `ML 예측 8% → ML 예측 …` 이 됐다. 오른쪽은 "판정" 하나다.
    expect(within(anemiaEngines).getAllByText("ML 예측")).toHaveLength(1);
    expect(within(anemiaEngines).getByText("판정")).toBeInTheDocument();
    // 확률이 카드 앞면에 보인다 — 접이를 열지 않아도 모델이 무엇을 말했는지 안다.
    expect(within(anemiaEngines).getByText("8%")).toBeInTheDocument();
  });
});

describe("수치가 가리키는 앞날 카드", () => {
  it("옛 저장본의 내부 키도 읽을 수 있는 제목으로 그린다", async () => {
    const user = userEvent.setup();
    // 서버가 `category` 에 키를 넣던 판의 응답. 기록 화면이 그리는 저장본이 이 모양이다.
    vi.spyOn(serverApiClient, "assessSummary").mockResolvedValue({
      ...RESPONSE,
      disease_risks: {
        cvd_risk: { ...RESPONSE.disease_risks.cvd_risk, category: "cvd_risk" },
      },
    } as never);
    vi.spyOn(serverApiClient, "modelInfo").mockResolvedValue({ models: [] });
    renderPage();

    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: "판정하기" }));
    await screen.findByText("판정 요약");

    expect(screen.getByRole("heading", { name: "심혈관질환 위험", level: 3 })).toBeInTheDocument();
    expect(screen.queryByText("cvd_risk")).not.toBeInTheDocument();
  });
});
