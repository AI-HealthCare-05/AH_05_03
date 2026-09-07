/**
 * 관문 화면이 지켜야 하는 것.
 *
 * 1. **Enter 는 로그인이다.** 한 폼에 `가입`·`로그인` 두 submit 이 있던 시절,
 *    마크업 순서상 `가입` 이 먼저라 Enter 가 가입을 눌렀다. 비밀번호가 맞는
 *    사람에게 "이미 존재하는 이메일입니다" 가 떴다
 * 2. 가입은 별도 주소다 — 같은 폼에 목적이 다른 submit 을 다시 두지 않는다
 * 3. 가입으로 넘어갈 때 **원래 가려던 주소를 들려 보낸다**
 * 4. 초대 링크로 들어오면 그 이메일이 미리 채워진다
 */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthContext, type AuthContextValue } from "../../app/authContext";
import { SignInPage } from "./SignInPage";

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
  vi.restoreAllMocks();
});

/** `/signup` 으로 넘어갔을 때 무엇을 들고 갔는지 그대로 보여 주는 대역. */
function SignupProbe() {
  const location = useLocation();
  return <p>가입 화면 · from={String((location.state as { from?: string } | null)?.from)}</p>;
}

function renderSignIn(
  signIn = vi.fn().mockResolvedValue(undefined),
  at = "/assessment",
) {
  const value: AuthContextValue = {
    status: "signed-out",
    signIn,
    signOut: async () => {},
    markSignedOut: () => {},
  };
  render(
    <AuthContext.Provider value={value}>
      <MemoryRouter initialEntries={[at]}>
        <Routes>
          <Route path="/signup" element={<SignupProbe />} />
          <Route path="*" element={<SignInPage />} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
  return signIn;
}

describe("SignInPage", () => {
  it("비밀번호 칸에서 Enter 를 치면 가입이 아니라 로그인이 나간다", async () => {
    const user = userEvent.setup();
    const signIn = renderSignIn();

    await user.type(screen.getByLabelText("이메일"), "member@example.com");
    await user.type(screen.getByLabelText("비밀번호"), "Password123!{Enter}");

    expect(signIn).toHaveBeenCalledTimes(1);
    // `signUpFirst` 가 참이면 서버가 409 "이미 존재하는 이메일입니다" 를 돌려준다.
    expect(signIn).toHaveBeenCalledWith("member@example.com", "Password123!", { signUpFirst: false });
  });

  it("로그인 화면에는 submit 이 하나뿐이다", () => {
    renderSignIn();

    const submits = screen
      .getAllByRole("button")
      .filter((button) => (button as HTMLButtonElement).type === "submit");
    expect(submits).toHaveLength(1);
    expect(submits[0]).toHaveAccessibleName("로그인");
  });

  it("회원가입은 버튼이 아니라 `/signup` 으로 가는 링크다", async () => {
    const user = userEvent.setup();
    renderSignIn();

    const link = screen.getByRole("link", { name: "회원가입" });
    expect(link).toHaveAttribute("href", "/signup");

    await user.click(link);
    // 원래 가려던 주소를 들려 보낸다 — 가입을 마치면 거기로 돌아간다.
    expect(screen.getByText("가입 화면 · from=/assessment")).toBeInTheDocument();
  });

  it("초대 해시도 함께 들고 간다 — 가입 직후 초대를 수락해야 한다", async () => {
    const user = userEvent.setup();
    renderSignIn(undefined, "/?x=1#invitation=inv-1&token=tok-1");

    await user.click(screen.getByRole("link", { name: "회원가입" }));

    expect(
      screen.getByText("가입 화면 · from=/?x=1#invitation=inv-1&token=tok-1"),
    ).toBeInTheDocument();
  });

  it("실패하면 이유를 적는다", async () => {
    const user = userEvent.setup();
    renderSignIn(vi.fn().mockRejectedValue(new Error("이메일 또는 비밀번호가 올바르지 않습니다.")));

    await user.type(screen.getByLabelText("이메일"), "member@example.com");
    await user.type(screen.getByLabelText("비밀번호"), "wrongpass1{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "이메일 또는 비밀번호가 올바르지 않습니다.",
    );
  });

  it("초대 링크로 들어오면 그 이메일을 미리 채운다", () => {
    window.history.replaceState(null, "", "/#invitation=inv-1&token=tok-1&email=invited%40example.com");
    renderSignIn();

    expect(screen.getByLabelText("이메일")).toHaveValue("invited@example.com");
    expect(screen.getByText(/invited@example.com 주소로 초대받았습니다/)).toBeInTheDocument();
  });
});
