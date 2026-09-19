import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { writeWallDevice } from "./wallDeviceStore";
import { WallOverviewPage } from "./WallOverviewPage";

afterEach(() => {
  cleanup();
  window.localStorage?.clear();
  vi.unstubAllGlobals();
});

describe("WallOverviewPage", () => {
  it("새로고침 뒤에 구성원 세션을 복원하지 않는다", async () => {
    writeWallDevice({
      householdId: "hh-1",
      deviceId: "dev-1",
      deviceToken: "wall-token",
      displayName: "거실 벽",
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/household-devices/me/profiles")) {
        return new Response(
          JSON.stringify({
            success: true,
            data: {
              household_id: "hh-1",
              items: [{ id: "p-1", display_name: "오성민", relationship: "본인", member_role: "adult_member" }],
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.endsWith("/household-devices/me/member-sessions") && init?.method === "POST") {
        return new Response(
          JSON.stringify({
            success: true,
            data: {
              id: "sess-1",
              profile_id: "p-1",
              household_id: "hh-1",
              member_role: "adult_member",
              must_change: false,
              session_token: "member-session",
              expires_at: new Date(Date.now() + 60_000).toISOString(),
            },
          }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ success: false }), { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    const { unmount } = render(
      <MemoryRouter>
        <WallOverviewPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "가족 개요" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "오성민 · 본인" }));
    await user.type(screen.getByLabelText("구성원 PIN"), "482913");
    await user.click(screen.getByRole("button", { name: "이 구성원으로" }));
    expect(await screen.findByText(/지금 오성민 권한입니다/u)).toBeInTheDocument();

    unmount();
    render(
      <MemoryRouter>
        <WallOverviewPage />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.queryByText(/지금 오성민 권한입니다/u)).not.toBeInTheDocument();
    });
    expect(screen.getByText("구성원을 고르면 PIN을 묻습니다.")).toBeInTheDocument();
  });
});
