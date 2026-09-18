import { describe, expect, it } from "vitest";

import { isPreviewShellPath, isStitchShellPath, LOCAL_HOME_IS_PREVIEW18 } from "./localHomeSwap";

describe("isPreviewShellPath", () => {
  it("로컬 개발에서는 루트가 시안 셸이고 ui-preview18 은 기존 홈 셸이다", () => {
    if (!LOCAL_HOME_IS_PREVIEW18) return;
    expect(isPreviewShellPath("/")).toBe(true);
    expect(isPreviewShellPath("/ui-preview18")).toBe(false);
    expect(isPreviewShellPath("/ui-preview17")).toBe(true);
  });
});

describe("isStitchShellPath", () => {
  it("계정 화면도 가족 홈과 같은 상단 바를 쓴다", () => {
    expect(isStitchShellPath("/account")).toBe(true);
    expect(isStitchShellPath("/pain-diary")).toBe(true);
    expect(isStitchShellPath("/challenge")).toBe(false);
  });
});
