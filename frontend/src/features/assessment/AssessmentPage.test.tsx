import { useEffect, useRef, useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthContext, type AuthContextValue } from "../../app/authContext";
import { LocalDomainProvider } from "../../app/LocalDomainProvider";
import { PRIMARY_HOUSEHOLD_ID, useLocalDomain } from "../../app/localDomainContext";
import { ServerApiError, serverApiClient } from "../../shared/api/serverApiClient";
import { AssessmentPage } from "./AssessmentPage";
import type { AssessmentSummaryData } from "./contracts";
import { FIELD_LABELS, toRequestBody } from "./fields";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.removeItem("ieobom:selected-profile-id");
  // 모듈 바깥에서 만든 스파이는 restoreAllMocks 가 건드리지 않는다.
  markSignedOut.mockClear();
});

/** 입력 유효성, 판정 근거, ML 참고값과 미래 신호를 보고서 흐름에서 검증한다. */
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
 * 기록을 먼저 심고 판정 화면을 그린다.
 *
 * "남긴 건강검진에서" 줄은 **실제 기록**에서 카드를 만든다(서버가 준 칸 목록이
 * 아니다). `payload.values` 를 직접 담아 두면 `useCanonicalValues` 가 서버에
 * 묻지 않으므로, 이 테스트는 사전 매핑이 아니라 화면 흐름만 본다.
 */
function renderWithRecords(
  seeds: Array<{ recordType: string; recordedAt: string; payload: Record<string, unknown> }>,
  state?: unknown,
) {
  function Seeded() {
    const { runtime } = useLocalDomain();
    const started = useRef(false);
    // **기록을 다 심은 뒤에 화면을 그린다.** 실제로도 기록은 화면보다 먼저 있다.
    // 마운트 뒤에 심으면 화면은 이미 빈 목록을 읽은 상태라 카드가 서지 않는다.
    const [ready, setReady] = useState(false);

    useEffect(() => {
      if (!runtime || started.current) return;
      started.current = true;
      void (async () => {
        for (const seed of seeds) {
          await runtime.healthRecords.create({
            householdId: PRIMARY_HOUSEHOLD_ID,
            profileId: "p-1",
            recordType: seed.recordType as never,
            recordedAt: seed.recordedAt,
            source: "manual",
            payload: seed.payload,
          });
        }
        setReady(true);
      })();
    }, [runtime]);

    return ready ? <AssessmentPage /> : null;
  }

  return render(
    <MemoryRouter initialEntries={[{ pathname: "/assessment", state }]}>
      <AuthContext.Provider value={authValue()}>
        <LocalDomainProvider databaseName={`ieobom-assess-test-${crypto.randomUUID()}`}>
          <Seeded />
        </LocalDomainProvider>
      </AuthContext.Provider>
    </MemoryRouter>,
  );
}

