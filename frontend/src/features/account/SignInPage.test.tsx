/**
 * 관문 화면이 지켜야 하는 것.
 *
 * 1. **Enter 는 로그인이다.** 한 폼에 `가입`·`로그인` 두 submit 이 있던 시절,
 *    마크업 순서상 `가입` 이 먼저라 Enter 가 가입을 눌렀다. 비밀번호가 맞는
 *    사람에게 "이미 존재하는 이메일입니다" 가 떴다
 * 2. 가입은 별도 화면이다 — 같은 폼에 목적이 다른 submit 을 다시 두지 않는다
 * 3. 초대 링크로 들어오면 그 이메일이 미리 채워진다
 */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthContext, type AuthContextValue } from "../../app/authContext";
import { SignInPage } from "./SignInPage";

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
  vi.restoreAllMocks();
});

function renderSignIn(signIn = vi.fn().mockResolvedValue(undefined)) {
  const value: AuthContextValue = {
    status: "signed-out",
    signIn,
    signOut: async () => {},
    markSignedOut: () => {},
  };
  render(
    <AuthContext.Provider value={value}>
      <SignInPage />
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

  it("회원가입을 누르면 가입 화면으로 바뀌고 거기서 가입한다", async () => {
    const user = userEvent.setup();
    const signIn = renderSignIn();

    await user.click(screen.getByRole("button", { name: "회원가입" }));
    expect(screen.getByRole("heading", { name: "이어봄 시작하기" })).toBeInTheDocument();
    // 되돌아가는 링크는 "로그인" 이지만 submit 은 여전히 하나뿐이어야 한다.
    const submits = screen
      .getAllByRole("button")
      .filter((button) => (button as HTMLButtonElement).type === "submit");
    expect(submits).toHaveLength(1);
    expect(submits[0]).toHaveAccessibleName("가입하기");

    await user.type(screen.getByLabelText("이메일"), "new@example.com");
    await user.type(screen.getByLabelText("비밀번호"), "Password123!{Enter}");

    expect(signIn).toHaveBeenCalledWith("new@example.com", "Password123!", { signUpFirst: true });
  });

  it("가입 화면에서도 로그인으로 되돌아갈 수 있다", async () => {
    const user = userEvent.setup();
    renderSignIn();

    await user.click(screen.getByRole("button", { name: "회원가입" }));
    await user.click(screen.getByRole("button", { name: "로그인" }));

    expect(screen.getByRole("heading", { name: "로그인하고 시작하세요" })).toBeInTheDocument();
  });

  it("실패하면 이유를 적고, 화면을 바꾸면 지운다", async () => {
    const user = userEvent.setup();
    renderSignIn(vi.fn().mockRejectedValue(new Error("이메일 또는 비밀번호가 올바르지 않습니다.")));

    await user.type(screen.getByLabelText("이메일"), "member@example.com");
    await user.type(screen.getByLabelText("비밀번호"), "wrongpass1{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("이메일 또는 비밀번호가 올바르지 않습니다.");

    await user.click(screen.getByRole("button", { name: "회원가입" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("초대 링크로 들어오면 그 이메일을 미리 채운다", () => {
    window.history.replaceState(null, "", "/#invitation=inv-1&token=tok-1&email=invited%40example.com");
    renderSignIn();

    expect(screen.getByLabelText("이메일")).toHaveValue("invited@example.com");
    expect(screen.getByText(/invited@example.com 주소로 초대받았습니다/)).toBeInTheDocument();
  });
});
