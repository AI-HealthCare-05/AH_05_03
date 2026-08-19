import { expect, test } from "@playwright/test";

test("합성 로컬 모델 실행은 API 요청을 만들지 않는다", async ({ page }) => {
  const apiRequests: string[] = [];

  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/")) {
      apiRequests.push(request.url());
    }
  });

  await page.goto("/");
  await page.getByRole("button", { name: "합성 데이터로 로컬 실행 확인" }).click();

  await expect(page.getByTestId("local-result")).toContainText("LOCAL_FOUNDATION_READY");
  expect(apiRequests).toEqual([]);
});