function renderPage(state?: unknown, openManual = true) {
  const view = render(
    <MemoryRouter initialEntries={[{ pathname: "/assessment", state }]}>
      <AuthContext.Provider value={authValue()}>
        <LocalDomainProvider databaseName={`ieobom-assess-test-${crypto.randomUUID()}`}>
          <AssessmentPage />
        </LocalDomainProvider>
      </AuthContext.Provider>
    </MemoryRouter>,
  );
  if (openManual) fireEvent.click(screen.getByRole("button", { name: /직접 수치 입력/ }));
  return view;
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
  it("홈에서 선택한 가족에게 결과가 없으면 다른 가족의 저장된 판정을 보여주지 않는다", async () => {
    function SeededProfiles() {
      const { runtime, createProfile } = useLocalDomain();
      const started = useRef(false);
      const [ready, setReady] = useState(false);

      useEffect(() => {
        if (!runtime || started.current) return;
        started.current = true;
        void (async () => {
          const first = await createProfile({ displayName: "나", relationship: "본인" });
          const second = await createProfile({ displayName: "엄마", relationship: "부모" });
          await runtime.healthRecords.create({
            householdId: PRIMARY_HOUSEHOLD_ID,
            profileId: first.id,
            recordType: "assessment",
            recordedAt: "2026-09-17T09:00:00+09:00",
            source: "manual",
            payload: {
              inputs: { age: 54, sex: "M", height_cm: 173, weight_kg: 78, self_rated_health: 3, sbp: 148, dbp: 92, fasting_glucose: 113 },
              levels: { htn: "HIGH" }, engines: { htn: "E1" },
              bmi: RESPONSE.bmi, evaluated: 2, total: 2, highestLevel: "HIGH",
              verdicts: RESPONSE.verdicts, matrix: Object.values(RESPONSE.disease_risks),
            },
          });
          localStorage.setItem("ieobom:selected-profile-id", second.id);
          setReady(true);
        })();
      }, [runtime, createProfile]);

      return ready ? <AssessmentPage /> : null;
    }

    render(
      <MemoryRouter initialEntries={["/assessment"]}>
        <AuthContext.Provider value={authValue()}>
          <LocalDomainProvider databaseName={`ieobom-assess-test-${crypto.randomUUID()}`}>
            <SeededProfiles />
          </LocalDomainProvider>
        </AuthContext.Provider>
      </MemoryRouter>,
    );

    expect(await screen.findByText("엄마님의 기록")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "분석에 사용할 건강기록" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /만성질환 위험도 분석/ })).not.toBeInTheDocument();
  });

  it("저장된 최신 판정이 있으면 입력 대신 보고서를 열고, 명시적 새 분석에서만 입력으로 간다", async () => {
    const user = userEvent.setup();
    renderWithRecords([{ recordType: "assessment", recordedAt: "2026-09-17T09:00:00+09:00", payload: {
      inputs: { age: 54, sex: "M", height_cm: 173, weight_kg: 78, self_rated_health: 3, sbp: 148, dbp: 92, fasting_glucose: 113 },
      levels: { htn: "HIGH", anemia: "NORMAL" }, engines: { htn: "E1", anemia: "E2" },
      bmi: RESPONSE.bmi, evaluated: 2, total: 2, highestLevel: "HIGH",
      verdicts: RESPONSE.verdicts.map((item) => ({ ...item, reference: item.reference ? { probability: item.reference.probability } : null })), matrix: Object.values(RESPONSE.disease_risks),
    } }], { profileId: "p-1" });

    expect(await screen.findByRole("heading", { name: /만성질환 위험도 분석/ })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "분석에 사용할 건강기록" })).not.toBeInTheDocument();
    expect(screen.queryByRole("progressbar", { name: /빈혈 10년 뒤 새로 생길 확률/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /새로운 결과 넣어보기/ }));
    expect(screen.getByRole("heading", { name: "분석에 사용할 건강기록" })).toBeInTheDocument();
  });

  it("처음에는 기록 선택을 먼저 보이고 업로드와 직접 입력을 접어 둔다", async () => {
    const user = userEvent.setup();
    renderPage(undefined, false);

    expect(screen.getByRole("heading", { name: "분석에 사용할 건강기록" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "검진표 업로드" })).not.toBeInTheDocument();
    expect(screen.queryByRole("spinbutton", { name: /나이/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /검진표 불러오기/ }));
    expect(screen.getByRole("region", { name: "검진표 업로드" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /직접 수치 입력/ }));
    expect(screen.getByRole("spinbutton", { name: /나이/ })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "검진표 업로드" })).not.toBeInTheDocument();
  });

  it("필수 수치가 준비돼 있으면 접힌 입력을 열지 않고 판정할 수 있다", async () => {
    const user = userEvent.setup();
    const assess = vi.spyOn(serverApiClient, "assessSummary").mockResolvedValue(RESPONSE);
    renderPage({ prefill: { age: 54, sex: "M", height_cm: 173, weight_kg: 78, self_rated_health: 3, sbp: 128, dbp: 82, fasting_glucose: 113 } }, false);

    await user.click(screen.getByRole("button", { name: "이 기록으로 분석하기" }));
    expect(assess).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("heading", { name: /만성질환 위험도 분석/ })).toBeInTheDocument();
  });

  it("최근 건강기록을 한 번에 선택해 분석 입력으로 가져온다", async () => {
    const user = userEvent.setup();
    renderWithRecords([{ recordType: "health_screening", recordedAt: "2026-09-17T09:00:00+09:00", payload: { values: { sbp: 119, dbp: 93, hdl: 52, ldl: 173 } } }], { profileId: "p-1" });

    const choose = await screen.findByRole("button", { name: "이 기록 선택" });
    expect(screen.getByText(/혈압 119\/93/)).toBeInTheDocument();
    await user.click(choose);
    expect(screen.getByText("선택됨")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /직접 수치 입력/ }));
    expect(screen.getByRole("spinbutton", { name: /수축기/ })).toHaveValue(119);
    expect(screen.getByRole("spinbutton", { name: /이완기/ })).toHaveValue(93);
  });

  it("판정 뒤에는 입력 폼 대신 보고서 섹션을 순서대로 보여준다", async () => {
    const user = userEvent.setup();
    vi.spyOn(serverApiClient, "assessSummary").mockResolvedValue(RESPONSE);
    renderPage();
    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: "이 기록으로 분석하기" }));

    expect(await screen.findByRole("heading", { name: /만성질환 위험도 분석/ })).toBeInTheDocument();
    expect(screen.queryByRole("spinbutton", { name: /나이/ })).not.toBeInTheDocument();
    expect([...document.querySelectorAll(".risk-report-page > section, .risk-middle-grid > section")].map((section) => section.getAttribute("aria-labelledby"))).toEqual([
      "risk-summary-heading",
      "risk-overview-heading",
      "risk-trend-heading",
      "risk-future-heading",
      "risk-explanation-heading",
    ]);
    expect(screen.getByRole("progressbar", { name: /빈혈 10년 뒤 새로 생길 확률/ })).toHaveAttribute("value", "0.27");
  });

  it("서버가 미래 궤적을 주지 않으면 확률 막대를 만들지 않는다", async () => {
    const user = userEvent.setup();
    vi.spyOn(serverApiClient, "assessSummary").mockResolvedValue({
      ...RESPONSE,
      verdicts: RESPONSE.verdicts.map((verdict) => ({ ...verdict, reference: null })),
    });
    renderPage();
    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: "이 기록으로 분석하기" }));

    expect(await screen.findByRole("heading", { name: "앞으로의 위험 예측" })).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.getByText(/표시할 미래 확률이 없습니다/)).toBeInTheDocument();
  });

  it("전체 결과와 앞날의 신호를 보고서 안에서 펼쳐 볼 수 있다", async () => {
    const user = userEvent.setup();
    vi.spyOn(serverApiClient, "assessSummary").mockResolvedValue(RESPONSE);
    renderPage();
    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: "이 기록으로 분석하기" }));

    await screen.findByRole("heading", { name: "주요 질환별 위험도" });
    await user.click(screen.getByRole("button", { name: /전체 결과 보기/ }));
    expect(document.querySelectorAll(".risk-expanded-results .assess-card")).toHaveLength(RESPONSE.verdicts.length);

    await user.click(screen.getByRole("button", { name: /관련 위험 신호 보기/ }));
    expect(screen.getByRole("region", { name: /만성질환 발병 예측/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "심혈관질환" })).toBeInTheDocument();
  });

  it("요약 카드에서 모델과 의학적 근거를 열고 닫을 수 있다", async () => {
    const user = userEvent.setup();
    vi.spyOn(serverApiClient, "assessSummary").mockResolvedValue(RESPONSE);
    renderPage();
    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: "이 기록으로 분석하기" }));

    const opener = await screen.findByRole("button", { name: /고혈압 상세 근거 보기/ });
    await user.click(opener);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getAllByText(/대한고혈압학회/).length).toBeGreaterThan(0);
    expect(within(dialog).getByText(/AUROC 는 "100명 중 몇 명을 맞힌다"가 아닙니다/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "닫기" }));
    expect(opener).toHaveFocus();
  });

  it("다른 기록으로 분석하기를 누르면 입력으로 돌아가 기존 수치를 고칠 수 있다", async () => {
    const user = userEvent.setup();
    vi.spyOn(serverApiClient, "assessSummary").mockResolvedValue(RESPONSE);
    renderPage();
    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: "이 기록으로 분석하기" }));
    await screen.findByRole("heading", { name: "주요 질환별 위험도" });

    await user.click(screen.getByRole("button", { name: /다른 기록으로 분석하기/ }));
    expect(screen.queryByRole("heading", { name: "주요 질환별 위험도" })).not.toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: /나이/ })).toHaveValue(54);
  });

  it("발병 확률과 기준 초과 확률을 구분해서 서버 수치만 보여준다", async () => {
    const user = userEvent.setup();
    const response = structuredClone(RESPONSE);
    response.verdicts[0].reference!.prevalence_trajectory = {
      horizons_years: [5, 10],
      prevalence_probability: [0.62, 0.7],
      current_probability: 0.57,
      direction: "상승",
      conditional_on: "지금의 수치가 유지된다는 가정",
      irreversible: false,
      caveats: [],
    };
    vi.spyOn(serverApiClient, "assessSummary").mockResolvedValue(response);
    renderPage();
    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: "이 기록으로 분석하기" }));

    expect(await screen.findByRole("progressbar", { name: /고혈압 10년 뒤 기준 초과 확률/ })).toHaveAttribute("value", "0.7");
    expect(screen.getByRole("progressbar", { name: /빈혈 10년 뒤 새로 생길 확률/ })).toHaveAttribute("value", "0.27");
  });

  it("필수 칸을 채우기 전에는 보내지 않는다", async () => {
    const user = userEvent.setup();
    const spy = vi.spyOn(serverApiClient, "assessSummary");
    renderPage();

    // 버튼은 잠기지 않는다 — 눌러야 어디가 비었는지 알려 줄 수 있다.
    const button = screen.getByRole("button", { name: /이 기록으로 분석하기/ });
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

    await user.click(screen.getByRole("button", { name: /이 기록으로 분석하기/ }));

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

    await user.click(screen.getByRole("button", { name: /이 기록으로 분석하기/ }));
    await user.click(within(screen.getByRole("alert")).getByRole("button", { name: "체중" }));

    expect(screen.getByRole("spinbutton", { name: /체중/ })).toHaveFocus();
  });

  it("채우면 경고가 그 칸부터 사라진다", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: /이 기록으로 분석하기/ }));
    expect(screen.getByRole("spinbutton", { name: /나이/ })).toHaveAttribute("aria-invalid", "true");

    await user.type(screen.getByRole("spinbutton", { name: /나이/ }), "54");
    expect(screen.getByRole("spinbutton", { name: /나이/ })).not.toHaveAttribute("aria-invalid");
    expect(screen.getByRole("alert")).toHaveTextContent(/필수 항목 7개가 비어 있어요/);

    await fillRequired(user);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });












  it("구성원이 없으면 기록 대신 등록을 안내한다", async () => {
    const user = userEvent.setup();
    vi.spyOn(serverApiClient, "assessSummary").mockResolvedValue(RESPONSE as never);
    renderPage();

    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: /이 기록으로 분석하기/ }));
    await screen.findByRole("button", { name: /고혈압 상세 근거 보기/ });
    await user.click(screen.getByText("의학적 안내사항"));

    // 판정은 보여주되 시점을 이을 자리가 없다는 것을 말해야 한다. 버튼만 비활성으로
    // 두면 사용자는 왜 못 누르는지 모른다.
    expect(screen.getByText(/구성원을 등록해 주세요/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /이 시점을 기록에 남기기/ })).not.toBeInTheDocument();
    // 시점이 없으니 대시보드 자체가 안 나온다.
    expect(screen.queryByRole("heading", { name: /추적 대시보드/ })).not.toBeInTheDocument();
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
    await user.click(screen.getByRole("button", { name: /이 기록으로 분석하기/ }));

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
    await user.click(screen.getByRole("button", { name: /이 기록으로 분석하기/ }));

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
    await user.click(screen.getByRole("button", { name: /이 기록으로 분석하기/ }));

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
    await user.click(screen.getByRole("button", { name: /이 기록으로 분석하기/ }));

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
    await user.click(screen.getByRole("button", { name: /이 기록으로 분석하기/ }));

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

  /**
   * **테스트 값은 기록에 남지 않는다.**
   *
   * 프리셋은 학회 기준 예시 수치라 사용자의 실제 몸이 아니다. 그대로 저장되면
   * 추이 그래프와 "지난 판정으로 채우기" 목록이 시연용 점으로 오염되고, 그러면
   * 그 목록에서 자기 기록을 골라낼 수 없다. 실제로 그렇게 쌓였다.
   *
   * 저장 지점이 **둘**이라 둘 다 본다 — 판정 직후 자동 저장과 결과 아래
   * "기록에 남기기" 버튼. 한쪽만 막으면 다른 문으로 그대로 들어온다.
   */
  /**
   * **남긴 기록으로 채우는 입구.**
   *
   * 값이 판정 폼에 들어오는 길이 사실상 검진표 OCR 하나였다 — 혈압·혈당을 기록으로
   * 남겨도 여기서 손으로 다시 쳐야 했다. 매핑은 서버가 하고(`record_prefill`) 이
   * 화면은 그 결과를 붓는 것만 한다. 화면 쪽에서 틀릴 자리가 둘이다.
   *
   * 하나. **직접 넣은 값을 덮으면 안 된다.** 덮으면 사용자가 방금 고친 수치가
   * 조용히 되돌아가고, 그건 화면에서 구별되지 않는다.
   *
   * 둘. **잰 시각이 보여야 한다.** 석 달 전 혈압으로 오늘 판정하면 오늘의 답이 아니다.
   */
  it("카드를 열어 전체 수치를 보고 사용하기로 폼에 옮긴다", async () => {
    // **카드가 곧 검진 한 건이다.** 예전에는 칸 이름과 숫자가 평평하게 늘어서서,
    // 그 값들이 몇 건의 검진에서 온 것인지도 원본이 무엇인지도 읽히지 않았다.
    const user = userEvent.setup();
    renderWithRecords(
      [
        {
          recordType: "health_screening",
          recordedAt: "2026-09-10T10:00:00+09:00",
          payload: { values: { sbp: 128, weight_kg: 78.4 } },
        },
      ],
      { profileId: "p-1" },
    );

    const panel = await screen.findByRole("region", { name: "분석에 사용할 건강기록" }, { timeout: 5000 });
    await user.click(await within(panel).findByRole("button", { name: "변경" }));
    // 잰 날은 카드에 적힌다. 석 달 전 혈압으로 오늘 판정하면 오늘의 답이 아니다.
    expect(panel).toHaveTextContent("9월 10일");

    await user.click(within(panel).getByRole("button", { name: "자세히 보기" }));
    // 펼친 카드에는 그 검진의 값이 다 보인다.
    const card = await screen.findByRole("dialog", {}, { timeout: 5000 });
    expect(within(card).getByText("128")).toBeInTheDocument();

    await user.click(within(card).getByRole("button", { name: "이 수치 사용하기" }));
    await user.click(screen.getByRole("button", { name: /직접 수치 입력/ }));

    expect(screen.getByRole("spinbutton", { name: /수축기/ })).toHaveValue(128);
    expect(screen.getByRole("spinbutton", { name: /체중/ })).toHaveValue(78.4);
  });

  it("참·거짓 칸은 숫자가 아니라 예/아니오로 채운다", async () => {
    // 서버는 `is_fasting` 을 `1.0` 으로 실어 보낸다. 그걸 그대로 `"1"` 로 넣으면
    // select 에 없는 값이라 **아무 오류 없이 빈칸으로 남는다** — 실측으로 그랬다.
    const user = userEvent.setup();
    renderWithRecords(
      [
        {
          recordType: "health_screening",
          recordedAt: "2026-09-08T07:00:00+09:00",
          payload: { values: { fasting_glucose: 104, is_fasting: 1 } },
        },
      ],
      { profileId: "p-1" },
    );

    const panel = await screen.findByRole("region", { name: "분석에 사용할 건강기록" }, { timeout: 5000 });
    await user.click(await within(panel).findByRole("button", { name: "변경" }));
    await user.click(within(panel).getByRole("button", { name: "자세히 보기" }));
    const card = await screen.findByRole("dialog", {}, { timeout: 5000 });
    await user.click(within(card).getByRole("button", { name: "이 수치 사용하기" }));
    await user.click(screen.getByRole("button", { name: /직접 수치 입력/ }));

    expect(screen.getByRole("spinbutton", { name: /공복혈당/ })).toHaveValue(104);
    expect(screen.getByRole("combobox", { name: /공복 측정이었나/ })).toHaveValue("true");
  });

  it("한 번에 모아 오는 길은 직접 넣은 값을 덮지 않는다", async () => {
    // 카드를 골라 "사용하기" 를 누른 것은 그 검진을 쓰겠다는 **명시적 선택**이라
    // 덮는다. 반면 "최근 값 전부 가져오기" 는 칸마다 다른 날짜에서 값을 긁어 오는
    // 것이므로, 사용자가 방금 친 값을 조용히 되돌리면 안 된다.
    const user = userEvent.setup();
    vi.spyOn(serverApiClient, "prefillFromRecords").mockResolvedValue({
      items: [{ field: "sbp", value: 128, measured_at: "2026-09-10T10:00:00+09:00", record_type: "blood_pressure" }],
      scanned: 3,
    } as never);
    renderWithRecords(
      [
        { recordType: "blood_pressure", recordedAt: "2026-09-10T10:00:00+09:00", payload: { values: { sbp: 128 } } },
        { recordType: "body_measurement", recordedAt: "2026-06-08T08:00:00+09:00", payload: { values: { weight_kg: 78.4 } } },
      ],
      { profileId: "p-1" },
    );

    // 기록을 심은 뒤에 화면이 뜬다. 폼이 설 때까지 기다린 다음 손으로 넣는다.
    const panel = await screen.findByRole("region", { name: "분석에 사용할 건강기록" }, { timeout: 5000 });
    await user.click(await within(panel).findByRole("button", { name: "변경" }));
    await user.click(screen.getByRole("button", { name: /직접 수치 입력/ }));
    const sbp = screen.getByRole("spinbutton", { name: /수축기/ });
    await user.clear(sbp);
    await user.type(sbp, "145");

    await user.click(within(panel).getByRole("button", { name: /최근 수치 모두 가져오기/ }));

    // 방금 넣은 145 가 남아야 한다. 128 로 되돌아가면 사용자는 이유를 알 수 없다.
    expect(sbp).toHaveValue(145);
  });

  it("기록은 있는데 옮길 수치가 없으면 그 사실을 말한다", async () => {
    vi.spyOn(serverApiClient, "prefillFromRecords").mockResolvedValue({ items: [], scanned: 7 } as never);
    renderPage({ profileId: "p-1" });

    // "기록이 없다" 와 "옮길 수치가 없다" 는 다른 상황이라 문구가 달라야 한다.
    expect(await screen.findByText(/아직 분석에 사용할 건강기록이 없어요/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "이 기록 선택" })).toBeNull();
  });

  it("프리셋으로 판정하면 결과는 나오지만 기록에는 남기지 않는다", async () => {
    const user = userEvent.setup();
    const save = vi.spyOn(serverApiClient, "assessSummary").mockResolvedValue(RESPONSE as never);
    renderPage();

    await user.click(screen.getByRole("button", { name: "당뇨" }));
    // 판정을 돌리기 전에 이미 알려 준다 — 돌린 뒤에 말하면 저장 실패로 읽힌다.
    expect(screen.getByText(/기록에는 남지 않아요/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /이 기록으로 분석하기/ }));

    // 판정 자체는 그대로 된다. 프리셋의 쓸모가 결과를 보는 것이므로 막으면 안 된다.
    expect(save).toHaveBeenCalled();
    expect(await screen.findByText(/테스트 값이라 기록에 남기지 않았어요/)).toBeInTheDocument();
  });

  it("테스트 값 비우기는 폼을 통째로 비운다 — 표시만 떼지 않는다", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: "당뇨" }));
    expect(screen.getByRole("spinbutton", { name: /공복혈당/ })).toHaveValue(148);

    await user.click(screen.getByRole("button", { name: "테스트 값 비우기" }));

    // 표시만 떼면 예시 수치가 "내가 넣은 값" 으로 둔갑해 기록에 들어간다.
    expect(screen.queryByText(/기록에는 남지 않아요/)).not.toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: /나이/ })).not.toHaveValue(52);
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



});
