import { describe, expect, it } from "vitest";

import { isPreviewShellPath, isStitchShellPath, isVariantBarPath } from "./localHomeSwap";

describe("isPreviewShellPath", () => {
  it("루트(/)와 시안 주소는 자체 상단 바 셸이다", () => {
    expect(isPreviewShellPath("/")).toBe(true);
    expect(isPreviewShellPath("/ui-preview17")).toBe(true);
    expect(isPreviewShellPath("/account")).toBe(false);
  });
});

describe("isVariantBarPath", () => {
  it("제품 홈에서는 시안 목록을 숨기고 명시적인 미리보기에서만 보여 준다", () => {
    expect(isVariantBarPath("/")).toBe(false);
    expect(isVariantBarPath("/ui-preview18")).toBe(true);
    expect(isVariantBarPath("/ui-preview")).toBe(true);
  });
});

describe("isStitchShellPath", () => {
  it("계정 화면도 가족 홈과 같은 상단 바를 쓴다", () => {
    expect(isStitchShellPath("/account")).toBe(true);
    expect(isStitchShellPath("/pain-diary")).toBe(true);
    expect(isStitchShellPath("/challenge")).toBe(false);
  });
});
