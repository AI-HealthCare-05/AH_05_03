import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";

import { AuthContext, type AuthContextValue } from "../../../app/authContext";
import { StitchAccountChip } from "./StitchAccountChip";

afterEach(cleanup);

function renderChip(email?: string, displayName = "오성민") {
  const value: AuthContextValue = {
    status: "signed-in",
    email,
    signIn: async () => {},
    signOut: async () => {},
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
  it("이름과 이메일을 붙여 계정 화면으로 연결한다", () => {
    renderChip("fabxoe.ko@gmail.com");

    const link = screen.getByRole("link", { name: /계정 관리/u });
    expect(link).toHaveAttribute("href", "/account");
    expect(link).toHaveTextContent("오성민(fabxoe.ko@gmail.com)");
  });
});
