import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LocalDomainProvider } from "../../app/LocalDomainProvider";
import { ChallengePage } from "./ChallengePage";
import type { ChallengeCheckResult, ChallengeToday, Garden, HouseholdGarden } from "./contracts";
import { ServerApiError, serverApiClient } from "../../shared/api/serverApiClient";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/**
 * 화면이 지켜야 하는 것 넷. 넷 다 docs/37 §14~§16 에서 팀이 정한 것이고, 문구가 아니라
 * 데이터 흐름으로 지켜져야 하는 것들이다.
 *
 * 1. 물주기는 하루 4종을 **전부** 채웠을 때만 일어난다
 * 2. 화면 어디에도 측정값이 없다 — 서버가 애초에 안 보낸다
 * 3. 순위는 시즌 점수로 매기고, 나무 크기(누적)로 매기지 않는다
 * 4. 가정이 없어도 개인 모드로 성립한다
 */

const GARDEN: Garden = {
  total_points: 166,
  season_points: 132,
  season_index: 8,
  season_start: "2026-08-17",
  season_end: "2026-09-13",
  tree: {
    key: "tree",
    label: "나무",
    index: 4,
    total: 6,
    points_to_next: 214,
    next_label: "열매나무",
  },
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
    { id: "bee", name: "벌", hint: "처음 재본 날", earned: true, earned_on: "2026-08-09" },
    { id: "bird", name: "새", hint: "2주 연속 완주", earned: true, earned_on: "2026-08-16" },
    { id: "squirrel", name: "다람쥐", hint: "4주 연속 완주", earned: false, earned_on: null },
    { id: "cat", name: "고양이", hint: "온 가족이 같은 주에 완주", earned: false, earned_on: null },
    { id: "deer", name: "사슴", hint: "측정 12번 누적", earned: false, earned_on: null },
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

function today(overrides: Partial<ChallengeToday> = {}): ChallengeToday {
  return {
    today: "2026-08-26",
    daily: [
      { id: "walk", title: "걸음 7,000보", detail: "한 정거장 걸어도 채워진다", points: 1, checked: true },
      { id: "exercise", title: "운동 20분", detail: "숨이 조금 찰 정도", points: 1, checked: true },
      { id: "diet", title: "채소 한 접시", detail: "절주한 날도 체크", points: 1, checked: true },
      { id: "sedentary", title: "한 시간에 한 번 일어나기", detail: "끊는 것만으로도", points: 1, checked: false },
    ],
    measures: [
      {
        id: "weight",
        title: "체중 · 허리둘레",
        detail: "일요일 아침",
        points: 5,
        opens: ["obesity", "mets"],
        checked_this_week: false,
      },
      {
        id: "lab",
        title: "검사값 · 검진 결과지",
        detail: "결과지 한 장",
        points: 20,
        opens: ["dm", "dlp", "ckd", "liver"],
        checked_this_week: false,
      },
    ],
    water_requirement: 4,
    checked_count: 3,
    watered_today: false,
    garden: GARDEN,
    ...overrides,
  };
}

const HOUSEHOLD: HouseholdGarden = {
  household_id: "11111111-1111-1111-1111-111111111111",
  season_index: 8,
  season_start: "2026-08-17",
  season_end: "2026-09-13",
  week_start: "2026-08-24",
  members_completed: 2,
  members_total: 3,
  all_completed: false,
  goal: { goal_days: 15, done_days: 7, reached: false },
  items: [
    {
      account_id: "a",
      masked_email: "mom***@example.com",
      local_profile_ref: null,
      is_me: false,
      rank: 1,
      season_points: 210,
      total_points: 480,
      tree_key: "fruiting",
      tree_label: "열매나무",
      animal_count: 5,
      week_completed: true,
    },
    {
      account_id: "b",
      masked_email: "me***@example.com",
      local_profile_ref: null,
      is_me: true,
      rank: 2,
      season_points: 132,
      total_points: 166,
      tree_key: "tree",
      tree_label: "나무",
      animal_count: 3,
      week_completed: false,
    },
    {
      account_id: "c",
      masked_email: "dad***@example.com",
      local_profile_ref: null,
      is_me: false,
      rank: 3,
      season_points: 40,
      total_points: 40,
      tree_key: "sapling",
      tree_label: "묘목",
      animal_count: 2,
      week_completed: true,
    },
  ],
};

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <LocalDomainProvider databaseName={`ieobom-challenge-test-${crypto.randomUUID()}`}>
          <ChallengePage />
        </LocalDomainProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("ChallengePage", () => {
  it("남은 개수를 알려 준다 — 마지막 하나는 문구가 다르다", async () => {
    vi.spyOn(serverApiClient, "getChallengeToday").mockResolvedValue(today());
    vi.spyOn(serverApiClient, "listHouseholds").mockResolvedValue([]);

    renderPage();

    expect(await screen.findByText("하나만 더 하면 오늘 물을 줍니다.")).toBeInTheDocument();
  });

  it("네 종을 전부 채우면 물을 준다 — 부분 달성으로는 안 준다", async () => {
    vi.spyOn(serverApiClient, "getChallengeToday").mockResolvedValue(today());
    vi.spyOn(serverApiClient, "listHouseholds").mockResolvedValue([]);
    const result: ChallengeCheckResult = {
      challenge_id: "sedentary",
      checked_on: "2026-08-26",
      checked: true,
      watered_now: true,
      new_animals: [
        { id: "squirrel", name: "다람쥐", hint: "4주 연속 완주", earned: true, earned_on: "2026-08-26" },
      ],
      garden: { ...GARDEN, watered_today: true },
    };
    const check = vi.spyOn(serverApiClient, "checkChallenge").mockResolvedValue(result);

    renderPage();
    await screen.findByText("하나만 더 하면 오늘 물을 줍니다.");
    await userEvent.click(screen.getByRole("checkbox", { name: /한 시간에 한 번/ }));

    await waitFor(() => expect(check).toHaveBeenCalledWith("sedentary"));
    expect(await screen.findByRole("status")).toHaveTextContent("물을 주었습니다.");
    expect(screen.getByRole("status")).toHaveTextContent("다람쥐가 찾아왔습니다.");
  });

  it("자정을 넘겨 서버가 다른 날로 기록하면 캐시를 버리고 새로 받는다", async () => {
    // 탭을 켜 둔 채 자정을 넘기면 화면은 어제를 보고 있는데 서버는 오늘로 기록한다.
    // 그대로 기우면 어제 목록에 오늘 체크가 얹혀 표시와 기록이 갈린다.
    const fetchToday = vi
      .spyOn(serverApiClient, "getChallengeToday")
      .mockResolvedValue(today());
    vi.spyOn(serverApiClient, "listHouseholds").mockResolvedValue([]);
    vi.spyOn(serverApiClient, "checkChallenge").mockResolvedValue({
      challenge_id: "sedentary",
      checked_on: "2026-08-27", // 화면은 2026-08-26 을 보고 있다
      checked: true,
      watered_now: false,
      new_animals: [],
      garden: GARDEN,
    });

    renderPage();
    await screen.findByText("하나만 더 하면 오늘 물을 줍니다.");
    expect(fetchToday).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole("checkbox", { name: /한 시간에 한 번/ }));

    // 같은 날이면 응답으로 기우고 끝난다. 날짜가 갈렸으므로 다시 받아야 한다.
    await waitFor(() => expect(fetchToday).toHaveBeenCalledTimes(2));
  });

  it("체크가 진행 중이면 다른 항목도 잠근다", async () => {
    // 서로 다른 항목을 연타하면 응답 순서가 뒤집혀 늦게 온 것이 캐시를 덮는다.
    vi.spyOn(serverApiClient, "getChallengeToday").mockResolvedValue(today());
    vi.spyOn(serverApiClient, "listHouseholds").mockResolvedValue([]);
    let release: (value: ChallengeCheckResult) => void = () => {};
    vi.spyOn(serverApiClient, "checkChallenge").mockReturnValue(
      new Promise<ChallengeCheckResult>((resolve) => {
        release = resolve;
      }) as ReturnType<typeof serverApiClient.checkChallenge>,
    );

    renderPage();
    await screen.findByText("하나만 더 하면 오늘 물을 줍니다.");
    await userEvent.click(screen.getByRole("checkbox", { name: /한 시간에 한 번/ }));

    await waitFor(() =>
      expect(screen.getByRole("checkbox", { name: /체중/ })).toBeDisabled(),
    );

    release({
      challenge_id: "sedentary",
      checked_on: "2026-08-26",
      checked: true,
      watered_now: false,
      new_animals: [],
      garden: GARDEN,
    });
    await waitFor(() =>
      expect(screen.getByRole("checkbox", { name: /체중/ })).not.toBeDisabled(),
    );
  });

  it("측정이 주 완주의 관문임을 알려 준다", async () => {
    vi.spyOn(serverApiClient, "getChallengeToday").mockResolvedValue(today());
    vi.spyOn(serverApiClient, "listHouseholds").mockResolvedValue([]);

    renderPage();

    expect(
      await screen.findByText("이번 주에 하나라도 재면 주가 마감되고 흙이 좋아집니다."),
    ).toBeInTheDocument();
  });

  it("여러 칸을 여는 측정은 몇 칸인지 밝힌다", async () => {
    vi.spyOn(serverApiClient, "getChallengeToday").mockResolvedValue(today());
    vi.spyOn(serverApiClient, "listHouseholds").mockResolvedValue([]);

    renderPage();

    expect(await screen.findByText(/판정 4칸이 열립니다/)).toBeInTheDocument();
  });

  it("측정값이 이 기기에만 남는다는 것을 밝힌다", async () => {
    vi.spyOn(serverApiClient, "getChallengeToday").mockResolvedValue(today());
    vi.spyOn(serverApiClient, "listHouseholds").mockResolvedValue([]);

    renderPage();

    expect(
      await screen.findByText("값은 이 기기에만 남습니다. 서버는 쟀다는 사실과 날짜만 압니다."),
    ).toBeInTheDocument();
  });

  it("가정이 없으면 개인 모드로 성립한다 — 빈 가족 카드를 그리지 않는다", async () => {
    vi.spyOn(serverApiClient, "getChallengeToday").mockResolvedValue(today());
    vi.spyOn(serverApiClient, "listHouseholds").mockResolvedValue([]);

    renderPage();
    await screen.findByRole("heading", { name: "내 나무" });

    // 리더보드는 이제 항상 보인다. 다만 남의 줄은 없다.
    expect(screen.queryByText(/명이 완주했습니다/)).not.toBeInTheDocument();
  });

  it("주간 달력이 오늘·못 한 날·아직 오지 않은 날을 갈라 칠한다", async () => {
    // 목요일에 금·토·일이 빨갛게 보이면 아직 하지도 않은 날을 실패로 세는 셈이다.
    vi.spyOn(serverApiClient, "getChallengeToday").mockResolvedValue(today());
    vi.spyOn(serverApiClient, "listHouseholds").mockResolvedValue([]);

    renderPage();
    const calendar = await screen.findByRole("list", { name: "이번 주 달력" });
    const cells = calendar.querySelectorAll("li");

    expect(cells).toHaveLength(7);
    expect(cells[0].className).toContain("is-done");     // 월 — 4/4
    expect(cells[1].className).toContain("is-partial");  // 화 — 2/4
    expect(cells[2].className).toContain("is-cursor");   // 수 — 오늘
    expect(cells[3].className).toContain("is-future");   // 목 — 아직 안 옴
    expect(cells[3].className).not.toContain("is-missed");
  });

  it("달력이 색만으로 뜻을 전달하지 않는다", async () => {
    vi.spyOn(serverApiClient, "getChallengeToday").mockResolvedValue(today());
    vi.spyOn(serverApiClient, "listHouseholds").mockResolvedValue([]);

    renderPage();
    await screen.findByRole("list", { name: "이번 주 달력" });

    expect(screen.getByLabelText(/월요일 24일, 물을 준 날/)).toBeInTheDocument();
    expect(screen.getByLabelText(/수요일 26일, 오늘/)).toBeInTheDocument();
    expect(screen.getByLabelText(/목요일 27일, 아직 오지 않은 날/)).toBeInTheDocument();
  });

  it("세션이 끊기면 맨 위에 다시 로그인하라고 알린다", async () => {
    // 캐시 때문에 화면은 멀쩡해 보이는데 클릭만 조용히 실패하던 자리다.
    vi.spyOn(serverApiClient, "getChallengeToday").mockResolvedValue(today());
    vi.spyOn(serverApiClient, "listHouseholds").mockResolvedValue([]);
    vi.spyOn(serverApiClient, "checkChallenge").mockRejectedValue(
      new ServerApiError(401, "AUTH_REQUIRED", "인증이 필요합니다."),
    );

    renderPage();
    await screen.findByText("하나만 더 하면 오늘 물을 줍니다.");
    await userEvent.click(screen.getByRole("checkbox", { name: /한 시간에 한 번/ }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("로그인이 만료됐습니다.");
    expect(screen.getByRole("link", { name: "로그인하러 가기" })).toHaveAttribute("href", "/account");
  });

  it("혼자여도 리더보드를 보여 주고 초대로 잇는다", async () => {
    // 2명 이상일 때만 그렸더니 혼자 쓰는 사람에게는 기능이 있다는 사실조차 안 보였다.
    vi.spyOn(serverApiClient, "getChallengeToday").mockResolvedValue(today());
    vi.spyOn(serverApiClient, "listHouseholds").mockResolvedValue([]);

    renderPage();

    expect(await screen.findByRole("heading", { name: "우리 집 리더보드" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "가정 만들고 초대하기" })).toBeInTheDocument();
  });

  it("측정 항목에 입력 칸과 제출 버튼이 있다", async () => {
    vi.spyOn(serverApiClient, "getChallengeToday").mockResolvedValue(today());
    vi.spyOn(serverApiClient, "listHouseholds").mockResolvedValue([]);

    renderPage();
    await screen.findByRole("heading", { name: "측정하기" });

    expect(screen.getByLabelText("체중 (kg)")).toBeInTheDocument();
    expect(screen.getByLabelText("허리둘레 (cm)")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "측정값 제출" }).length).toBeGreaterThan(0);
  });

  it("범위를 벗어난 값은 제출을 막는다", async () => {
    vi.spyOn(serverApiClient, "getChallengeToday").mockResolvedValue(today());
    vi.spyOn(serverApiClient, "listHouseholds").mockResolvedValue([]);

    renderPage();
    await screen.findByRole("heading", { name: "측정하기" });

    await userEvent.type(screen.getByLabelText("체중 (kg)"), "999");
    expect(screen.getAllByRole("button", { name: "측정값 제출" })[0]).toBeDisabled();
  });

  it("측정값을 제출하면 그 항목이 자동으로 체크된다", async () => {
    // 값은 로컬로, 서버에는 "쟀다" 만 간다. 제출이 곧 체크다.
    vi.spyOn(serverApiClient, "getChallengeToday").mockResolvedValue(today());
    vi.spyOn(serverApiClient, "listHouseholds").mockResolvedValue([]);
    const check = vi.spyOn(serverApiClient, "checkChallenge").mockResolvedValue({
      challenge_id: "weight",
      checked_on: "2026-08-26",
      checked: true,
      watered_now: false,
      new_animals: [],
      garden: GARDEN,
    });

    renderPage();
    await screen.findByRole("heading", { name: "측정하기" });

    await userEvent.type(screen.getByLabelText("체중 (kg)"), "76.2");
    await userEvent.click(screen.getAllByRole("button", { name: "측정값 제출" })[0]);

    await waitFor(() => expect(check).toHaveBeenCalledWith("weight"));
  });

  it("측정값이 서버 요청에 실리지 않는다", async () => {
    // 이 검사가 존재하는 이유는 회귀 방지가 아니라 설계 선언이다 — 서버는 값을 모른다.
    vi.spyOn(serverApiClient, "getChallengeToday").mockResolvedValue(today());
    vi.spyOn(serverApiClient, "listHouseholds").mockResolvedValue([]);
    const check = vi.spyOn(serverApiClient, "checkChallenge").mockResolvedValue({
      challenge_id: "weight",
      checked_on: "2026-08-26",
      checked: true,
      watered_now: false,
      new_animals: [],
      garden: GARDEN,
    });

    renderPage();
    await screen.findByRole("heading", { name: "측정하기" });
    await userEvent.type(screen.getByLabelText("체중 (kg)"), "76.2");
    await userEvent.click(screen.getAllByRole("button", { name: "측정값 제출" })[0]);

    await waitFor(() => expect(check).toHaveBeenCalled());
    // 인자가 챌린지 id 하나뿐이라 값이 실릴 자리가 없다.
    expect(check.mock.calls[0]).toEqual(["weight"]);
  });

  it("집 공동 목표를 보여 준다", async () => {
    vi.spyOn(serverApiClient, "getChallengeToday").mockResolvedValue(today());
    vi.spyOn(serverApiClient, "listHouseholds").mockResolvedValue([
      { id: HOUSEHOLD.household_id, status: "active", created_at: "2026-08-01T00:00:00Z", row_version: 1 },
    ]);
    vi.spyOn(serverApiClient, "getHouseholdGarden").mockResolvedValue(HOUSEHOLD);

    renderPage();

    expect(await screen.findByText("우리 집 이번 주 물주기 7 / 15일")).toBeInTheDocument();
  });

  it("가족 순위는 시즌 점수 순이고 누적 나무 크기로 매기지 않는다", async () => {
    vi.spyOn(serverApiClient, "getChallengeToday").mockResolvedValue(today());
    vi.spyOn(serverApiClient, "listHouseholds").mockResolvedValue([
      { id: HOUSEHOLD.household_id, status: "active", created_at: "2026-08-01T00:00:00Z", row_version: 1 },
    ]);
    vi.spyOn(serverApiClient, "getHouseholdGarden").mockResolvedValue(HOUSEHOLD);

    renderPage();

    expect(await screen.findByText("이번 주 3명 중 2명이 완주했습니다.")).toBeInTheDocument();
    expect(
      screen.getByText("순위는 이번 시즌 점수로 매깁니다. 나무 크기는 누적이라 줄어들지 않습니다."),
    ).toBeInTheDocument();

    const entries = screen.getAllByText(/^\d\. /);
    expect(entries.map((node) => node.textContent)).toEqual([
      "1. mom***@example.com",
      "2. 나",
      "3. dad***@example.com",
    ]);
  });

  it("정원과 리더보드에는 측정값이 없다", async () => {
    vi.spyOn(serverApiClient, "getChallengeToday").mockResolvedValue(today());
    vi.spyOn(serverApiClient, "listHouseholds").mockResolvedValue([
      { id: HOUSEHOLD.household_id, status: "active", created_at: "2026-08-01T00:00:00Z", row_version: 1 },
    ]);
    vi.spyOn(serverApiClient, "getHouseholdGarden").mockResolvedValue(HOUSEHOLD);

    renderPage();
    await screen.findByRole("heading", { name: "우리 집 리더보드" });

    // 단위는 입력 폼에만 있어야 한다 — 그건 사용자가 채우는 칸이지 서버가 보낸 값이
    // 아니다. 정원이나 리더보드에 단위가 보이면 서버가 수치를 실어 보내고 있다는 뜻이다.
    const garden = screen.getByRole("heading", { name: "내 나무" }).closest("section");
    const family = screen.getByRole("heading", { name: "우리 집 리더보드" }).closest("section");
    for (const section of [garden, family]) {
      expect(section?.textContent ?? "").not.toMatch(/mmHg|mg\/dL|%p/);
    }
  });

  it("로그인 전에는 로그인 안내를 낸다", async () => {
    vi.spyOn(serverApiClient, "getChallengeToday").mockRejectedValue(
      Object.assign(new Error("unauthorized"), { name: "ServerApiError", status: 401 }),
    );
    vi.spyOn(serverApiClient, "listHouseholds").mockResolvedValue([]);

    renderPage();

    expect(await screen.findByText("챌린지를 불러오지 못했습니다.")).toBeInTheDocument();
  });
});
