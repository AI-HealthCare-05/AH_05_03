import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";

import { AuthContext, type AuthContextValue } from "../../../app/authContext";
import { StitchAppHeader } from "./StitchAppHeader";

afterEach(cleanup);

function renderHeader(path = "/pain-diary") {
  const value: AuthContextValue = {
    status: "signed-in",
    email: "test@example.com",
    signIn: async () => {},
    signOut: async () => {},
    markSignedOut: () => {},
  };
  return render(
    <AuthContext.Provider value={value}>
      <MemoryRouter initialEntries={[path]}>
        <StitchAppHeader displayName="오성민" />
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

describe("StitchAppHeader", () => {
  it("가족 홈과 같은 브랜드·탭·계정 칩을 그린다", () => {
    renderHeader();

    expect(screen.getByRole("link", { name: "이어봄 가족 홈" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "이어봄 가족 홈" }).querySelector("img")).toHaveAttribute(
      "src",
      "/ieobom-icon.png",
    );
    expect(screen.getByText("우리 가족 웰니스 케어")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "기록 검색" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "알림" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "로그아웃" })).not.toBeInTheDocument();

    const nav = screen.getByRole("navigation", { name: "주 메뉴" });
    expect(within(nav).getAllByRole("link").map((link) => link.textContent)).toEqual([
      "가족 홈",
      "통증 다이어리",
      "위험 판정 / 리포트",
      "건강 데이터 3",
    ]);
    expect(within(nav).getByRole("link", { name: "통증 다이어리" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: /계정 메뉴/u })).toHaveTextContent("오성민(test@example.com)");
  });
});
