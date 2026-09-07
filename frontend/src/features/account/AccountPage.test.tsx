import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthContext } from "../../app/authContext";
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
  window.localStorage?.clear();
  window.history.replaceState(null, "", "/");
  vi.restoreAllMocks();
});

describe("AccountPage", () => {
  /**
   * 로그인·가입은 관문(`SignInPage`)이 한다. 이 화면은 **이미 로그인한 사람**만
   * 보므로 여기서는 세션이 살아 있는 상태(`refresh` 성공)에서 시작한다.
   * 인증 자체의 검사는 `SignInPage.test.tsx` 에 있다.
   */
  it("계정을 읽어 구독·가정·초대 관리 화면을 표시한다", async () => {
    vi.spyOn(serverApiClient, "refresh").mockResolvedValue({ access_token: "access", token_type: "bearer", expires_in: 900 });
    mockAccountReads();

    renderAccountPage();

    expect(await screen.findByRole("heading", { name: "member@example.com" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "소속 가정" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "기존 로컬 프로필에 서비스 계정 초대" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "계정 종료" })).toBeInTheDocument();
  });

  it("가정 구성원을 UUID 대신 현재 계정과 마스킹 이메일로 구분한다", async () => {
    vi.spyOn(serverApiClient, "refresh").mockResolvedValue({ access_token: "access", token_type: "bearer", expires_in: 900 });
    mockAccountReads();
    vi.mocked(serverApiClient.listHouseholds).mockResolvedValue([{
      id: "household-id",
      master_account_id: "account-id",
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

    expect(await screen.findByText("내 계정", { selector: ".membership-identity strong" })).toBeInTheDocument();
    expect(screen.getByText("나")).toBeInTheDocument();
    expect(screen.getByText("member@example.com", { selector: ".membership-identity small" })).toBeInTheDocument();
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

    expect(await screen.findByText("서비스 계정을 종료했습니다. 건강정보는 보존됩니다.")).toBeInTheDocument();
    expect(serverApiClient.closeAccount).toHaveBeenCalledWith(false);
  });

  it("계정 종료 시 건강정보 영구 폐기를 선택하면 purge=true로 닫고 폐기 완료 메시지를 보여준다", async () => {
    const user = userEvent.setup();
    vi.spyOn(serverApiClient, "refresh").mockResolvedValue({ access_token: "access", token_type: "bearer", expires_in: 900 });
    const closeSpy = vi.spyOn(serverApiClient, "closeAccount").mockResolvedValue({
      account_id: "account-id",
      status: "closed",
      closed_at: "2026-08-20T00:00:00Z",
      subscription_status: "cancelled",
      local_data_deleted: false,
      health_data_purged: true,
    });
    mockAccountReads();

    renderAccountPage();
    await screen.findByRole("heading", { name: "member@example.com" });
    await user.click(screen.getByRole("button", { name: "계정 종료" }));
    const dialog = screen.getByRole("alertdialog", { name: "서비스 계정을 종료할까요?" });
    expect(dialog).toBeInTheDocument();

    expect(within(dialog).getByRole("button", { name: ".ieobom 백업 다운로드" })).toBeInTheDocument();
    const purgeCheckbox = within(dialog).getByRole("checkbox", { name: "서버에 저장된 내 건강정보를 즉시 영구 폐기합니다" });
    expect(purgeCheckbox).toBeInTheDocument();
    await user.click(purgeCheckbox);

    await user.type(within(dialog).getByRole("textbox", { name: "계정 이메일 입력" }), "member@example.com");
    await user.click(within(dialog).getByRole("button", { name: "계정 종료" }));

    expect(await screen.findByText("서비스 계정을 종료하고 서버의 건강정보를 영구 폐기했습니다.")).toBeInTheDocument();
    expect(closeSpy).toHaveBeenCalledWith(true);
  });

  it("이미 활성 가정이 있으면 가정 만들기 버튼이 비활성화된다", async () => {
    vi.spyOn(serverApiClient, "refresh").mockResolvedValue({ access_token: "access", token_type: "bearer", expires_in: 900 });
    mockAccountReads();
    vi.mocked(serverApiClient.listHouseholds).mockResolvedValue([{
      id: "household-1",
      master_account_id: "account-id",
      status: "active",
      created_at: "2026-08-20T00:00:00Z",
      row_version: 1,
    }]);

    renderAccountPage();
    await screen.findByRole("heading", { name: "member@example.com" });

    const createButton = screen.getByRole("button", { name: "가정 만들기" });
    expect(createButton).toBeDisabled();
    expect(createButton).toHaveAttribute("title", "이미 소속된 가정이 있어 새 가정을 만들 수 없습니다.");
  });

  it("마스터는 다른 활성 멤버에게 마스터 권한을 위임할 수 있다", async () => {
    const user = userEvent.setup();
    vi.spyOn(serverApiClient, "refresh").mockResolvedValue({ access_token: "access", token_type: "bearer", expires_in: 900 });
    mockAccountReads();
    vi.mocked(serverApiClient.listHouseholds).mockResolvedValue([{
      id: "household-1",
      master_account_id: "account-id",
      status: "active",
      created_at: "2026-08-20T00:00:00Z",
      row_version: 1,
    }]);
    vi.spyOn(serverApiClient, "listHouseholdMemberships").mockResolvedValue([
      {
        id: "mem-1",
        household_id: "household-1",
        account_id: "account-id",
        masked_email: "mem***@example.com",
        local_profile_ref: null,
        status: "active",
        joined_at: "2026-08-20T00:00:00Z",
        left_at: null,
        row_version: 1,
        is_master: true,
      },
      {
        id: "mem-2",
        household_id: "household-1",
        account_id: "other-id",
        masked_email: "oth***@example.com",
        local_profile_ref: null,
        status: "active",
        joined_at: "2026-08-21T00:00:00Z",
        left_at: null,
        row_version: 1,
        is_master: false,
      },
    ]);
    const transferSpy = vi.spyOn(serverApiClient, "transferHouseholdMaster").mockResolvedValue({
      id: "household-1",
      master_account_id: "other-id",
      status: "active",
      created_at: "2026-08-20T00:00:00Z",
      row_version: 2,
    });

    renderAccountPage();
    await screen.findByRole("heading", { name: "member@example.com" });

    const transferButton = await screen.findByRole("button", { name: "마스터 위임" });
    expect(transferButton).toBeInTheDocument();
    await user.click(transferButton);

    const dialog = screen.getByRole("alertdialog", { name: "가정 마스터 권한을 위임할까요?" });
    expect(dialog).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "마스터 위임" }));

    expect(transferSpy).toHaveBeenCalledWith("household-1", "other-id");
    expect(await screen.findByText("oth***@example.com 님에게 가정 마스터 권한을 위임했습니다.")).toBeInTheDocument();
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

  it("URL 해시가 비어 있어도 스토리지에 초대 정보가 있으면 받은 초대의 토큰이 자동으로 채워진다", async () => {
    const token = "T".repeat(43);
    const { savePendingInvitation } = await import("./invitationStorage");
    savePendingInvitation({
      invitationId: "invitation-id",
      token,
      email: "member@example.com",
    });

    vi.spyOn(serverApiClient, "refresh").mockResolvedValue({ access_token: "access", token_type: "bearer", expires_in: 900 });
    mockAccountReads();
    vi.mocked(serverApiClient.listInvitations).mockResolvedValue({ sent: [], received: [receivedInvitation] });
    window.history.replaceState(null, "", "/account");

    renderAccountPage();

    const tokenInput = await screen.findByPlaceholderText("이메일 초대 토큰");
    expect(tokenInput).toHaveValue(token);
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

    // 로그인 화면은 관문이 그린다. 이 화면이 지킬 것은 **초대 이메일을 주소에
    // 남겨 관문이 미리 채울 수 있게 하는 것** 이다.
    await waitFor(() => expect(window.location.hash).toContain("email=recipient%40example.com"));
    expect(serverApiClient.logout).toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: "이 초대는 다른 계정으로 도착했습니다" })).not.toBeInTheDocument();
  });

  it("나간 구성원은 가족 프로필 연결됨 문구를 숨기고 x 버튼으로 이력을 삭제할 수 있다", async () => {
    const user = userEvent.setup();
    vi.spyOn(serverApiClient, "refresh").mockResolvedValue({ access_token: "access", token_type: "bearer", expires_in: 900 });
    mockAccountReads();
    vi.mocked(serverApiClient.listHouseholds).mockResolvedValue([{
      id: "household-id",
      master_account_id: "account-id",
      status: "active",
      created_at: "2026-08-20T00:00:00Z",
      row_version: 1,
    }]);
    vi.spyOn(serverApiClient, "listHouseholdMemberships").mockResolvedValue([
      {
        id: "membership-master",
        household_id: "household-id",
        account_id: "account-id",
        masked_email: "member@example.com",
        local_profile_ref: null,
        status: "active",
        joined_at: "2026-08-20T00:00:00Z",
        left_at: null,
        row_version: 1,
      },
      {
        id: "membership-left",
        household_id: "household-id",
        account_id: "other-account-id",
        masked_email: "left-user@example.com",
        local_profile_ref: "dummy-profile-ref",
        status: "left",
        joined_at: "2026-08-20T00:00:00Z",
        left_at: "2026-08-21T00:00:00Z",
        row_version: 2,
      },
    ]);
    const deleteSpy = vi.spyOn(serverApiClient, "deleteHouseholdMembership").mockResolvedValue();

    renderAccountPage();
    await screen.findByRole("heading", { name: "member@example.com" });

    // 나간 구성원(left-user@example.com) 영역 확인
    expect(screen.getByText("나감")).toBeInTheDocument();
    // 나간 구성원은 "가족 프로필 연결됨" 문구가 표시되지 않아야 함
    expect(screen.queryByText("가족 프로필 연결됨")).not.toBeInTheDocument();

    // x 버튼(이력 삭제) 클릭
    const deleteBtn = screen.getByRole("button", { name: /이력 삭제/u });
    expect(deleteBtn).toBeInTheDocument();
    await user.click(deleteBtn);

    // 확인 모달 확인
    const dialog = screen.getByRole("alertdialog", { name: "구성원 이력을 삭제할까요?" });
    expect(dialog).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "이력 삭제" }));

    // API 호출 검증
    expect(deleteSpy).toHaveBeenCalledWith("household-id", "membership-left");
    expect(await screen.findByText("구성원 이력을 삭제했습니다.")).toBeInTheDocument();
  });
});

