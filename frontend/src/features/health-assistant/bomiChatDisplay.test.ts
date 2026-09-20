import { afterEach, describe, expect, it } from "vitest";

import {
  BOMI_CHAT_DISPLAY_KEY,
  measureChatFrame,
  readBomiChatDisplay,
  stepChatValue,
  CHAT_SIZE_STEPS,
  writeBomiChatDisplay,
} from "./bomiChatDisplay";

describe("bomiChatDisplay", () => {
  afterEach(() => {
    localStorage.removeItem(BOMI_CHAT_DISPLAY_KEY);
  });

  it("창 크기는 가로를 기준으로 세로를 비율에 맞추고, 화면 높이를 넘기지 않는다", () => {
    const laptop = measureChatFrame("xl", 1512, 982);
    expect(laptop.width).toBeGreaterThanOrEqual(520);
    expect(laptop.height).toBeLessThanOrEqual(982 - 64 - 120);
    expect(laptop.height / laptop.width).toBeLessThan(1.7);

    const wall = measureChatFrame("xl", 3840, 2160);
    expect(wall.width).toBeGreaterThan(laptop.width);
    expect(wall.width).toBeGreaterThan(1100);
    expect(wall.width).toBeLessThanOrEqual(3840 * 0.42);
  });

  it("보통 크기는 좁은 메신저 비율을 유지한다", () => {
    const frame = measureChatFrame("md", 1512, 982);
    expect(frame.width).toBeLessThanOrEqual(440);
    expect(frame.height / frame.width).toBeGreaterThan(1.4);
  });

  it("같은 화면에서 크게는 보통보다 분명히 넓다", () => {
    const md = measureChatFrame("md", 3840, 2160);
    const xl = measureChatFrame("xl", 3840, 2160);
    expect(xl.width).toBeGreaterThan(md.width + 400);
  });

  it("표시 설정은 localStorage 에 남는다", () => {
    writeBomiChatDisplay({ size: "lg", type: "xl", widthPx: 500 });
    expect(readBomiChatDisplay()).toEqual({ size: "lg", type: "xl", widthPx: 500 });
  });

  it("큰 창도 상단 제목 바 아래로 들어가지 않는다", () => {
    const frame = measureChatFrame("xl", 1512, 982);
    expect(frame.height).toBeLessThanOrEqual(982 - 64 - 120);
  });

  it("단계 이동은 끝에서 멈춘다", () => {
    expect(stepChatValue(CHAT_SIZE_STEPS, "md", -1)).toBe("md");
    expect(stepChatValue(CHAT_SIZE_STEPS, "xl", 1)).toBe("xl");
    expect(stepChatValue(CHAT_SIZE_STEPS, "md", 1)).toBe("lg");
  });
});
