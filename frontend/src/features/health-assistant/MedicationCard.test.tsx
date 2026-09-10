import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { describe, expect, it, afterEach } from "vitest";
import { MedicationCard } from "./MedicationCard";
import type { MedicationSearchResult } from "./healthAssistantClient";

describe("MedicationCard", () => {
  afterEach(() => {
    cleanup();
  });

  it("병용금기 위험 항목이 있으면 경고 배지와 금기 사유를 렌더링한다", () => {
    const mockResult: MedicationSearchResult = {
      query: "타이레놀, 아스피린",
      items: [
        {
          item_name: "타이레놀정500밀리그람",
          entp_name: "한국얀센",
          efcy_qesitm: "두통, 치통에 효과적입니다.",
        },
        {
          item_name: "아스피린장용정100밀리그람",
          entp_name: "바이엘코리아",
          efcy_qesitm: "혈전 색전 형성 억제",
        },
      ],
      interaction_items: [
        {
          drug_a: "타이레놀정500밀리그람",
          drug_b: "아스피린장용정100밀리그람",
          ingredient_a: "아세트아미노펜",
          ingredient_b: "아세틸살리실산",
          prohibition_content: "심각한 위장관계 출혈 위험 증가",
          type_name: "병용금기",
        },
      ],
      has_interaction_danger: true,
      target_drug_name: "아스피린",
      message: "DUR 병용금기 주의 메시지",
      errors: [],
    };

    render(<MedicationCard searchResult={mockResult} />);

    expect(screen.getByText(/식약처 DUR 병용금기 주의/i)).toBeInTheDocument();
    expect(screen.getByText("타이레놀정500밀리그람")).toBeInTheDocument();
    expect(screen.getByText("아스피린장용정100밀리그람")).toBeInTheDocument();
    expect(screen.getByText(/심각한 위장관계 출혈 위험 증가/i)).toBeInTheDocument();
    expect(screen.getByText(/기준 성분: 아세트아미노펜/i)).toBeInTheDocument();
    expect(screen.getByText(/상대 성분: 아세틸살리실산/i)).toBeInTheDocument();

    // 초기에는 상세 정보가 접혀있고 토글 버튼이 노출됨
    const toggleBtn = screen.getByRole("button", { name: /각 약품 상세 정보/i });
    expect(toggleBtn).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();

    // 버튼 클릭 시 상세 정보 펼쳐짐
    fireEvent.click(toggleBtn);
    expect(screen.getByRole("tablist")).toBeInTheDocument();
    expect(screen.getByText("두통, 치통에 효과적입니다.")).toBeInTheDocument();
  });

  it("병용금기가 아닌 경우 안전 확인 배지와 안내 문구를 렌더링한다", () => {
    const mockResult: MedicationSearchResult = {
      query: "타이레놀, 소화제",
      items: [
        {
          item_name: "타이레놀정500밀리그람",
          entp_name: "한국얀센",
          efcy_qesitm: "해열 및 진통",
        },
      ],
      interaction_items: [],
      has_interaction_danger: false,
      target_drug_name: "소화제",
      message: "직접적인 병용금기 없음",
      errors: [],
    };

    render(<MedicationCard searchResult={mockResult} />);

    expect(screen.getByText(/식약처 DUR 병용 안전 확인/i)).toBeInTheDocument();
    expect(screen.getByText(/직접적인 병용금기 항목은 확인되지 않았습니다/i)).toBeInTheDocument();
  });

  it("단일 약품 정보인 경우 효능, 용법, 주의사항을 렌더링한다", () => {
    const mockResult: MedicationSearchResult = {
      query: "타이레놀",
      items: [
        {
          item_name: "타이레놀정500밀리그람",
          entp_name: "한국얀센",
          class_name: "해열·진통·소염제",
          efcy_qesitm: "두통, 치통, 발열에 효과",
          use_method_qesitm: "1일 3회 복용",
          atpn_warn_qesitm: "과량 복용 시 간 손상 주의",
          dur_items: [
            {
              prohibition_type: "연령금기",
              ingredient_name: "만 12세 미만",
            },
          ],
        },
      ],
      interaction_items: [],
      has_interaction_danger: false,
      target_drug_name: null,
      message: "타이레놀 요약",
      errors: [],
    };

    render(<MedicationCard searchResult={mockResult} />);

    expect(screen.getByText("타이레놀정500밀리그람")).toBeInTheDocument();
    expect(screen.getByText("한국얀센")).toBeInTheDocument();
    expect(screen.getByText("[해열·진통·소염제]")).toBeInTheDocument();
    expect(screen.getByText("두통, 치통, 발열에 효과")).toBeInTheDocument();
    expect(screen.getByText("1일 3회 복용")).toBeInTheDocument();
    expect(screen.getByText(/과량 복용 시 간 손상 주의/i)).toBeInTheDocument();
    expect(screen.getByText(/\[연령금기\] 만 12세 미만/i)).toBeInTheDocument();
  });

  it("약품 정보와 상호작용 결과가 모두 비어 있으면 null을 반환한다", () => {
    const emptyResult: MedicationSearchResult = {
      query: "없는약",
      items: [],
      interaction_items: [],
      has_interaction_danger: false,
      target_drug_name: null,
      message: "결과 없음",
      errors: [],
    };

    const { container } = render(<MedicationCard searchResult={emptyResult} />);
    expect(container.firstChild).toBeNull();
  });
});

