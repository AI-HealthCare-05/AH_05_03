/**
 * 서류를 올려 기록하면 **그 대화도 남는다** — `handleConfirmOcrModalSave`.
 *
 * **왜 이 파일이 생겼나.** 문서 확정 저장 경로가 주고받은 두 줄을 `setMessages` 로
 * 화면에만 넣고 끝냈다. 봄이와 말로 하는 대화는 서버가 알아서 기록하지만 이 경로는
 * LLM 을 거치지 않아서, 세션도 안 생기고 메시지도 안 남았다.
 *
 * 증상은 두 겹이었다. 새로고침하면 그 대화가 사라지고, 세션이 없으니 **대화 목록에
 * 아예 뜨지 않는다** — 기록은 저장됐는데 그 기록을 만든 대화만 없다.
 *
 * `vi.mock` 이 파일 전체에 걸리므로 기존 드로어 스위트와 갈라 둔다.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { HealthAssistantDrawer } from "./HealthAssistantDrawer";
import * as clientModule from "./healthAssistantClient";
import type { FamilyProfile } from "../../shared/local/domainContracts";
import type { LocalDomainRuntime } from "../../shared/local/localDomainRuntime";

// 서류 인식은 서버 작업이다. 여기서 보려는 것은 인식 결과가 아니라 그 뒤에 남는 대화다.
vi.mock("../../shared/api/geminiOcrAdapter", () => ({
  GeminiOcrAdapter: class {
    async recognize() {
      return {
        text: "2026년 8월 28일 종합건강검진표\n공복혈당 104 mg/dL\n총콜레스테롤 210 mg/dL",
        tables: [],
      };
    }
  },
}));

if (!globalThis.URL.createObjectURL) globalThis.URL.createObjectURL = vi.fn(() => "blob:fake-url");
if (!globalThis.URL.revokeObjectURL) globalThis.URL.revokeObjectURL = vi.fn();

const profile: FamilyProfile = {
  id: "profile-1",
  householdId: "household-1",
  displayName: "홍길동",
  relationship: "본인",
  birthDate: "1990-01-01",
  gender: "male",
  opaqueServerRef: null,
  serverRefState: "none",
  status: "active",
  mergedIntoProfileId: null,
  createdAt: "2026-08-31T00:00:00Z",
  updatedAt: "2026-08-31T00:00:00Z",
  version: 1,
};

const runtime = {
  healthRecords: {
    create: vi.fn().mockResolvedValue({ ok: true, value: { id: "record-123" } }),
    query: vi.fn().mockResolvedValue({ ok: true, value: [] }),
  },
  documents: {
    save: vi.fn().mockResolvedValue({ ok: true, value: { id: "doc-1", fileName: "검진표.png" } }),
    // `null` 을 주면 원본 미리보기가 `.file` 을 읽다 터진다 — 이 테스트와 무관한
    // 잡음이므로 실제와 같은 모양을 준다.
    readById: vi.fn().mockResolvedValue({
      ok: true,
      value: { id: "doc-1", fileName: "검진표.png", file: new Blob(["x"], { type: "image/png" }) },
    }),
  },
} as unknown as LocalDomainRuntime;

describe("서류 확정 저장과 대화 기록", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
  });

  it("서류로 기록하면 세션을 만들고 주고받은 두 줄을 서버에 남긴다", async () => {
    const createSession = vi
      .spyOn(clientModule, "createChatSession")
      .mockResolvedValue({ id: "session-1", title: null } as never);
    const createMessage = vi
      .spyOn(clientModule, "createChatMessage")
      .mockResolvedValue({ id: "msg-1" } as never);
    vi.spyOn(clientModule, "listChatSessions").mockResolvedValue([]);

    render(
      <HealthAssistantDrawer
        profile={profile}
        runtime={runtime}
        isOpen={true}
        onClose={vi.fn()}
        onRecordSaved={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File(["x"], "검진표.png", { type: "image/png" })] },
    });

    const confirm = await screen.findByRole(
      "button",
      { name: "수정 내용 확정 · 건강기록 저장" },
      { timeout: 5000 },
    );
    await waitFor(() => expect(confirm).not.toBeDisabled(), { timeout: 5000 });
    fireEvent.click(confirm);

    // 기록은 저장된다 — 원래도 이건 됐다.
    await waitFor(() => expect(runtime.healthRecords.create).toHaveBeenCalled());

    // **이 두 단정이 이 파일의 전부다.** 예전에는 둘 다 0회였다.
    await waitFor(() => expect(createSession).toHaveBeenCalledWith("profile-1"), { timeout: 5000 });
    await waitFor(() => expect(createMessage).toHaveBeenCalledTimes(2), { timeout: 5000 });

    const roles = createMessage.mock.calls.map((call) => call[1]);
    expect(roles).toEqual(["user", "assistant"]);
    // 사용자 줄이 세션 제목이 된다(`chat_session_service.add_message`). 파일명이 보여야
    // 목록에서 어떤 서류로 만든 대화인지 알 수 있다.
    expect(createMessage.mock.calls[0][2]).toContain("검진표.png");
  });
});
