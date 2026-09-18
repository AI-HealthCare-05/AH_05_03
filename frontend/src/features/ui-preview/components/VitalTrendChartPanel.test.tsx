import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { VitalTrendChartPanel, buildVitalTrendData } from "./VitalTrendChartPanel";

beforeAll(() => {
  if (typeof globalThis.ResizeObserver === "undefined") {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as typeof ResizeObserver;
  }
});

afterEach(cleanup);

describe("buildVitalTrendData", () => {
  it("24시간은 실측 다음에 예측이 온다", () => {
    const points = buildVitalTrendData("24h");
    const split = points.findIndex((p) => p.isPredicted);
    expect(points).toHaveLength(25);
    expect(split).toBeGreaterThan(0);
    expect(points.slice(0, split).every((p) => !p.isPredicted)).toBe(true);
    expect(points.slice(split).every((p) => p.isPredicted)).toBe(true);
  });
});

describe("VitalTrendChartPanel", () => {
  it("기본 차트 제목과 구간 탭을 그린다", async () => {
    const user = userEvent.setup();
    render(<VitalTrendChartPanel />);

    expect(screen.getByRole("img", { name: "심박수(HR) 및 심박변이도(HRV) 예측 트렌드" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "7일 주간 예측" }));
    expect(screen.getByRole("img", { name: "심박수(HR) 및 심박변이도(HRV) 예측 트렌드" })).toBeTruthy();
    await user.click(screen.getByRole("tab", { name: "혈압 (수축기/이완기)" }));
    expect(screen.getByRole("img", { name: "혈압(BP) 일주기 변동 및 예측 곡선" })).toBeTruthy();
  });

  it("Recharts 차트를 그린다", () => {
    const { container } = render(<VitalTrendChartPanel />);
    expect(container.querySelector(".recharts-wrapper, .recharts-responsive-container")).toBeTruthy();
  });
});
