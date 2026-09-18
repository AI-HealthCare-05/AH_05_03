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

  it("신장 피질·수질은 메쉬가 없어 검색 결과에 올리지 않고, 신장은 복합 장기로 남긴다", () => {
    render(<VanatomeQuickSearch onSelectAnatomy={() => {}} />);

    fireEvent.change(screen.getByPlaceholderText(/부위·신경·장기 검색/), {
      target: { value: "신장 피질" },
    });
    expect(screen.queryByRole("option", { name: /신장 피질/u })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /신장 수질/u })).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/부위·신경·장기 검색/), {
      target: { value: "신장" },
    });
    expect(screen.getByRole("option", { name: /신장 \(콩팥\)/u })).toBeInTheDocument();
  });

  it("부신은 복합 장기 하나와 동의어 사전 중복 없이 나오고, 우측 부신은 오른쪽 메쉬를 고른다", () => {
    const handleSelectAnatomy = vi.fn();
    render(<VanatomeQuickSearch onSelectAnatomy={handleSelectAnatomy} />);
    const input = screen.getByPlaceholderText(/부위·신경·장기 검색/);

    fireEvent.change(input, { target: { value: "부신" } });
    const adrenalRows = screen.getAllByRole("option", { name: /부신/u });
    expect(adrenalRows.filter((row) => /복합 장기/u.test(row.textContent ?? "")).length).toBe(1);
    expect(adrenalRows.filter((row) => !/복합 장기/u.test(row.textContent ?? "")).length).toBe(0);

    fireEvent.change(input, { target: { value: "우측 부신" } });
    expect(screen.getByRole("option", { name: /우측 부신/u })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /좌측 부신/u })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("option", { name: /우측 부신/u }));
    expect(handleSelectAnatomy).toHaveBeenCalledWith(
      "adrenal-glands-suprarenal-gland-right",
      expect.objectContaining({
        canonicalName: "suprarenal gland.r",
        childMeshIds: ["adrenal-glands-suprarenal-gland-right"],
      }),
    );
  });

  it("심장 검색 시 복합 장기 결과를 우선 노출하고 하위 메쉬 정보와 함께 선택한다", () => {
    const handleSelectAnatomy = vi.fn();
    render(<VanatomeQuickSearch onSelectAnatomy={handleSelectAnatomy} />);

    fireEvent.change(screen.getByPlaceholderText(/부위·신경·장기 검색/), {
      target: { value: "심장" },
    });

    const option = screen.getByRole("option", { name: /^심장 \(염통\).*복합 장기.*Heart/u });
    fireEvent.click(option);

    expect(handleSelectAnatomy).toHaveBeenCalledWith(
      "heart",
      expect.objectContaining({
        isCompound: true,
        childMeshIds: expect.arrayContaining([
          "heart-left-atrium",
          "heart-left-ventricle",
          "heart-right-atrium",
          "heart-right-ventricle",
        ]),
      }),
    );
  });

  it("고환 검색은 복합 장기 testes로 선택하고 공식 자식 id는 testis 좌우이다", () => {
    const handleSelectAnatomy = vi.fn();
    render(<VanatomeQuickSearch onSelectAnatomy={handleSelectAnatomy} />);

    fireEvent.change(screen.getByPlaceholderText(/부위·신경·장기 검색/), {
      target: { value: "고환" },
    });

    fireEvent.click(screen.getByRole("option", { name: /고환 \(정소\)/u }));
    expect(handleSelectAnatomy).toHaveBeenCalledWith(
      "testes",
      expect.objectContaining({
        isCompound: true,
        canonicalName: "Testes",
        childMeshIds: ["testes-testis-left", "testes-testis-right"],
      }),
    );
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
