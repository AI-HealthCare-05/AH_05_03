import { describe, expect, it } from "vitest";

import { pickLauncherMood } from "./bomiMood";

describe("pickLauncherMood", () => {
  it("닫혀 있고 알림이 있으면 놀란 표정이다", () => {
    expect(pickLauncherMood({ isOpen: false, hasUnread: true, showTooltip: true, hovering: false })).toBe(
      "alert",
    );
  });

  it("호버하면 윙크다", () => {
    expect(pickLauncherMood({ isOpen: false, hasUnread: false, showTooltip: true, hovering: true })).toBe(
      "wink",
    );
  });

  it("말풍선이 떠 있으면 웃는다", () => {
    expect(pickLauncherMood({ isOpen: false, hasUnread: false, showTooltip: true, hovering: false })).toBe(
      "happy",
    );
  });

  it("대화창이 열려 있으면 듣는다", () => {
    expect(pickLauncherMood({ isOpen: true, hasUnread: true, showTooltip: false, hovering: false })).toBe(
      "listen",
    );
  });
});
