/**
 * `markSignedOut(message)` 가 로그인 화면까지 문구를 실어 보내는지 확인한다.
 *
 * **왜 이 파일이 생겼나.** `AccountPage` 가 회원 탈퇴에 성공하자마자
 * `markSignedOut()` 을 부르면 `RootLayout` 이 그 화면을 로그인 화면으로
 * 바꿔치기한다 — `AccountPage` 자신이 띄우려던 성공 메시지는 그 전환 안에서
 * 아무도 못 본다("버튼을 눌러도 반응이 없다"의 실제 원인이었다). 문구를
 * `markSignedOut` 인자로 실어 보내고 로그인 화면이 그걸 이어받아 보여 주는
 * 통로가 실제로 이어지는지는 이 provider 자체의 계약이라 여기서 지킨다.
 */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { serverApiClient } from "../shared/api/serverApiClient";
import { AuthProvider } from "./AuthProvider";
import { useAuth } from "./authContext";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Probe() {
  const { status, signedOutNotice, markSignedOut, signIn } = useAuth();
  return (
    <div>
      <p data-testid="status">{status}</p>
      <p data-testid="notice">{signedOutNotice ?? ""}</p>
      <button type="button" onClick={() => markSignedOut("회원 탈퇴가 완료되었습니다. 건강정보는 보존됩니다.")}>
        탈퇴
      </button>
      <button type="button" onClick={() => void signIn("member@example.com", "Password123!")}>
        로그인
      </button>
    </div>
  );
}

function renderProbe() {
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
}

describe("AuthProvider", () => {
  it("markSignedOut(message) 가 넘긴 문구를 signedOutNotice 로 노출한다", async () => {
    vi.spyOn(serverApiClient, "refresh").mockRejectedValue(new Error("세션 없음"));
    const user = userEvent.setup();

    renderProbe();
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("signed-out"));
    expect(screen.getByTestId("notice")).toHaveTextContent("");

    await user.click(screen.getByRole("button", { name: "탈퇴" }));

    expect(screen.getByTestId("notice")).toHaveTextContent("회원 탈퇴가 완료되었습니다. 건강정보는 보존됩니다.");
  });

  it("다음 로그인이 성공하면 지난 안내문을 지운다", async () => {
    vi.spyOn(serverApiClient, "refresh").mockRejectedValue(new Error("세션 없음"));
    vi.spyOn(serverApiClient, "login").mockResolvedValue({ access_token: "access", token_type: "bearer", expires_in: 900 });
    vi.spyOn(serverApiClient, "getAccount").mockResolvedValue({
      account: { id: "account-id", email: "member@example.com", status: "active", created_at: "2026-01-01T00:00:00Z" },
      subscription: { plan: "FREE", status: "active", renewed_at: null },
    });
    const user = userEvent.setup();

    renderProbe();
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("signed-out"));
    await user.click(screen.getByRole("button", { name: "탈퇴" }));
    expect(screen.getByTestId("notice")).toHaveTextContent("회원 탈퇴가 완료되었습니다. 건강정보는 보존됩니다.");

    await user.click(screen.getByRole("button", { name: "로그인" }));

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("signed-in"));
    expect(screen.getByTestId("notice")).toHaveTextContent("");
  });
});
