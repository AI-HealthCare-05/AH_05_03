import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DentalPickerModal } from "./DentalPickerModal";

describe("DentalPickerModal", () => {
  afterEach(() => {
    cleanup();
  });
  it("isOpen이 false이면 렌더링되지 않는다", () => {
    const { container } = render(
      <DentalPickerModal isOpen={false} onClose={() => {}} onSelectTooth={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("치열도에서 치아를 클릭하면 확정 버튼 없이 즉시 onSelectTooth 콜백이 호출된다", () => {
    const handleSelect = vi.fn();
    const handleClose = vi.fn();

    render(
      <DentalPickerModal
        isOpen={true}
        onClose={handleClose}
        onSelectTooth={handleSelect}
      />,
    );

    expect(screen.getByText(/치아 전용 선택기/)).toBeInTheDocument();

    // 치아 버튼 #16 클릭 (상악 우측 제1대구치)
    const tooth16Btn = screen.getByTitle(/#16 - 상악 우측 제1대구치/);
    fireEvent.pointerDown(tooth16Btn, { pointerId: 1, buttons: 1 });

    // 상세 정보에 표시되는지 확인
    expect(screen.getByText("오른쪽 위 첫째 큰어금니")).toBeInTheDocument();

    // 확정 버튼은 없어야 함
    expect(screen.queryByRole("button", { name: /선택 확정/ })).toBeNull();

    // 즉시 onSelectTooth가 true(선택)로 호출되었는지 검증
    expect(handleSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        fdiNumber: 16,
        shortCode: "#16",
      }),
      true,
    );
  });

  it("드래그(pointerEnter)로 지나가는 치아들이 연속으로 선택된다", () => {
    const handleSelect = vi.fn();
    render(
      <DentalPickerModal
        isOpen={true}
        onClose={() => {}}
        onSelectTooth={handleSelect}
      />,
    );

    const tooth16Btn = screen.getByTitle(/#16 - 상악 우측 제1대구치/);
    const tooth15Btn = screen.getByTitle(/#15 - 상악 우측 제2소구치/);

    // 16번에서 드래그 시작
    fireEvent.pointerDown(tooth16Btn, { pointerId: 1, buttons: 1 });
    expect(handleSelect).toHaveBeenCalledWith(
      expect.objectContaining({ fdiNumber: 16 }),
      true,
    );

    // 15번으로 포인터 이동 (드래그 진입)
    fireEvent.pointerEnter(tooth15Btn, { pointerId: 1, buttons: 1 });
    expect(handleSelect).toHaveBeenCalledWith(
      expect.objectContaining({ fdiNumber: 15 }),
      true,
    );
  });

  it("embedded 모드에서는 사이드바 카드 형태로 렌더링되고 최소화/닫기를 지원한다", () => {
    const handleSelect = vi.fn();
    const handleClose = vi.fn();
    const handleMinimize = vi.fn();

    render(
      <DentalPickerModal
        isOpen={true}
        mode="embedded"
        onClose={handleClose}
        onMinimize={handleMinimize}
        onSelectTooth={handleSelect}
      />,
    );

    expect(screen.getByText(/FDI 32개 영구치 치열도/)).toBeInTheDocument();

    const minBtn = screen.getByRole("button", { name: "치아 선택기 최소화" });
    fireEvent.click(minBtn);
    expect(handleMinimize).toHaveBeenCalled();

    const closeBtn = screen.getByRole("button", { name: "치아 선택기 닫기" });
    fireEvent.click(closeBtn);
    expect(handleClose).toHaveBeenCalled();
  });
});
