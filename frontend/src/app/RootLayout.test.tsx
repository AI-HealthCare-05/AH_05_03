/**
 * 관문이 지켜야 하는 것 셋.
 *
 * 1. 세션을 확인하는 동안 로그인 화면을 **깜빡이지 않는다** — 이미 로그인한 사용자가
 *    새로고침할 때마다 쫓겨나는 것처럼 보이면 안 된다
 * 2. 로그인 전에는 내비게이션이 없다 — 아무것도 못 하는 문을 세워 두지 않는다
 * 3. 로그인하면 원래 가려던 주소가 그대로 뜬다 — 관문은 리다이렉트가 아니다
 */

import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";

import { AuthContext, type AuthContextValue, type AuthStatus } from "./authContext";
import { RootLayout } from "./RootLayout";

afterEach(cleanup);

function renderAt(status: AuthStatus, path = "/assessment") {
  const value: AuthContextValue = {
    status,
    email: status === "signed-in" ? "member@example.com" : undefined,
    signIn: async () => {},
    signOut: async () => {},
    markSignedOut: () => {},
  };
  return render(
    <AuthContext.Provider value={value}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/" element={<RootLayout />}>
            <Route path="assessment" element={<p>판정 화면 내용</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

describe("RootLayout 로그인 관문", () => {
  it("세션을 확인하는 동안에는 로그인 화면도 본문도 띄우지 않는다", () => {
    renderAt("checking");

    expect(screen.getByText("불러오는 중…")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "로그인" })).not.toBeInTheDocument();
    expect(screen.queryByText("판정 화면 내용")).not.toBeInTheDocument();
  });

  it("로그인 전에는 로그인 화면만 있고 주 메뉴가 없다", () => {
    renderAt("signed-out");

    expect(screen.getByRole("button", { name: "로그인" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "주 메뉴" })).not.toBeInTheDocument();
    expect(screen.queryByText("판정 화면 내용")).not.toBeInTheDocument();
  });

  it("로그인하면 원래 가려던 주소의 화면이 그대로 뜬다", () => {
    renderAt("signed-in");

    expect(screen.getByText("판정 화면 내용")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "주 메뉴" })).toBeInTheDocument();
  });

  it("메뉴는 가족 홈·건강 현황·계정 셋이다", () => {
    renderAt("signed-in");

    const navigation = screen.getByRole("navigation", { name: "주 메뉴" });
    expect(navigation).toHaveTextContent("가족 홈");
    expect(navigation).toHaveTextContent("건강 현황");
    expect(navigation).toHaveTextContent("계정");
  });
});
