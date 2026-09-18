import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { BomiAvatar } from "./BomiAvatar";

afterEach(cleanup);

describe("BomiAvatar", () => {
  it("표정에 맞는 스프라이트 행을 켠다", () => {
    const { container } = render(<BomiAvatar mood="idle" />);
    const sprite = container.querySelector("[data-bomi-mood='idle']");
    expect(sprite).toBeInstanceOf(HTMLElement);
    expect(sprite).toHaveClass("bomi-avatar-sprite");
  });

  it("고정 모드는 스프라이트 대신 정지 컷을 쓴다", () => {
    const { container } = render(<BomiAvatar mood="idle" still />);
    const still = container.querySelector("[data-bomi-still]");
    expect(still).toBeInstanceOf(HTMLImageElement);
    expect(still).not.toHaveClass("bomi-avatar-sprite");
  });
});
