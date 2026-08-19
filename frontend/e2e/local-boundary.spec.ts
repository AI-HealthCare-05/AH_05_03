import { expect, test } from "@playwright/test";

test("프로필과 건강기록은 API 요청 없이 암호화 로컬 저장된다", async ({ page }) => {
  const apiRequests: string[] = [];

  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/")) {
      apiRequests.push(request.url());
    }
  });

  await page.goto("/");
  await page.getByRole("button", { name: "첫 구성원 등록" }).click();
  await page.getByRole("textbox", { name: "이름 또는 호칭" }).fill("테스트 가족");
  await page.getByRole("combobox", { name: "관계" }).selectOption("본인");
  await page.getByRole("button", { name: "프로필 저장" }).click();

  await expect(page.getByRole("heading", { name: "테스트 가족님의 건강기록" })).toBeVisible();
  await page.getByRole("button", { name: "건강기록 작성", exact: true }).first().click();
  await page.getByRole("combobox", { name: "기록 종류" }).selectOption("note");
  await page.getByRole("textbox", { name: "기록 내용" }).fill("오늘 컨디션이 좋음");
  await page.getByRole("button", { name: "기록 저장" }).click();

  await expect(page.getByText("오늘 컨디션이 좋음")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "테스트 가족님의 건강기록" })).toBeVisible();
  await expect(page.getByText("오늘 컨디션이 좋음")).toBeVisible();
  expect(apiRequests).toEqual([]);
});
