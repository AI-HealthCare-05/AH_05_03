import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthContext, type AuthContextValue } from "../../../app/authContext";
import { StitchAccountChip } from "./StitchAccountChip";

afterEach(cleanup);

function renderChip(email?: string, displayName = "오성민", signOut = async () => {}) {
  const value: AuthContextValue = {
    status: "signed-in",
    email,
    signIn: async () => {},
    signOut,
    markSignedOut: () => {},
  };
  return render(
    <AuthContext.Provider value={value}>
      <MemoryRouter>
        <StitchAccountChip displayName={displayName} />
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

describe("StitchAccountChip", () => {
  it("이름과 이메일을 보여 주고, 클릭하면 가족 접근과 로그아웃이 나온다", () => {
    const signOut = vi.fn(async () => {});
    renderChip("fabxoe.ko@gmail.com", "오성민", signOut);

    const trigger = screen.getByRole("button", { name: /계정 메뉴/u });
    expect(trigger).toHaveTextContent("오성민(fabxoe.ko@gmail.com)");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    fireEvent.click(trigger);

    const familyAccess = screen.getByRole("menuitem", { name: "가족 접근" });
    expect(familyAccess).toHaveAttribute("href", "/account");
    fireEvent.click(screen.getByRole("menuitem", { name: "로그아웃" }));
    expect(signOut).toHaveBeenCalledTimes(1);
  });
});
