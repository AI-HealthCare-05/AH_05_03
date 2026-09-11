import { expect, test } from "@playwright/test";
import { setupE2eServerMocks } from "./mockServerApis";

/**
 * 서버 도메인(PostgreSQL) 정본화 E2E 테스트 (ADR-011).
 *
 * **무엇을 지키는 테스트인가.**
 * 프로필과 건강기록은 인증된 서버 REST API(`/api/v1/profiles`, `/api/v1/health-records`)를
 * 통해 PostgreSQL 서버 정본으로 저장 및 조회되며, 페이지를 새로고침해도 서버로부터
 * 상태를 온전히 복원한다.
 */
test("프로필과 건강기록은 서버 API(PostgreSQL)를 통해 등록·조회되고 새로고침 후에도 복원된다", async ({ page }) => {
  const apiRequests: string[] = [];

  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/")) {
      apiRequests.push(`${request.method()} ${url.pathname}`);
    }
  });

  const state = await setupE2eServerMocks(page);

  await page.goto("/");
  // 첫 실행 화면은 폼을 바로 편다. 예전에는 "첫 구성원 등록" 버튼이 모달을 띄웠다.
  await expect(page.getByRole("heading", { name: "첫 구성원 만들기" })).toBeVisible();
  await page.getByRole("textbox", { name: "이름 또는 호칭" }).fill("테스트 가족");
  await page.getByRole("combobox", { name: "관계" }).selectOption("본인");
  await page.getByRole("button", { name: "프로필 저장" }).click();

  await expect(page.getByRole("heading", { name: "테스트 가족님의 건강기록" })).toBeVisible();

  // 1. 프로필이 서버 API를 통해 저장되었는지 검증
  expect(state.profiles).toHaveLength(1);
  expect(state.profiles[0].display_name).toBe("테스트 가족");
  expect(apiRequests.some((req) => req.startsWith("POST /api/v1/profiles"))).toBe(true);

  // 2. 건강기록 작성
  await page.getByRole("button", { name: "첫 기록 작성하기" }).click();
  await page.getByRole("button", { name: /직접 작성/ }).click();
  await page.getByRole("combobox", { name: "기록 종류" }).selectOption("note");
  await page.getByRole("textbox", { name: "기록 내용" }).fill("오늘 컨디션이 좋음");
  await page.getByRole("button", { name: "기록 저장" }).click();

  await expect(page.getByText("오늘 컨디션이 좋음")).toBeVisible();

  // 건강기록이 서버 API를 통해 저장되었는지 검증
  expect(state.healthRecords).toHaveLength(1);
  expect(state.healthRecords[0].payload).toMatchObject({ note: "오늘 컨디션이 좋음" });
  expect(apiRequests.some((req) => req.startsWith("POST /api/v1/health-records"))).toBe(true);

  // 3. 새로고침 후에도 서버 정본으로부터 온전히 복원되는지 검증
  await page.reload();
  await expect(page.getByRole("heading", { name: "테스트 가족님의 건강기록" })).toBeVisible();
  await expect(page.getByText("오늘 컨디션이 좋음")).toBeVisible();
});
