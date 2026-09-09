import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";
import { FoodNutritionCard } from "./FoodNutritionCard";
import type { FoodNutritionSearchResult } from "./healthAssistantClient";

describe("FoodNutritionCard", () => {
  afterEach(() => {
    cleanup();
  });

  it("식품 영양성분 정보(열량, 나트륨, 당류, 탄수화물 등)를 정상 렌더링한다", () => {
    const mockResult: FoodNutritionSearchResult = {
      query: "신라면",
      items: [
        {
          food_name: "신라면",
          serving_size: "1봉지(120g)",
          calories_kcal: 500,
          carbohydrate_g: 82,
          protein_g: 10,
          fat_g: 15,
          sugar_g: 4,
          sodium_mg: 1790,
          maker_name: "농심",
        },
      ],
      message: "신라면 영양성분 요약",
      errors: [],
    };

    render(<FoodNutritionCard searchResult={mockResult} />);

    expect(screen.getByRole("region", { name: "식품영양성분 정보" })).toBeInTheDocument();
    expect(screen.getByText("신라면")).toBeInTheDocument();
    expect(screen.getByText("(농심)")).toBeInTheDocument();
    expect(screen.getByText("제공량: 1봉지(120g)")).toBeInTheDocument();
    expect(screen.getByText("500 kcal")).toBeInTheDocument();
    expect(screen.getByText("1,790 mg")).toBeInTheDocument();
    expect(screen.getByText("4 g")).toBeInTheDocument();
    expect(screen.getByText("82 g")).toBeInTheDocument();
    expect(screen.getByText("10 g")).toBeInTheDocument();
    expect(screen.getByText("15 g")).toBeInTheDocument();

    // 나트륨 1,000mg 이상 시 주의 표시 및 안내 문구 노출 확인
    expect(screen.getByText("주의")).toBeInTheDocument();
    expect(screen.getByText(/나트륨 함량이 1일 권장량/)).toBeInTheDocument();
  });

  it("복수 식품 결과가 반환된 경우 탭 전환이 동작한다", () => {
    const mockMultiResult: FoodNutritionSearchResult = {
      query: "라면",
      items: [
        {
          food_name: "신라면",
          serving_size: "120g",
          calories_kcal: 510,
          sodium_mg: 1790,
        },
        {
          food_name: "진라면",
          serving_size: "120g",
          calories_kcal: 480,
          sodium_mg: 1600,
        },
      ],
      message: "라면 검색 결과",
      errors: [],
    };

    render(<FoodNutritionCard searchResult={mockMultiResult} />);

    expect(screen.getByText("510 kcal")).toBeInTheDocument();

    // 진라면 탭 클릭
    const jinTab = screen.getByRole("tab", { name: "진라면" });
    fireEvent.click(jinTab);

    expect(screen.getByText("480 kcal")).toBeInTheDocument();
  });

  it("결과 아이템이 없으면 아무것도 렌더링하지 않는다", () => {
    const emptyResult: FoodNutritionSearchResult = {
      query: "알수없는음식",
      items: [],
      message: "검색 결과 없음",
      errors: [],
    };

    const { container } = render(<FoodNutritionCard searchResult={emptyResult} />);
    expect(container.firstChild).toBeNull();
  });
});
