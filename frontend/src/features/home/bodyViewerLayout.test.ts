import { describe, expect, it } from "vitest";

import {
  canOpenDrawerWithoutCoveringHint,
  DRAWER_INSET_PX,
  DRAWER_PANEL_WIDTH_PX,
  FOCUS_DOCK_LEAD_PX,
  HINT_CLEARANCE_PX,
  invertFocusBarFlip,
  requiredViewerWidthToClearHint,
  shouldDockFocusIcons,
} from "./bodyViewerLayout";

describe("requiredViewerWidthToClearHint", () => {
  it("열린 서랍이 가운데 힌트 바를 가리지 않는 너비를 계산한다", () => {
    expect(requiredViewerWidthToClearHint(400)).toBe(
      2 * (DRAWER_PANEL_WIDTH_PX + DRAWER_INSET_PX + HINT_CLEARANCE_PX) + 400,
    );
  });
});

describe("canOpenDrawerWithoutCoveringHint", () => {
  it("힌트를 가리면 서랍을 자동으로 열지 않는다", () => {
    const need = requiredViewerWidthToClearHint(400);
    expect(canOpenDrawerWithoutCoveringHint(need - 1, 800, 400)).toBe(false);
    expect(canOpenDrawerWithoutCoveringHint(need, 800, 400)).toBe(true);
    expect(canOpenDrawerWithoutCoveringHint(need, 800, 0)).toBe(false);
  });
});

describe("shouldDockFocusIcons", () => {
  it("서랍 자동 개방 직전 너비에서 확대 아이콘을 도킹한다", () => {
    const need = requiredViewerWidthToClearHint(400);
    expect(shouldDockFocusIcons(need - FOCUS_DOCK_LEAD_PX - 1, 800, 400)).toBe(false);
    expect(shouldDockFocusIcons(need - FOCUS_DOCK_LEAD_PX, 800, 400)).toBe(true);
    expect(shouldDockFocusIcons(need - 8, 800, 400)).toBe(true);
    expect(canOpenDrawerWithoutCoveringHint(need - 8, 800, 400)).toBe(false);
  });
});

describe("invertFocusBarFlip", () => {
  it("이전 위치에서 다음 위치로 가는 역변환 거리를 계산한다", () => {
    expect(invertFocusBarFlip({ left: 20, top: 80 }, { left: 400, top: 500 })).toEqual({
      dx: -380,
      dy: -420,
    });
  });
});
