import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VanatomeQuickSearch } from "./VanatomeQuickSearch";

describe("VanatomeQuickSearch", () => {
  afterEach(() => {
    cleanup();
  });

  it("기본 렌더링 시 상단 검색창 인풋이 표시된다", () => {
    render(<VanatomeQuickSearch onSelectAnatomy={() => {}} />);
    const input = screen.getByPlaceholderText(/부위·신경·장기 검색/);
    expect(input).toBeInTheDocument();
  });

  it("검색어 입력 시 실시간 드롭다운 결과가 표시되고 선택 시 onSelectAnatomy를 호출한다", () => {
    const handleSelectAnatomy = vi.fn();
    render(<VanatomeQuickSearch onSelectAnatomy={handleSelectAnatomy} />);

    const input = screen.getByPlaceholderText(/부위·신경·장기 검색/);
    fireEvent.change(input, { target: { value: "승모근" } });

    const resultItem = screen.getByRole("option", { name: /승모근/ });
    expect(resultItem).toBeInTheDocument();

    fireEvent.click(resultItem);
    expect(handleSelectAnatomy).toHaveBeenCalled();
  });

  it("척골신경 검색 시 ulnar nerve 관련 신경 결과가 나타난다", () => {
    const handleSelectAnatomy = vi.fn();
    render(<VanatomeQuickSearch onSelectAnatomy={handleSelectAnatomy} />);

    const input = screen.getByPlaceholderText(/부위·신경·장기 검색/);
    fireEvent.change(input, { target: { value: "척골신경" } });

    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("치아 검색 시 onSelectTooth 콜백이 호출된다", () => {
    const handleSelectTooth = vi.fn();
    render(
      <VanatomeQuickSearch
        onSelectAnatomy={() => {}}
        onSelectTooth={handleSelectTooth}
      />,
    );

    const input = screen.getByPlaceholderText(/부위·신경·장기 검색/);
    fireEvent.change(input, { target: { value: "#16" } });

    const toothOption = screen.getByRole("option", { name: /제1대구치/ });
    expect(toothOption).toBeInTheDocument();

    fireEvent.click(toothOption);
    expect(handleSelectTooth).toHaveBeenCalledWith(16, expect.stringContaining("제1대구치"));
  });

  it("키보드 Escape 키 입력 시 드롭다운이 닫힌다", () => {
    render(<VanatomeQuickSearch onSelectAnatomy={() => {}} />);

    const input = screen.getByPlaceholderText(/부위·신경·장기 검색/);
    fireEvent.change(input, { target: { value: "승모근" } });
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});
