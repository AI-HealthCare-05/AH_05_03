import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { TrendChart } from "./TrendChart";
import type { LevelTrack, TrendSeries } from "./snapshots";

afterEach(cleanup);

const DATES = ["2026-01-01T00:00:00Z", "2026-04-01T00:00:00Z"];
const SERIES: TrendSeries[] = [
  {
    key: "sbp",
    label: "수축기 혈압",
    unit: "mmHg",
    points: [
      { at: DATES[0], value: 148 },
      { at: DATES[1], value: 132 },
    ],
  },
];
const TRACKS: LevelTrack[] = [
  { key: "htn", levels: ["CAUTION", "HIGH"], engines: ["E2", "E1"], engineChanges: [1] },
];

describe("TrendChart", () => {
  it("시점이 하나면 그리지 않고 왜인지 말한다", () => {
    render(<TrendChart series={[]} tracks={[]} names={{}} dates={[DATES[0]]} total={1} />);
    expect(screen.getByText(/시점이 하나뿐입니다/)).toBeInTheDocument();
  });

  it("수치 변화를 방향까지 읽어 준다", () => {
    render(<TrendChart series={SERIES} tracks={TRACKS} names={{ htn: "고혈압" }} dates={DATES} total={2} />);

    // 눈으로 선을 못 보는 사람도 읽을 수 있어야 한다.
    expect(screen.getByRole("img", { name: /수축기 혈압 2개 시점.*148mmHg 에서.*132mmHg 로 내렸다/ })).toBeInTheDocument();
    expect(screen.getByText("-16")).toBeInTheDocument();
  });

  it("정본 엔진이 바뀐 시점을 표시한다", () => {
    render(<TrendChart series={SERIES} tracks={TRACKS} names={{ htn: "고혈압" }} dates={DATES} total={2} />);

    expect(screen.getByText("고혈압")).toBeInTheDocument();
    // 등급이 바뀐 것과 별개로, 왜 바뀌었는지(검사값이 들어왔다)를 적는다.
    expect(screen.getByText(/정본 엔진이 규칙 엔진으로 시점/)).toBeInTheDocument();
  });

  it("창보다 많은 시점이 보관함에 있으면 그 사실을 적는다", () => {
    // 잘라낸 것을 지운 게 아니라 안 그린 것뿐이라는 사실이 화면에 있어야 한다.
    render(<TrendChart series={SERIES} tracks={TRACKS} names={{ htn: "고혈압" }} dates={DATES} total={30} />);
    expect(screen.getByText(/보관함에 30개가 있고 최근 2개만 그립니다/)).toBeInTheDocument();
  });

  it("겹치는 수치가 없으면 선 대신 이유를 낸다", () => {
    render(<TrendChart series={[]} tracks={TRACKS} names={{ htn: "고혈압" }} dates={DATES} total={2} />);
    expect(screen.getByText(/두 시점 이상에서 같은 수치를 넣어야/)).toBeInTheDocument();
  });
});
