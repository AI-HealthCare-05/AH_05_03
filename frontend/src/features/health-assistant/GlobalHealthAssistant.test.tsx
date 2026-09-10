import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LocalDomainContextValue } from "../../app/localDomainContext";
import { LocalDomainContext } from "../../app/localDomainContext";
import type { FamilyProfile } from "../../shared/local/domainContracts";
import type { LocalDomainRuntime } from "../../shared/local/localDomainRuntime";
import { GlobalHealthAssistant } from "./GlobalHealthAssistant";

vi.mock("./HealthAssistantDrawer", () => ({
  HealthAssistantDrawer: ({
    profile,
    isOpen,
    contextLabel,
    onClose,
  }: {
    profile?: FamilyProfile;
    isOpen: boolean;
    contextLabel?: string;
    onClose: () => void;
  }) => {
    if (!isOpen) return null;
    return (
      <div data-testid="mock-health-assistant">
        <span>봄이 대화창 ({profile?.displayName})</span>
        {contextLabel && <span>현재화면: {contextLabel}</span>}
        <button type="button" onClick={onClose}>
          창닫기
        </button>
      </div>
    );
  },
}));

describe("GlobalHealthAssistant (채널톡 스타일 전역 연속형 건강 비서)", () => {
  const mockProfile: FamilyProfile = {
    id: "profile-test-1",
    displayName: "가족 대표",
    relationship: "본인",
    birthDate: "1980-01-01",
    gender: "male",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as unknown as FamilyProfile;

  const mockDomainContext = {
    profiles: [mockProfile],
    runtime: {} as LocalDomainRuntime,
    loading: false,
    hiddenProfiles: [],
  } as unknown as LocalDomainContextValue;

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("우측 하단에 채널톡 스타일 플로팅 런처 버튼이 상시 렌더링된다", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <LocalDomainContext.Provider value={mockDomainContext}>
          <GlobalHealthAssistant />
        </LocalDomainContext.Provider>
      </MemoryRouter>,
    );

    const launcherBtn = screen.getByRole("button", { name: /건강 비서 봄이와 대화하기/i });
    expect(launcherBtn).toBeInTheDocument();
    expect(launcherBtn).toHaveClass("channel-talk-launcher-btn");
  });

  it("런처 클릭 시 채널톡 스타일 플로팅 팝오버가 열리고 대화창과 현재 페이지 맥락이 표시된다", async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={["/pain-diary"]}>
        <LocalDomainContext.Provider value={mockDomainContext}>
          <GlobalHealthAssistant />
        </LocalDomainContext.Provider>
      </MemoryRouter>,
    );

    const launcherBtn = screen.getByRole("button", { name: /건강 비서 봄이와 대화하기/i });
    await user.click(launcherBtn);

    // 팝오버 메신저와 현재 페이지 맥락 태그 표시 확인
    expect(screen.getByTestId("mock-health-assistant")).toBeInTheDocument();
    expect(screen.getAllByText(/통증 다이어리/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("가족 대표")).toBeInTheDocument();
    expect(screen.getByText(/님 대화 중/i)).toBeInTheDocument();

    // 닫기 동작
    const closeBtn = screen.getByRole("button", { name: /창닫기/i });
    await user.click(closeBtn);
    expect(screen.queryByTestId("mock-health-assistant")).not.toBeInTheDocument();
  });
});
