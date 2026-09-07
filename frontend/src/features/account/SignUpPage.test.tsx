/**
 * 가입 화면이 지켜야 하는 것.
 *
 * 1. **Enter 는 가입이다.** 폼에 submit 이 하나뿐이라 물어볼 필요가 없다
 * 2. 가입에 성공하면 `/signup` 에 서 있지 않는다 — 관문에서 들려 보낸 주소로 간다
 * 3. 이미 로그인한 사람은 가입 폼을 보지 않는다
 * 4. 세션을 확인하는 동안 폼을 깜빡이지 않는다
 */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthContext, type AuthContextValue, type AuthStatus } from "../../app/authContext";
import { SignUpPage } from "./SignUpPage";

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
  vi.restoreAllMocks();
});

/** 어디로 빠져나갔는지 그대로 보여 주는 대역. */
function Landed() {
  return <p>도착: {useLocation().pathname}</p>;
}

/** `AuthContextValue["signIn"]` 그대로의 시그니처를 가진 스파이. */
function spySignIn(impl: AuthContextValue["signIn"] = async () => {}) {
  return vi.fn(impl);
}

function renderSignUp({
  status = "signed-out" as AuthStatus,
  signIn = spySignIn(),
  from,
}: { status?: AuthStatus; signIn?: ReturnType<typeof spySignIn>; from?: string } = {}) {
  const value: AuthContextValue = {
    status,
    signIn,
    signOut: async () => {},
    markSignedOut: () => {},
  };
  render(
    <AuthContext.Provider value={value}>
      <MemoryRouter initialEntries={[{ pathname: "/signup", state: from ? { from } : null }]}>
        <Routes>
          <Route path="/signup" element={<SignUpPage />} />
          <Route path="*" element={<Landed />} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
  return signIn;
}

describe("SignUpPage", () => {
  it("비밀번호 칸에서 Enter 를 치면 가입이 나간다", async () => {
    const user = userEvent.setup();
    const signIn = renderSignUp();

    await user.type(screen.getByLabelText("이메일"), "new@example.com");
    await user.type(screen.getByLabelText("비밀번호"), "Password123!{Enter}");

    expect(signIn).toHaveBeenCalledTimes(1);
    expect(signIn).toHaveBeenCalledWith("new@example.com", "Password123!", { signUpFirst: true });
  });

  it("가입 화면에도 submit 이 하나뿐이다", () => {
    renderSignUp();

    const submits = screen
      .getAllByRole("button")
      .filter((button) => (button as HTMLButtonElement).type === "submit");
    expect(submits).toHaveLength(1);
    expect(submits[0]).toHaveAccessibleName("가입하기");
  });

  it("로그인한 상태로 오면 원래 가려던 주소로 비킨다", () => {
    renderSignUp({ status: "signed-in", from: "/assessment" });

    // 가입 폼이 보이면 안 된다 — 계정이 없어진 것처럼 읽힌다.
    expect(screen.queryByLabelText("비밀번호")).not.toBeInTheDocument();
    expect(screen.getByText("도착: /assessment")).toBeInTheDocument();
  });

  it("들려 보낸 주소가 없으면 홈으로 간다", () => {
    renderSignUp({ status: "signed-in" });
    expect(screen.getByText("도착: /")).toBeInTheDocument();
  });

  it("세션을 확인하는 동안에는 폼을 그리지 않는다", () => {
    renderSignUp({ status: "checking" });

    expect(screen.queryByLabelText("비밀번호")).not.toBeInTheDocument();
    expect(screen.getByText("불러오는 중…")).toBeInTheDocument();
  });

  it("로그인으로 돌아가는 링크는 원래 가려던 주소를 가리킨다", () => {
    renderSignUp({ from: "/assessment" });

    // 관문은 주소가 없다. 원래 주소로 돌아가면 거기서 관문이 다시 뜬다.
    expect(screen.getByRole("link", { name: "로그인" })).toHaveAttribute("href", "/assessment");
  });

  it("실패하면 이유를 적는다", async () => {
    const user = userEvent.setup();
    renderSignUp({
      signIn: spySignIn(async () => {
        throw new Error("이미 존재하는 이메일입니다.");
      }),
    });

    await user.type(screen.getByLabelText("이메일"), "member@example.com");
    await user.type(screen.getByLabelText("비밀번호"), "Password123!{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent("이미 존재하는 이메일입니다.");
  });
});
