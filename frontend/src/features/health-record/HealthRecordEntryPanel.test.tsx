import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { HealthRecordEntryPanel } from "./HealthRecordEntryPanel";
import { HEALTH_ASSISTANT_CONFIG } from "./healthRecordEntryConfig";
import type { FamilyProfile } from "../../shared/local/domainContracts";

afterEach(() => {
  cleanup();
});

const mockProfile: FamilyProfile = {
  id: "prof-1",
  householdId: "house-1",
  displayName: "홍길동",
  relationship: "본인",
  birthDate: "1980-01-01",
  opaqueServerRef: null,
  serverRefState: "none",
  status: "active",
  mergedIntoProfileId: null,
  version: 1,
  createdAt: "2026-08-20T00:00:00Z",
  updatedAt: "2026-08-20T00:00:00Z",
};

describe("HealthRecordEntryPanel", () => {
  it("챗봇 봄이의 인사말과 3가지 빠른 선택지(OCR, 간편기록, 통증기록)를 렌더링한다", () => {
    render(
      <HealthRecordEntryPanel
        profile={mockProfile}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    expect(screen.getByText("홍길동님의 건강기록 추가")).toBeDefined();
    expect(screen.getByText(HEALTH_ASSISTANT_CONFIG.name)).toBeDefined();
    expect(screen.getByText(/무엇을 도와드릴까요/)).toBeDefined();

    expect(screen.getByText("검진 서류 올리기")).toBeDefined();
    expect(screen.getByText("간편 기록")).toBeDefined();
    expect(screen.getByText("통증 기록")).toBeDefined();
  });

  it("닫기(×) 버튼을 누르면 onClose 콜백이 호출된다", () => {
    const onClose = vi.fn();
    render(
      <HealthRecordEntryPanel
        profile={mockProfile}
        onClose={onClose}
        onSaved={vi.fn()}
      />,
    );

    const closeBtn = screen.getByLabelText("패널 닫기 (ESC)");
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Escape 키를 누르면 onClose 콜백이 호출된다", () => {
    const onClose = vi.fn();
    render(
      <HealthRecordEntryPanel
        profile={mockProfile}
        onClose={onClose}
        onSaved={vi.fn()}
      />,
    );

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("검진 서류 올리기 카드를 누르면 OCR 서브뷰로 전환된다", () => {
    render(
      <HealthRecordEntryPanel
        profile={mockProfile}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText("검진 서류 올리기"));
    expect(screen.getByText("📄 검진 서류 올리기")).toBeDefined();
    expect(screen.getByText("← 다른 기록 방식 선택")).toBeDefined();
  });

  it("간편 기록 카드를 누르면 수치/수기 서브뷰로 전환된다", () => {
    render(
      <HealthRecordEntryPanel
        profile={mockProfile}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText("간편 기록"));
    expect(screen.getByText("✍️ 간편 직접 기록")).toBeDefined();
    expect(screen.getByText("수치 (혈압·혈당·체중)")).toBeDefined();
  });

  it("통증 기록 카드를 누르면 통증 대화 서브뷰로 전환된다", () => {
    render(
      <HealthRecordEntryPanel
        profile={mockProfile}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText("통증 기록"));
    expect(screen.getByText("🩺 대화로 통증 기록")).toBeDefined();
  });

  it("메뉴 입력창에 통증 내용을 입력하고 전송하면 통증 대화 서브뷰로 전환된다", () => {
    render(
      <HealthRecordEntryPanel
        profile={mockProfile}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    const input = screen.getByPlaceholderText(HEALTH_ASSISTANT_CONFIG.inputPlaceholder);
    fireEvent.change(input, { target: { value: "어제부터 허리가 뻐근해요" } });
    fireEvent.click(screen.getByText("작성"));

    expect(screen.getByText("🩺 대화로 통증 기록")).toBeDefined();
  });

  it("패널을 닫아도 확인되지 않은 기록이 자동 저장되지 않는다", () => {
    const onSaved = vi.fn();
    const onClose = vi.fn();
    render(
      <HealthRecordEntryPanel
        profile={mockProfile}
        onClose={onClose}
        onSaved={onSaved}
      />,
    );

    // 간편 기록으로 진입
    fireEvent.click(screen.getByText("간편 기록"));
    expect(screen.getByText("✍️ 간편 직접 기록")).toBeDefined();

    // 닫기
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSaved).not.toHaveBeenCalled();
  });
});
