import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LocalDomainProvider } from "../../app/LocalDomainProvider";
import { serverApiClient } from "../../shared/api/serverApiClient";
import { AssessmentPage } from "./AssessmentPage";
import type { AssessmentSummaryData } from "./contracts";
import { toRequestBody } from "./fields";

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
      reference: { probability: 0.0753, peer_percentile: 40, peer_group: "50대 남성" },
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