function mockAccountReads() {
  vi.spyOn(serverApiClient, "getAccount").mockResolvedValue(account);
  vi.spyOn(serverApiClient, "getSubscription").mockResolvedValue(subscription);
  vi.spyOn(serverApiClient, "listHouseholds").mockResolvedValue([]);
  vi.spyOn(serverApiClient, "listInvitations").mockResolvedValue({ sent: [], received: [] });
  vi.spyOn(serverApiClient, "listProfileLinks").mockResolvedValue([]);
}

/**
 * 관문은 붙이되 **진짜 `AuthProvider` 는 쓰지 않는다.** 그쪽은 마운트하자마자
 * `refresh()` 를 던져서, 여기서 세운 spy 와 무관한 네트워크 호출이 섞인다.
 * 이 파일이 보는 것은 계정 화면이지 세션 복구가 아니다.
 */
const AUTH_STUB = {
  status: "signed-in" as const,
  email: account.account.email,
  signIn: async () => {},
  signOut: async () => {},
  markSignedOut: () => {},
};

function renderAccountPage() {
  render(
    <MemoryRouter>
      <AuthContext.Provider value={AUTH_STUB}>
        <LocalDomainProvider databaseName={`ieobom-account-test-${crypto.randomUUID()}`}>
          <AccountPage />
        </LocalDomainProvider>
      </AuthContext.Provider>
    </MemoryRouter>,
  );
}
