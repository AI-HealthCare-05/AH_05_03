import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { HomePage } from "./HomePage";

describe("HomePage", () => {
  it("로컬 우선 경계와 합성 실행 버튼을 표시한다", () => {
    render(<HomePage />);

    expect(
      screen.getByRole("heading", { name: /건강정보가 서버로 가지 않는/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "합성 데이터로 로컬 실행 확인" }),
    ).toBeInTheDocument();
    expect(screen.getByText("이 동작은 /api 요청을 만들지 않습니다.")).toBeInTheDocument();
  });
});
