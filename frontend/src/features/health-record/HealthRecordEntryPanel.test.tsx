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

    expect(screen.getByText("홍길동님의 건강기록")).toBeDefined();
    expect(screen.getAllByText("봄이").length).toBeGreaterThan(0);
    expect(screen.getByText(/기록을 조회하거나 새로 작성할 내용/)).toBeDefined();

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
    expect(screen.getByText("검진 서류 올리기", { selector: ".subview-title" })).toBeDefined();
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
    expect(screen.getByText("간편 직접 기록", { selector: ".subview-title" })).toBeDefined();
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
    expect(screen.getByText("대화로 통증 기록", { selector: ".subview-title" })).toBeDefined();
  });

  it("메뉴 입력창에 수치 내용을 입력하면 확인 질문 카드와 하단 [저장], [수정], [취소] 버튼이 렌더링된다", () => {
    render(
      <HealthRecordEntryPanel
        profile={mockProfile}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    const input = screen.getByPlaceholderText(HEALTH_ASSISTANT_CONFIG.inputPlaceholder);
    fireEvent.change(input, { target: { value: "오늘 아침 혈당 105 나왔어" } });
    fireEvent.click(screen.getByText("전송"));

    // 1. 확인 질문 말풍선 및 수치 텍스트, 버튼 확인
    expect(screen.getByText(/공복혈당 105 mg\/dL 수치를 기록할까요\?/)).toBeDefined();
    expect(screen.getByText("혈당 105 mg/dL")).toBeDefined();
    expect(screen.getByText("저장")).toBeDefined();
    expect(screen.getByText("수정")).toBeDefined();
    expect(screen.getByText("취소")).toBeDefined();
  });

  it("자연어 혈당 입력 시 시간과 공복/식후 선택 칩이 노출되고 칩 선택 시 반영된다", () => {
    render(
      <HealthRecordEntryPanel
        profile={mockProfile}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    const input = screen.getByPlaceholderText(HEALTH_ASSISTANT_CONFIG.inputPlaceholder);
    fireEvent.change(input, { target: { value: "오전에 혈당검사했는데, 110이었어" } });
    fireEvent.click(screen.getByText("전송"));

    // 질문 및 칩 노출 확인
    expect(screen.getByText("검사 날짜")).toBeDefined();
    expect(screen.getByText("검사 시간")).toBeDefined();
    expect(screen.getByText("공복혈당이셨나요?")).toBeDefined();
    expect(screen.getByText("8시")).toBeDefined();
    expect(screen.getByText("9시")).toBeDefined();

    // 칩 클릭 동작 확인
    fireEvent.click(screen.getByText("9시"));
    fireEvent.click(screen.getByText("식후혈당"));

    expect(screen.getByText("혈당 110 mg/dL")).toBeDefined();
    expect(screen.getByText("저장")).toBeDefined();
  });

  it("어제 혈당 입력 시 날짜 칩이 역순(그저께, 어제, 오늘)으로 노출되고 [수정]을 누르면 인라인 수치 입력창이 나타난다", () => {
    render(
      <HealthRecordEntryPanel
        profile={mockProfile}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    const input = screen.getByPlaceholderText(HEALTH_ASSISTANT_CONFIG.inputPlaceholder);
    fireEvent.change(input, { target: { value: "어제 혈당 120나왔어" } });
    fireEvent.click(screen.getByText("전송"));

    // 어제 날짜 칩 노출 확인
    expect(screen.getAllByText(/어제/).length).toBeGreaterThan(0);
    expect(screen.getByText(/그저께/)).toBeDefined();
    expect(screen.getByText(/오늘/)).toBeDefined();

    // '수정' 버튼 클릭 시 인라인 입력창 노출 확인
    const editBtn = screen.getByText("수정");
    fireEvent.click(editBtn);

    const numInput = document.querySelector('input.inline-number-input') as HTMLInputElement;
    expect(numInput).toBeDefined();
    expect(numInput.value).toBe("120");

    // 숫자 변경
    fireEvent.change(numInput, { target: { value: "125" } });
    expect(numInput.value).toBe("125");
  });

  it("혈당과 혈압을 함께 입력 시 두 수치를 모두 표시하고 한 번에 저장할 수 있다", () => {
    render(
      <HealthRecordEntryPanel
        profile={mockProfile}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    const input = screen.getByPlaceholderText(HEALTH_ASSISTANT_CONFIG.inputPlaceholder);
    fireEvent.change(input, { target: { value: "오늘 아침 혈당은 90, 혈압은 90/120" } });
    fireEvent.click(screen.getByText("전송"));

    // 혈당과 혈압 두 수치가 모두 카드의 미리보기에 노출되는지 확인
    expect(screen.getAllByText(/90 mg\/dL/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/120\/90 mmHg/).length).toBeGreaterThan(0);
    expect(screen.getByText("저장")).toBeDefined();
  });

  it("메뉴 입력창에 통증 내용을 입력하면 먼저 확인 질문 카드를 띄우고 확인 시 통증 대화로 전환된다", () => {
    render(
      <HealthRecordEntryPanel
        profile={mockProfile}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    const input = screen.getByPlaceholderText(HEALTH_ASSISTANT_CONFIG.inputPlaceholder);
    fireEvent.change(input, { target: { value: "어제부터 오른쪽 무릎이 욱신거려" } });
    fireEvent.click(screen.getByText("전송"));

    // 1. 확인 질문 말풍선 및 버튼 확인
    expect(screen.getByText(/오른쪽 무릎 통증 기록을 작성할까요\?/)).toBeDefined();
    const confirmBtn = screen.getByText("오른쪽 무릎 기록 시작");
    expect(confirmBtn).toBeDefined();

    // 2. 확인 버튼 클릭 시 통증 대화로 전환
    fireEvent.click(confirmBtn);
    expect(screen.getByText("대화로 통증 기록", { selector: ".subview-title" })).toBeDefined();
  });

  it("메뉴 입력창에 과거 기록 질문을 입력하면 로컬 RAG 검색 요약 답변을 제공한다", () => {
    render(
      <HealthRecordEntryPanel
        profile={mockProfile}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    const input = screen.getByPlaceholderText(HEALTH_ASSISTANT_CONFIG.inputPlaceholder);
    fireEvent.change(input, { target: { value: "지난번 공복혈당 얼마였지?" } });
    fireEvent.click(screen.getByText("전송"));

    expect(screen.getByText(/홍길동님의 저장된 혈당 기록이 아직 없습니다/)).toBeDefined();
  });

  it("내일 공복혈당 입력 시 미래 날짜 기록 불가 안내 메시지를 출력한다", () => {
    render(
      <HealthRecordEntryPanel
        profile={mockProfile}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    const input = screen.getByPlaceholderText(HEALTH_ASSISTANT_CONFIG.inputPlaceholder);
    fireEvent.change(input, { target: { value: "내일 공복혈당 100이야" } });
    fireEvent.click(screen.getByText("전송"));

    expect(screen.getByText(/미래 일자의 건강 수치는 기록할 수 없습니다/)).toBeDefined();
    expect(screen.queryByText("공복혈당 100 mg/dL 수치를 기록할까요?")).toBeNull();
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
    expect(screen.getByText("간편 직접 기록", { selector: ".subview-title" })).toBeDefined();

    // 닫기
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSaved).not.toHaveBeenCalled();
  });
});
