import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, expect, it, vi, afterEach } from "vitest";
import { AnatomySearchDrawer } from "./AnatomySearchDrawer";

describe("AnatomySearchDrawer", () => {
  afterEach(() => {
    cleanup();
  });
  it("isOpen이 false이면 렌더링되지 않는다", () => {
    const { container } = render(
      <AnatomySearchDrawer isOpen={false} onClose={() => {}} onSelectResult={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("검색어 입력 시 일치하는 해부학 및 치아 결과를 렌더링하고 클릭 시 콜백을 호출한다", () => {
    const handleSelect = vi.fn();
    const handleClose = vi.fn();

    render(
      <AnatomySearchDrawer
        isOpen={true}
        onClose={handleClose}
        onSelectResult={handleSelect}
      />,
    );

    const input = screen.getByPlaceholderText(/부위명 검색/);
    fireEvent.change(input, { target: { value: "승모근" } });

    // 검색 결과 항목 확인
    const resultItem = screen.getByRole("button", { name: /승모근/ });
    expect(resultItem).toBeInTheDocument();

    fireEvent.click(resultItem);
    expect(handleSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        koreanName: "승모근",
        system: "muscular",
      }),
    );
    expect(handleClose).toHaveBeenCalled();
  });

  it("치아 번호 검색 시 치아 결과를 정확히 표시한다", () => {
    const handleSelect = vi.fn();

    render(
      <AnatomySearchDrawer
        isOpen={true}
        onClose={() => {}}
        onSelectResult={handleSelect}
      />,
    );

    const input = screen.getByPlaceholderText(/부위명 검색/);
    fireEvent.change(input, { target: { value: "#16" } });

    const toothItem = screen.getByRole("button", { name: /제1대구치/ });
    expect(toothItem).toBeInTheDocument();
  });

  it("'어깨 회전근개' 다중 토큰 검색 시 극상근, 극하근 등 회전근개 구성 근육을 정상 검색한다", () => {
    render(
      <AnatomySearchDrawer
        isOpen={true}
        onClose={() => {}}
        onSelectResult={() => {}}
      />,
    );

    const input = screen.getByPlaceholderText(/부위명 검색/);
    fireEvent.change(input, { target: { value: "어깨 회전근개" } });

    expect(screen.getByRole("button", { name: /극상근/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /극하근/ })).toBeInTheDocument();
  });

  it("띄어쓰기가 들어간 '회전 근개'도 공백 정규화로 매칭된다", () => {
    render(
      <AnatomySearchDrawer
        isOpen={true}
        onClose={() => {}}
        onSelectResult={() => {}}
      />,
    );

    const input = screen.getByPlaceholderText(/부위명 검색/);
    fireEvent.change(input, { target: { value: "회전 근개" } });

    expect(screen.getByRole("button", { name: /극상근/ })).toBeInTheDocument();
  });
});
