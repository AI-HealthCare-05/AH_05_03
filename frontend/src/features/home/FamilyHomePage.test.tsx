import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";

import { AuthContext, type AuthContextValue } from "../../app/authContext";
import { LocalDomainProvider } from "../../app/LocalDomainProvider";
import { FamilyHomePage } from "./FamilyHomePage";

afterEach(() => {
  cleanup();
  sessionStorage.clear();
});

describe("FamilyHomePage 구성원 추가", () => {
  it("구성원 추가 모달로 로컬 프로필을 만들고 임시 PIN을 한 번 보여 준다", async () => {
    const user = userEvent.setup();
    renderFamilyHome();

    const addButton = await screen.findByRole("button", { name: "구성원 추가" });
    await waitFor(() => {
      expect(addButton).toBeEnabled();
    });
    await user.click(addButton);

    expect(screen.getByRole("dialog", { name: "구성원 추가" })).toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "이름 또는 호칭" }), "오성민");
    await user.selectOptions(screen.getByRole("combobox", { name: "관계" }), "본인");
    await user.click(screen.getByRole("button", { name: "프로필 저장" }));

    expect(await screen.findByRole("dialog", { name: "이번만 보이는 임시 PIN" })).toBeInTheDocument();
    expect(screen.getByLabelText("임시 PIN").textContent).toMatch(/^\d{6}$/);
    await user.click(screen.getByRole("button", { name: "확인했습니다" }));

    expect(await screen.findByRole("button", { name: "오성민 · 본인" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "오성민 · 본인" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("dialog", { name: "구성원 추가" })).not.toBeInTheDocument();
  });

  it("프로필 관리에서 이름을 바꾸고 빈 프로필을 숨긴 뒤 복원한다", async () => {
    const user = userEvent.setup();
    renderFamilyHome();
    await addMember(user, "오성민", "본인");

    await user.click(screen.getByRole("button", { name: "오성민 프로필 관리" }));
    const nameInput = screen.getByRole("textbox", { name: "이름 또는 호칭" });
    await user.clear(nameInput);
    await user.type(nameInput, "오성");
    await user.click(screen.getByRole("button", { name: "변경사항 저장" }));

    expect(await screen.findByRole("button", { name: "오성 · 본인" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "오성 프로필 관리" }));
    await user.click(screen.getByRole("button", { name: "벽에서 숨기기" }));
    await user.click(screen.getByRole("button", { name: "프로필 숨기기" }));

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "오성 · 본인" })).not.toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: "숨긴 프로필 1명" }));
    await user.click(screen.getByRole("button", { name: "오성 프로필 복원" }));

    expect(await screen.findByRole("button", { name: "오성 · 본인" })).toBeInTheDocument();
  });

  it("프로필을 보관하면 목록에서 빠진다", async () => {
    const user = userEvent.setup();
    renderFamilyHome();
    await addMember(user, "보관대상", "배우자");

    await user.click(screen.getByRole("button", { name: "보관대상 프로필 관리" }));
    await user.click(screen.getByRole("button", { name: "프로필 보관하기" }));
    await user.click(screen.getByRole("button", { name: "보관하기" }));

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "보관대상 · 배우자" })).not.toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "숨긴 프로필 1명" })).toBeInTheDocument();
  });

  it("빈 프로필을 영구 삭제한다", async () => {
    const user = userEvent.setup();
    renderFamilyHome();
    await addMember(user, "테스트구성원", "자녀");

    await user.click(screen.getByRole("button", { name: "테스트구성원 프로필 관리" }));
    await user.click(screen.getByRole("button", { name: "프로필 삭제 요청" }));
    await user.click(screen.getByRole("button", { name: "삭제 요청" }));

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "테스트구성원 · 자녀" })).not.toBeInTheDocument();
    });
  });

  it("레일 선택은 PIN을 요구하고 최초 변경 뒤에 전환한다", async () => {
    const user = userEvent.setup();
    renderFamilyHome();
    const pin = await addMember(user, "김다원", "배우자");

    await user.click(screen.getByRole("button", { name: "김다원 · 배우자" }));
    expect(await screen.findByRole("dialog", { name: "김다원 PIN" })).toBeInTheDocument();
    const pinField = screen.getByLabelText("구성원 PIN");
    await user.click(pinField);
    await user.paste(pin);
    await user.click(screen.getByRole("button", { name: "이 구성원으로" }));

    expect(await screen.findByRole("dialog", { name: "내 PIN 정하기" })).toBeInTheDocument();
    await user.click(screen.getByLabelText("새 PIN"));
    await user.paste("482913");
    await user.click(screen.getByLabelText("새 PIN 확인"));
    await user.paste("482913");
    await user.click(screen.getByRole("button", { name: "PIN 저장" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "내 PIN 정하기" })).not.toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "김다원 · 배우자" })).toHaveAttribute("aria-pressed", "true");
  });

  it("새로고침 뒤에 PIN 세션으로 구성원을 다시 고르지 않는다", async () => {
    const user = userEvent.setup();
    const databaseName = `ieobom-family-home-test-${crypto.randomUUID()}`;
    renderFamilyHome(databaseName);
    const pin = await addMember(user, "김다원", "배우자");
    await user.click(screen.getByRole("button", { name: "김다원 · 배우자" }));
    const pinField = screen.getByLabelText("구성원 PIN");
    await user.click(pinField);
    await user.paste(pin);
    await user.click(screen.getByRole("button", { name: "이 구성원으로" }));
    await user.click(screen.getByLabelText("새 PIN"));
    await user.paste("482913");
    await user.click(screen.getByLabelText("새 PIN 확인"));
    await user.paste("482913");
    await user.click(screen.getByRole("button", { name: "PIN 저장" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "김다원 · 배우자" })).toHaveAttribute("aria-pressed", "true");
    });

    cleanup();
    renderFamilyHome(databaseName);
    const chip = await screen.findByRole("button", { name: "김다원 · 배우자" });
    expect(chip).toHaveAttribute("aria-pressed", "false");
  });

  it("자녀 프로필은 제품 보호자와 법정대리인을 구분한다", async () => {
    const user = userEvent.setup();
    renderFamilyHome();
    await addMember(user, "민준", "자녀");

    await user.click(screen.getByRole("button", { name: "민준 프로필 관리" }));
    expect(screen.getByText(/제품 보호자는 기록·PIN을 도울 수 있습니다/)).toBeInTheDocument();
  });

  it("가족 공유에서 제외하면 목록에서 숨긴다", async () => {
    const user = userEvent.setup();
    renderFamilyHome();
    await addMember(user, "오민재", "자녀");

    await user.click(screen.getByRole("button", { name: "오민재 프로필 관리" }));
    await user.click(screen.getByRole("button", { name: "가족 공유에서 제외" }));
    await user.click(screen.getByRole("button", { name: "공유에서 제외" }));

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "오민재 · 자녀" })).not.toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "숨긴 프로필 1명" })).toBeInTheDocument();
  });
});

function renderFamilyHome(databaseName = `ieobom-family-home-test-${crypto.randomUUID()}`) {
  const auth: AuthContextValue = {
    status: "signed-out",
    signIn: async () => {},
    signOut: async () => {},
    markSignedOut: () => {},
  };
  render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter>
        <LocalDomainProvider databaseName={databaseName}>
          <FamilyHomePage />
        </LocalDomainProvider>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

async function addMember(user: ReturnType<typeof userEvent.setup>, displayName: string, relationship: string) {
  const addButton = await screen.findByRole("button", { name: "구성원 추가" });
  await waitFor(() => {
    expect(addButton).toBeEnabled();
  });
  await user.click(addButton);
  await user.type(screen.getByRole("textbox", { name: "이름 또는 호칭" }), displayName);
  await user.selectOptions(screen.getByRole("combobox", { name: "관계" }), relationship);
  await user.click(screen.getByRole("button", { name: "프로필 저장" }));
  const pin = ((await screen.findByLabelText("임시 PIN")).textContent ?? "").trim();
  await user.click(screen.getByRole("button", { name: "확인했습니다" }));
  await screen.findByRole("button", { name: `${displayName} · ${relationship}` });
  return pin;
}
