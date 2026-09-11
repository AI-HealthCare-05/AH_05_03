/**
 * 카드 앞면 앞날 한 칸(`TrajectoryLine`)의 지평 고르기 계약.
 *
 * **왜 이 파일이 생겼나.** 서버는 지평 다섯 개(1~5년)를 다 보내는데 앞면은 그중
 * **5년 하나만** 적는다. 고르는 규칙이 조용히 틀릴 수 있는 자리가 둘이다.
 *
 * 하나. **인덱스를 박으면 안 된다.** `trajectory.HORIZONS` 가 바뀌는 날 화면은
 * 아무 오류 없이 다른 해를 적는다. 그래서 값으로 고르고, 여기서 그걸 고정한다.
 *
 * 둘. **나이 상한에 걸리면 5년이 없다.** 78세는 1·2년만 남고(80세 상한), 그때
 * 빈 줄이 나가면 안 된다 — 있는 것 중 마지막을 적는다.
 *
 * 발병 줄에 "지금" 이 없는 것도 여기서 못 박는다. 누적 발병 확률은 t=0 에서
 * 정의상 0 이고, 카드의 "지금" 은 이 줄 위의 등급 배지가 맡는다.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { TrajectoryLine } from "./VerdictCards";
import type { DiseaseVerdict, OnsetTrajectory } from "./contracts";

afterEach(cleanup);

const TRAJECTORY: OnsetTrajectory = {
  horizons_years: [1, 2, 3, 4, 5],
  onset_probability: [0.04, 0.07, 0.09, 0.12, 0.14],
  population_onset_probability: [0.03, 0.05, 0.07, 0.09, 0.11],
  relative_hazard: 1.4,
  reference_prevalence: 0.21,
  conditional_on: "현재 이 질환이 없다는 가정",
  mortality_corrected: true,
  truncated_at_age: null,
  method: "baseline_hazard",
  caveats: ["단면 자료의 나이 기울기에서 유도한 추정입니다."],
};

function verdictWith(trajectory: OnsetTrajectory): DiseaseVerdict {
  return {
    key: "dm",
    name: "당뇨",
    // E2 = ML 시드 앙상블. 궤적은 1단계 ML 확률에서 나오므로 이 엔진이 맞다.
    engine: "E2",
    engine_label: "추정",
    engine_reason: "검사값이 없어 추정했습니다.",
    risk_level: "CAUTION",
    sub_status: "",
    display_label: "관심",
    reason: "",
    criteria_reference: "",
    recommendation: "",
    missing_fields: [],
    flags: [],
    superseded_by: null,
    reference: { trajectory, trajectory_status: "projected" },
    disclaimer: "의료 진단이 아닙니다.",
  };
}

describe("TrajectoryLine", () => {
  it("지평 다섯 개 중 5년 뒤 하나만 적는다", () => {
    render(<TrajectoryLine verdict={verdictWith(TRAJECTORY)} />);

    expect(screen.getByText(/^5년 뒤/)).toBeInTheDocument();
    // 확률은 고른 해의 것이어야 한다. 인덱스를 박으면 여기서 어긋난다.
    expect(screen.getByText("14%")).toBeInTheDocument();

    // 나머지 넷은 앞면에 적지 않는다 — 근거 모달의 표가 다 그린다.
    for (const year of [1, 2, 3, 4]) {
      expect(screen.queryByText(new RegExp(`^${year}년 뒤`))).toBeNull();
    }
    for (const value of ["4%", "7%", "9%", "12%"]) {
      expect(screen.queryByText(value)).toBeNull();
    }
  });

  it("발병 줄에는 '지금' 이 없다 — 누적 발병 확률은 t=0 에서 정의상 0 이다", () => {
    render(<TrajectoryLine verdict={verdictWith(TRAJECTORY)} />);

    expect(screen.queryByText("지금")).toBeNull();
    // 카드의 "지금" 은 이 줄 위의 등급 배지가 맡는다(`VerdictCards` 앞면).
    expect(screen.getByText("새로 생길 확률")).toBeInTheDocument();
  });

  it("동년배를 그 한 점에 붙인다", () => {
    render(<TrajectoryLine verdict={verdictWith(TRAJECTORY)} />);

    expect(screen.getByText(/^5년 뒤/)).toHaveTextContent("동년배 11%");
  });

  it("나이 상한에 5년이 잘리면 있는 것 중 마지막을 적는다", () => {
    // 78세. 80세 상한이라 1·2년만 남는다.
    const truncated: OnsetTrajectory = {
      ...TRAJECTORY,
      horizons_years: [1, 2],
      onset_probability: [0.04, 0.07],
      population_onset_probability: [0.03, 0.05],
      truncated_at_age: 80,
    };
    render(<TrajectoryLine verdict={verdictWith(truncated)} />);

    expect(screen.getByText(/^2년 뒤/)).toHaveTextContent("동년배 5%");
    expect(screen.getByText("7%")).toBeInTheDocument();
    expect(screen.queryByText(/^1년 뒤/)).toBeNull();
  });

  it("지평이 하나뿐이면 그 하나를 적는다", () => {
    const single: OnsetTrajectory = {
      ...TRAJECTORY,
      horizons_years: [1],
      onset_probability: [0.04],
      population_onset_probability: [0.03],
      truncated_at_age: 80,
    };
    render(<TrajectoryLine verdict={verdictWith(single)} />);

    expect(screen.getByText(/^1년 뒤/)).toHaveTextContent("동년배 3%");
  });
});
