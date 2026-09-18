import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";

import { UiPreviewPage } from "./UiPreviewPage";

afterEach(cleanup);

describe("UiPreviewPage 대시보드", () => {
  it("새로운 컨셉 대시보드의 주요 헤더와 카드 섹션이 정상적으로 렌더링된다", () => {
    render(
      <MemoryRouter>
        <UiPreviewPage />
      </MemoryRouter>,
    );

    // 전역 헤더 & 로고
    expect(screen.getByText("이어봄")).toBeInTheDocument();
    expect(screen.getByText("오늘도, 함께 더 건강하게")).toBeInTheDocument();

    // 메인 타이틀
    expect(screen.getByRole("heading", { name: "오늘 우리 가족 건강은 이래요" })).toBeInTheDocument();

    // 상단 주의 알림 & 가족 상태
    expect(screen.getByText("주의가 필요한 변화 2개")).toBeInTheDocument();
    expect(screen.getByText("우리 가족 건강 상태")).toBeInTheDocument();

    // 중간 지표 및 챌린지
    expect(screen.getByText("주요 건강지표 변화")).toBeInTheDocument();
    expect(screen.getByText("만성질환 위험도")).toBeInTheDocument();
    expect(screen.getByText("오늘의 챌린지 >")).toBeInTheDocument();

    // 하단 섹션
    expect(screen.getByText("통증 기록 >")).toBeInTheDocument();
    expect(screen.getByText("운동")).toBeInTheDocument();
    expect(screen.getByText("최근 건강기록 >")).toBeInTheDocument();
    expect(screen.getByText("봄이에게 물어보기")).toBeInTheDocument();
  });

  it("지표 탭 전환 시 수치 레이블이 변경된다", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <UiPreviewPage />
      </MemoryRouter>,
    );

    // 기본 혈압
    expect(screen.getByText("최근 혈압")).toBeInTheDocument();
    expect(screen.getByText("128/84")).toBeInTheDocument();

    // 혈당 탭 클릭
    const bloodSugarTab = screen.getByRole("tab", { name: "혈당" });
    await user.click(bloodSugarTab);

    expect(screen.getByText("공복 혈당")).toBeInTheDocument();
    expect(screen.getByText("112")).toBeInTheDocument();

    // 체중 탭 클릭
    const weightTab = screen.getByRole("tab", { name: "체중" });
    await user.click(weightTab);

    expect(screen.getByText("현재 체중")).toBeInTheDocument();
    expect(screen.getByText("68.4")).toBeInTheDocument();
  });

  it("오늘의 챌린지 항목 토글 시 달성 수가 반응형으로 갱신된다", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <UiPreviewPage />
      </MemoryRouter>,
    );

    // 초기: 2/3 달성
    expect(screen.getByText("2/3 달성")).toBeInTheDocument();

    // 세 번째 미완료 항목(복약 확인) 클릭
    const medCheckbox = screen.getByRole("checkbox", { name: /복약 확인/i });
    await user.click(medCheckbox);

    // 3/3 달성으로 갱신
    expect(screen.getByText("3/3 달성")).toBeInTheDocument();
  });
});
