import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChallengeDashboardCard } from "./ChallengeDashboardCard";
import type { ChallengeToday, Garden } from "./contracts";
import { serverApiClient } from "../../shared/api/serverApiClient";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const GARDEN: Garden = {
  total_points: 166,
  season_points: 132,
  season_index: 8,
  season_start: "2026-08-17",
  season_end: "2026-09-13",
  tree: { key: "tree", label: "나무", index: 4, total: 6, points_to_next: 214, next_label: "열매나무" },
  nutrition: {
    level: 4,
    key: "rooted",
    label: "뿌리내림",
    multiplier: 2.5,
    current_streak: 4,
    max_streak: 5,
  },
  animals: [
    { id: "butterfly", name: "나비", hint: "첫 물주기", earned: true, earned_on: "2026-08-03" },
    { id: "owl", name: "부엉이", hint: "8주 연속 완주", earned: false, earned_on: null },
  ],
  week: {
    start: "2026-08-24",
    water_days: 3,
    water_required: 5,
    measure_count: 0,
    measure_required: 1,
    completed: false,
    days_left: 3,
    days: [
      { date: "2026-08-24", weekday: 0, checked_count: 4, total_count: 4, watered: true, measured: false, is_today: false, is_future: false },
      { date: "2026-08-25", weekday: 1, checked_count: 2, total_count: 4, watered: false, measured: true, is_today: false, is_future: false },
      { date: "2026-08-26", weekday: 2, checked_count: 3, total_count: 4, watered: false, measured: false, is_today: true, is_future: false },
      { date: "2026-08-27", weekday: 3, checked_count: 0, total_count: 4, watered: false, measured: false, is_today: false, is_future: true },
      { date: "2026-08-28", weekday: 4, checked_count: 0, total_count: 4, watered: false, measured: false, is_today: false, is_future: true },
      { date: "2026-08-29", weekday: 5, checked_count: 0, total_count: 4, watered: false, measured: false, is_today: false, is_future: true },
      { date: "2026-08-30", weekday: 6, checked_count: 0, total_count: 4, watered: false, measured: false, is_today: false, is_future: true },
    ],
  },
  watered_today: false,
  measure_count: 4,
};

const TODAY: ChallengeToday = {
  today: "2026-08-26",
  daily: [],
  measures: [],
  water_requirement: 4,
  checked_count: 3,
  watered_today: false,
  garden: GARDEN,
};

function renderCard() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ChallengeDashboardCard />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("ChallengeDashboardCard", () => {
  it("오늘 남은 개수와 나무 상태를 요약한다", async () => {
    vi.spyOn(serverApiClient, "getChallengeToday").mockResolvedValue(TODAY);

    renderCard();

    expect(await screen.findByText("하나만 더 하면 오늘 물을 줍니다.")).toBeInTheDocument();
    expect(screen.getByText(/나무 · 166점 · 흙 뿌리내림 · 4주 연속/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "챌린지 열기" })).toHaveAttribute("href", "/challenge");
  });

  it("로그인 전에는 아무것도 그리지 않는다", async () => {
    // 대시보드는 로컬 우선 화면이다. 서버가 없어도 나머지가 그대로 동작해야 하고,
    // 여기서 오류 배너를 띄우면 로그인 안 한 사용자에게 매번 빨간 줄이 뜬다.
    vi.spyOn(serverApiClient, "getChallengeToday").mockRejectedValue(new Error("unauthorized"));

    const { container } = renderCard();

    await waitFor(() => expect(serverApiClient.getChallengeToday).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("측정값을 노출하지 않는다", async () => {
    vi.spyOn(serverApiClient, "getChallengeToday").mockResolvedValue(TODAY);

    const { container } = renderCard();
    await screen.findByText("하나만 더 하면 오늘 물을 줍니다.");

    expect(container.textContent).not.toMatch(/mmHg|kg\b|mg\/dL|%p/);
  });
});
