import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LocalDomainProvider } from "../../app/LocalDomainProvider";
import { serverApiClient } from "../../shared/api/serverApiClient";
import { AccountPage } from "./AccountPage";

const account = {
  account: {
    id: "account-id",
    email: "member@example.com",
    status: "active" as const,
    created_at: "2026-08-19T00:00:00Z",
  },
  subscription: { plan: "FREE" as const, status: "active" as const, renewed_at: null },
};

const subscription = {
  id: "subscription-id",
  plan: "FREE" as const,
  status: "active" as const,
  renewed_at: null,
  license_valid: true,
};

const receivedInvitation = {
  id: "invitation-id",
  household_id: "household-id",
  inviter_account_id: "inviter-id",
  invitee_email: "member@example.com",
  target_profile_ref: "R".repeat(43),
  status: "pending" as const,
  expires_at: "2026-08-27T00:00:00Z",
  accepted_by_account_id: null,
  accepted_at: null,
  declined_at: null,
  cancelled_at: null,
  created_at: "2026-08-20T00:00:00Z",
  updated_at: "2026-08-20T00:00:00Z",
  row_version: 1,
};

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
  vi.restoreAllMocks();
});

describe("AccountPage", () => {
  it("가입 버튼은 가입 API를 먼저 호출한 뒤 로그인한다", async () => {
    const user = userEvent.setup();
    vi.spyOn(serverApiClient, "refresh").mockRejectedValue(new Error("no session"));
    const signUp = vi.spyOn(serverApiClient, "signUp").mockResolvedValue({
      account_id: "account-id",
      email: "new@example.com",
      status: "active",
    });
    const login = vi.spyOn(serverApiClient, "login").mockResolvedValue({
      access_token: "access",
      token_type: "bearer",
      expires_in: 900,
    });
    mockAccountReads();

    renderAccountPage();
    await user.type(screen.getByRole("textbox", { name: "이메일" }), "new@example.com");
    await user.type(screen.getByLabelText("비밀번호"), "Password123!");
    await user.click(screen.getByRole("button", { name: "가입" }));

    expect(await screen.findByText("가입하고 로그인했습니다.")).toBeInTheDocument();
    expect(signUp).toHaveBeenCalledWith("new@example.com", "Password123!");
    expect(login).toHaveBeenCalledWith("new@example.com", "Password123!");
    expect(signUp.mock.invocationCallOrder[0]).toBeLessThan(login.mock.invocationCallOrder[0] ?? 0);
  });

  it("로그인 후 구독·가정·초대 관리 화면을 표시한다", async () => {
    const user = userEvent.setup();
    vi.spyOn(serverApiClient, "refresh").mockRejectedValue(new Error("no session"));
    vi.spyOn(serverApiClient, "login").mockResolvedValue({ access_token: "access", token_type: "bearer", expires_in: 900 });
    mockAccountReads();

    renderAccountPage();
    await user.type(screen.getByRole("textbox", { name: "이메일" }), "member@example.com");
    await user.type(screen.getByLabelText("비밀번호"), "Password123!");
    await user.click(screen.getByRole("button", { name: "로그인" }));

    expect(await screen.findByRole("heading", { name: "member@example.com" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "가입한 가정 0개" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "기존 로컬 프로필에 서비스 계정 초대" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "계정 종료" })).toBeInTheDocument();
  });

  it("가정 구성원을 UUID 대신 현재 계정과 마스킹 이메일로 구분한다", async () => {
    vi.spyOn(serverApiClient, "refresh").mockResolvedValue({ access_token: "access", token_type: "bearer", expires_in: 900 });
    mockAccountReads();
    vi.mocked(serverApiClient.listHouseholds).mockResolvedValue([{
      id: "household-id",
      status: "active",
      created_at: "2026-08-20T00:00:00Z",
      row_version: 1,
    }]);
    vi.spyOn(serverApiClient, "listHouseholdMemberships").mockResolvedValue([{
      id: "membership-id",
      household_id: "household-id",
      account_id: "account-id",
      masked_email: "mem***@example.com",
      local_profile_ref: null,
      status: "active",
      joined_at: "2026-08-20T00:00:00Z",
      left_at: null,
      row_version: 1,
    }]);

    renderAccountPage();
    await screen.findByRole("heading", { name: "member@example.com" });
    await userEvent.setup().click(screen.getByRole("button", { name: "멤버 보기" }));

    expect(await screen.findByText("내 계정", { selector: ".membership-identity strong" })).toBeInTheDocument();
    expect(screen.getByText("나")).toBeInTheDocument();
    expect(screen.getByText("mem***@example.com")).toBeInTheDocument();
    expect(screen.getByText("로컬 프로필 미연결")).toBeInTheDocument();
    expect(screen.queryByText(/account-id/u)).not.toBeInTheDocument();
  });

  it("계정 종료 전에 이메일 재확인을 요구하고 로컬 데이터 보존 결과를 알린다", async () => {
    const user = userEvent.setup();
    vi.spyOn(serverApiClient, "refresh").mockResolvedValue({ access_token: "access", token_type: "bearer", expires_in: 900 });
    vi.spyOn(serverApiClient, "closeAccount").mockResolvedValue({
      account_id: "account-id",
      status: "closed",
      closed_at: "2026-08-20T00:00:00Z",
      subscription_status: "cancelled",
      local_data_deleted: false,
    });
    mockAccountReads();

    renderAccountPage();
    await screen.findByRole("heading", { name: "member@example.com" });
    await user.click(screen.getByRole("button", { name: "계정 종료" }));
    const dialog = screen.getByRole("alertdialog", { name: "서비스 계정을 종료할까요?" });
    expect(dialog).toBeInTheDocument();
    await user.type(within(dialog).getByRole("textbox", { name: "계정 이메일 입력" }), "member@example.com");
    await user.click(within(dialog).getByRole("button", { name: "계정 종료" }));

    expect(await screen.findByText("서비스 계정을 종료했습니다. 이 브라우저의 로컬 건강정보는 삭제되지 않았습니다.")).toBeInTheDocument();
    expect(serverApiClient.closeAccount).toHaveBeenCalledOnce();
  });

  it("메일 링크 fragment의 토큰을 일치하는 받은 초대에만 채운다", async () => {
    const token = "T".repeat(43);
    vi.spyOn(serverApiClient, "refresh").mockResolvedValue({ access_token: "access", token_type: "bearer", expires_in: 900 });
    mockAccountReads();
    vi.mocked(serverApiClient.listInvitations).mockResolvedValue({
      sent: [],
      received: [receivedInvitation],
    });
    window.history.replaceState(null, "", `/account#invitation=invitation-id&token=${token}`);

    renderAccountPage();

    expect(await screen.findByPlaceholderText("이메일 초대 토큰")).toHaveValue(token);
    expect(screen.queryByText("연결할 기존 프로필")).not.toBeInTheDocument();
  });

  it("수신자는 프로필을 다시 선택하지 않고 발신자가 정한 참조에 연결한다", async () => {
    const user = userEvent.setup();
    const token = "T".repeat(43);
    vi.spyOn(serverApiClient, "refresh").mockResolvedValue({ access_token: "access", token_type: "bearer", expires_in: 900 });
    const accept = vi.spyOn(serverApiClient, "acceptInvitation").mockResolvedValue({
      ...receivedInvitation,
      status: "accepted",
      accepted_by_account_id: "account-id",
      accepted_at: "2026-08-20T01:00:00Z",
    });
    const createLink = vi.spyOn(serverApiClient, "createProfileLink").mockResolvedValue({
      id: "link-id",
      household_id: receivedInvitation.household_id,
      account_id: "account-id",
      invitation_id: receivedInvitation.id,
      local_profile_ref: receivedInvitation.target_profile_ref,
      status: "active",
      linked_at: "2026-08-20T01:00:00Z",
      unlinked_at: null,
      row_version: 1,
    });
    mockAccountReads();
    vi.mocked(serverApiClient.listInvitations).mockResolvedValue({ sent: [], received: [receivedInvitation] });
    window.history.replaceState(null, "", `/account#invitation=invitation-id&token=${token}`);

    renderAccountPage();
    await user.click(await screen.findByRole("button", { name: "초대 수락" }));

    expect(await screen.findByText("초대를 수락하고 서비스 계정을 연결했습니다. 건강정보를 받으려면 기기 연결이 필요합니다.")).toBeInTheDocument();
    expect(accept).toHaveBeenCalledWith(receivedInvitation.id, token);
    expect(createLink).toHaveBeenCalledWith(receivedInvitation.id, receivedInvitation.target_profile_ref);
  });

  it("초대 처리 뒤 주소의 원문 토큰 fragment를 제거한다", async () => {
    const user = userEvent.setup();
    const token = "T".repeat(43);
    vi.spyOn(serverApiClient, "refresh").mockResolvedValue({ access_token: "access", token_type: "bearer", expires_in: 900 });
    vi.spyOn(serverApiClient, "declineInvitation").mockResolvedValue({
      ...receivedInvitation,
      status: "declined",
      declined_at: "2026-08-20T01:00:00Z",
    });
    mockAccountReads();
    vi.mocked(serverApiClient.listInvitations).mockResolvedValue({ sent: [], received: [receivedInvitation] });
    window.history.replaceState(null, "", `/account#invitation=invitation-id&token=${token}`);

    renderAccountPage();
    await user.click(await screen.findByRole("button", { name: "거절" }));

    expect(await screen.findByText("초대를 거절했습니다.")).toBeInTheDocument();
    expect(window.location.hash).toBe("");
  });

  it("다른 계정으로 초대 링크를 열면 초대 계정으로 전환시킨다", async () => {
    const user = userEvent.setup();
    const token = "T".repeat(43);
    const targetEmail = "recipient@example.com";
    vi.spyOn(serverApiClient, "refresh").mockResolvedValue({ access_token: "access", token_type: "bearer", expires_in: 900 });
    vi.spyOn(serverApiClient, "logout").mockResolvedValue();
    mockAccountReads();
    vi.mocked(serverApiClient.listInvitations).mockResolvedValue({
      sent: [{ ...receivedInvitation, invitee_email: targetEmail }],
      received: [],
    });
    window.history.replaceState(null, "", `/account#invitation=invitation-id&token=${token}`);

    renderAccountPage();

    expect(await screen.findByRole("heading", { name: "이 초대는 다른 계정으로 도착했습니다" })).toBeInTheDocument();
    expect(screen.getByText(targetEmail)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "초대받은 계정으로 전환" }));

    expect(await screen.findByRole("heading", { name: "초대받은 계정으로 계속하기" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "이메일" })).toHaveValue(targetEmail);
    expect(window.location.hash).toContain("email=recipient%40example.com");
  });
});

function mockAccountReads() {
  vi.spyOn(serverApiClient, "getAccount").mockResolvedValue(account);
  vi.spyOn(serverApiClient, "getSubscription").mockResolvedValue(subscription);
  vi.spyOn(serverApiClient, "listHouseholds").mockResolvedValue([]);
  vi.spyOn(serverApiClient, "listInvitations").mockResolvedValue({ sent: [], received: [] });
  vi.spyOn(serverApiClient, "listProfileLinks").mockResolvedValue([]);
}

function renderAccountPage() {
  render(
    <MemoryRouter>
      <LocalDomainProvider databaseName={`ieobom-account-test-${crypto.randomUUID()}`}>
        <AccountPage />
      </LocalDomainProvider>
    </MemoryRouter>,
  );
}
