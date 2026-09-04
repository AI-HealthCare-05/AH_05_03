import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LocalDomainProvider } from "../../app/LocalDomainProvider";
import { ServerApiError, serverApiClient } from "../../shared/api/serverApiClient";
import { AssessmentPage } from "./AssessmentPage";
import type { AssessmentSummaryData } from "./contracts";
import { FIELD_LABELS, toRequestBody } from "./fields";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/**
 * 화면이 지켜야 하는 것 넷.
 *
 * 1. 필수 다섯 개를 안 채우면 보내지 않는다
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
        medical_level: "주의",
        model_auroc: 0.796,
        accuracy: {
          headline_auroc: 0.796,
          grade: "좋음",
          measured_on: "미진단자",
          alert_ppv: 0.71,
          alert_sensitivity: 0.24,
          holdout_n: 4021,
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


function renderPage(state?: unknown) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: "/assessment", state }]}>
      <LocalDomainProvider databaseName={`ieobom-assess-test-${crypto.randomUUID()}`}>
        <AssessmentPage />
      </LocalDomainProvider>
    </MemoryRouter>,
  );
}

async function fillRequired(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByRole("spinbutton", { name: /나이/ }), "54");
  await user.selectOptions(screen.getByRole("combobox", { name: /성별/ }), "M");
  await user.type(screen.getByRole("spinbutton", { name: /^키/ }), "173");
  await user.type(screen.getByRole("spinbutton", { name: /체중/ }), "78");
  await user.selectOptions(screen.getByRole("combobox", { name: /전반적 건강/ }), "3");
}

describe("AssessmentPage", () => {
  it("필수 다섯 개를 채우기 전에는 보내지 않는다", async () => {
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
    expect(alert).toHaveTextContent(/필수 항목 5개가 비어 있어요/);
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
    expect(screen.getByRole("alert")).toHaveTextContent(/필수 항목 4개가 비어 있어요/);

    await fillRequired(user);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("어느 엔진이 왜 답했는지를 카드에 적는다", async () => {
    const user = userEvent.setup();
    vi.spyOn(serverApiClient, "assessSummary").mockResolvedValue(RESPONSE as never);
    renderPage();

    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: /판정하기/ }));

    const card = (await screen.findByRole("heading", { name: "고혈압" })).closest("article");
    expect(card).not.toBeNull();
    // 훑을 때 보이는 것: 단계 이름과 등급 막대.
    expect(within(card as HTMLElement).getByText("고혈압 1기")).toBeInTheDocument();
    // 카드에는 어느 엔진인지만. 사유는 근거 모달 안이다.
    expect(within(card as HTMLElement).getByText("규칙 엔진")).toBeInTheDocument();
    expect(screen.queryByText(/측정값이 있어 규칙 엔진이 정본입니다/)).not.toBeInTheDocument();

    await user.click(within(card as HTMLElement).getByRole("button", { name: /고혈압 판정 근거/ }));
    const modal = await screen.findByRole("dialog");
    expect(within(modal).getByText(/측정값이 있어 규칙 엔진이 정본입니다/)).toBeInTheDocument();
    expect(within(modal).getByText(/대한고혈압학회 진료지침/)).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

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

    const panel = (await screen.findByRole("region", { name: /먼저 볼 세 가지/ })) as HTMLElement;

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
    expect(within(third).getByText(/자료 범위 밖/)).toBeInTheDocument();

    // 두 숫자의 뜻은 카드마다가 아니라 패널에 한 번만 적는다.
    expect(within(panel).getAllByText(/그 나이에 기준을 넘고 있을 확률/)).toHaveLength(1);
  });

  it("측정이 '기준 이내'라고 답한 카드에는 모델 확률을 덧붙이지 않는다", async () => {
    const user = userEvent.setup();
    // 라벨을 만드는 검사값은 그 질환의 ML 입력에서 차단된다. 그래서 이 모델은
    // 사용자가 넣은 지질 넉 장을 보지 못한 채 74% 를 낸다. 규칙 엔진이 "기준 안에
    // 있어요" 라고 한 카드 밑에 그 숫자가 붙는 것이 패널에서 가장 헷갈리는 지점이었다.
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
          reason: "의심 신호는 없지만 함께 볼 만한 항목이에요.",
          onset_trajectory: null,
          onset_status: "not_applicable",
          prevalence_trajectory: {
            ...RESPONSE.top_suspects[0].prevalence_trajectory,
            current_probability: 0.74,
            prevalence_probability: [0.74, 0.75],
          },
        },
      ],
    };
    vi.spyOn(serverApiClient, "assessSummary").mockResolvedValue(settled as never);
    renderPage();
    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: /판정하기/ }));

    const panel = (await screen.findByRole("region", { name: /의심되는 항목은 없어요/ })) as HTMLElement;
    const card = within(panel).getByRole("heading", { name: /이상지질혈증/ }).closest("article") as HTMLElement;
    expect(within(card).getByText("정상 범위")).toBeInTheDocument();
    expect(within(card).queryByText("74%")).not.toBeInTheDocument();
    expect(within(card).getByText(/검사값이 기준 안에 있어/)).toBeInTheDocument();
  });

  it("발병 궤적이 있는 카드는 앞면에 한 줄, 모달에 동년배와 나란한 표를 그린다", async () => {
    const user = userEvent.setup();
    vi.spyOn(serverApiClient, "assessSummary").mockResolvedValue(RESPONSE as never);
    renderPage();

    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: /판정하기/ }));

    const anemia = (await screen.findByRole("heading", { name: "빈혈" })).closest("article") as HTMLElement;
    // **5년과 10년을 둘 다** 적는다. 마지막 하나만 적으면 "당장은 어떤가" 를 물어볼
    // 자리가 없고 두 숫자 사이의 기울기도 사라진다.
    expect(within(anemia).getByText("새로 생길 확률")).toBeInTheDocument();
    expect(within(anemia).getByText("12%")).toBeInTheDocument();
    expect(within(anemia).getByText("27%")).toBeInTheDocument();
    expect(within(anemia).getByText(/5년 뒤/)).toHaveTextContent("동년배 7%");
    expect(within(anemia).getByText(/10년 뒤/)).toHaveTextContent("동년배 15%");
    // 궤적이 없는 카드에는 그 칸이 없다 — 규칙 엔진이 이미 HIGH 로 판정한 고혈압.
    const htn = screen.getByRole("heading", { name: "고혈압" }).closest("article") as HTMLElement;
    expect(within(htn).queryByText("새로 생길 확률")).not.toBeInTheDocument();

    await user.click(within(anemia).getByRole("button", { name: /빈혈 판정 근거/ }));
    const modal = await screen.findByRole("dialog");
    expect(within(modal).getByText(/앞으로의 발병 가능성/)).toBeInTheDocument();
    expect(within(modal).getByText(/동년배의 1\.8배/)).toBeInTheDocument();
    expect(within(modal).getByRole("img", { name: /누적 발병 확률/ })).toBeInTheDocument();
    const table = within(modal).getByRole("table");
    expect(within(table).getByRole("columnheader", { name: "10년" })).toBeInTheDocument();
    expect(within(table).getAllByRole("cell").map((cell) => cell.textContent)).toEqual(
      expect.arrayContaining(["27%", "15%", "12%", "7%"]),
    );
    expect(within(modal).getByText(/현재 이 질환이 없다는 가정/)).toBeInTheDocument();
  });

  it("근거 모달을 닫으면 열었던 버튼으로 포커스가 돌아온다", async () => {
    const user = userEvent.setup();
    vi.spyOn(serverApiClient, "assessSummary").mockResolvedValue(RESPONSE as never);
    renderPage();

    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: /판정하기/ }));

    const opener = await screen.findByRole("button", { name: /고혈압 판정 근거/ });
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
    await user.type(screen.getByRole("spinbutton", { name: /수축기/ }), "148");
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
    await user.click(await screen.findByRole("button", { name: /고혈압 판정 근거/ }));
    let modal = screen.getByRole("dialog");
    expect(within(modal).getByText(/밀려난 ML 추정/)).toBeInTheDocument();
    expect(within(modal).getByText("80.0%")).toBeInTheDocument();
    // AUROC 를 "정확도"로 읽지 않게 하는 문구가 확률 있는 칸마다 붙는다.
    expect(within(modal).getByText(/100명 중 몇 명을 맞힌다/)).toBeInTheDocument();
    // 경보 적중률이 AUROC 옆에 같이 나온다 — 사용자가 실제로 겪는 값이다.
    expect(within(modal).getByText(/71%/)).toBeInTheDocument();
    await user.keyboard("{Escape}");

    // ML 이 정본인 칸은 "밀려난" 이 아니라 "근거" 로 적는다.
    await user.click(screen.getByRole("button", { name: /빈혈 판정 근거/ }));
    modal = screen.getByRole("dialog");
    expect(within(modal).getByText(/ML 추정 근거/)).toBeInTheDocument();
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
    expect(screen.getByText(/대한고혈압학회 진료지침 · 인과 근거 있음/)).toBeInTheDocument();
  });

  it("교육 수준은 묻지 않는다", () => {
    renderPage();
    expect(screen.queryByText("교육 수준")).not.toBeInTheDocument();
    expect(FIELD_LABELS.education_level).toBeUndefined();
  });

  it("서버가 되돌려준 칸을 빨갛게 세우고 그 칸으로 커서를 옮긴다", async () => {
    const user = userEvent.setup();
    // 검진표에서 읽은 값이 범위를 벗어나 422 가 되는 상황. 사용자는 자기가 적지도
    // 않은 값을 서른 몇 칸에서 찾아야 하므로, 어느 칸인지 말해 주지 않으면 못 고친다.
    vi.spyOn(serverApiClient, "assessSummary").mockRejectedValue(
      new ServerApiError(
        422,
        "VALIDATION_ERROR",
        "hba1c: Input should be less than or equal to 20; hemoglobin: Input should be less than or equal to 25",
      ),
    );
    renderPage();
    await fillRequired(user);
    await user.type(screen.getByRole("spinbutton", { name: /^당화혈색소/ }), "61");
    await user.type(screen.getByRole("spinbutton", { name: /^혈색소/ }), "145");
    await user.click(screen.getByRole("button", { name: /판정하기/ }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/값이 범위를 벗어난 칸이 2개/);
    // 영어 원문이 아니라 **얼마까지 되는지**를 말한다.
    expect(alert).toHaveTextContent(/2~20 % 사이여야 해요/);
    expect(alert).not.toHaveTextContent(/Input should be/);

    const hba1c = screen.getByRole("spinbutton", { name: /^당화혈색소/ });
    expect(hba1c).toHaveAttribute("aria-invalid", "true");
    expect(hba1c).toHaveFocus();
  });

  it("값을 고치면 그 칸의 표시만 즉시 풀린다", async () => {
    const user = userEvent.setup();
    vi.spyOn(serverApiClient, "assessSummary").mockRejectedValue(
      new ServerApiError(
        422,
        "VALIDATION_ERROR",
        "hba1c: Input should be less than or equal to 20; hemoglobin: Input should be less than or equal to 25",
      ),
    );
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
