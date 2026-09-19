import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createLocalDomainRuntime } from "../shared/local/localDomainRuntime";
import { serverApiClient } from "../shared/api/serverApiClient";
import { AuthContext, type AuthContextValue } from "./authContext";
import { LocalDomainProvider } from "./LocalDomainProvider";
import { useLocalDomain } from "./localDomainContext";

vi.mock("../shared/local/localDomainRuntime", () => ({
  createLocalDomainRuntime: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.mocked(createLocalDomainRuntime).mockReset();
});

function Probe() {
  const { error, loading, profiles, runtime } = useLocalDomain();
  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="error">{error ?? ""}</span>
      <span data-testid="profiles">{profiles.length}</span>
      <span data-testid="runtime">{runtime ? "ready" : "missing"}</span>
    </div>
  );
}

describe("LocalDomainProvider 서버 정본 경계", () => {
  it("로그인 상태에서 서버 가정 조회가 실패해도 빈 IndexedDB로 내려가지 않는다", async () => {
    vi.spyOn(serverApiClient, "listHouseholds").mockRejectedValue(new Error("서버 가정 조회 실패"));
    const auth: AuthContextValue = {
      status: "signed-in",
      accountId: "account-id",
      email: "member@example.com",
      signIn: async () => {},
      signOut: async () => {},
      markSignedOut: () => {},
    };

    render(
      <AuthContext.Provider value={auth}>
        <LocalDomainProvider>
          <Probe />
        </LocalDomainProvider>
      </AuthContext.Provider>,
    );

    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    expect(screen.getByTestId("error")).toHaveTextContent("서버 가정 조회 실패");
    expect(screen.getByTestId("profiles")).toHaveTextContent("0");
    expect(screen.getByTestId("runtime")).toHaveTextContent("missing");
    expect(createLocalDomainRuntime).not.toHaveBeenCalled();
  });
});
