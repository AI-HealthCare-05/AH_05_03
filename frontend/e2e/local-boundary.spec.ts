import { expect, test } from "@playwright/test";

/**
 * 로컬 우선 경계 테스트.
 *
 * **무엇을 지키는 테스트인가.** 프로필과 건강기록은 브라우저 안에서 암호화돼
 * IndexedDB 에 저장되고 서버로 나가지 않는다. 그 계약이 깨지면 여기서 걸린다.
 *
 * **왜 로그인을 가로채는가.** `RootLayout` 이 미인증이면 `SignInPage` 를 돌려주므로
 * (`app/RootLayout.tsx`), 로그인 없이는 건강기록 화면에 닿을 수 없다. 그런데 로그인은
 * 그 자체가 `/api/` 왕복이라 "API 호출 0건"과 구조적으로 충돌한다.
 *
 * 그래서 **관문 두 호출만 가로채고 나머지 `/api/` 는 전부 실패로 센다.** 로그인·계정
 * 조회는 서비스 계정 경로이고 건강정보를 싣지 않는다 — 이 테스트가 감시하는 것은
 * 건강기록이 나가는지이지 계정 API 가 있는지가 아니다. 백엔드 없이 돌아야 프런트
 * CI 잡이 자기 완결로 남는다는 점도 같다.
 */

/**
 * 서버로 나가도 되는 경로. **건강기록이 아닌 서비스 메타데이터만** 여기 들어간다.
 *
 * 원래 이 테스트는 "`/api/` 호출 0건"을 단언했다. 그때는 화면에 서비스 기능이
 * 없어서 그 단순한 규칙이 곧 "건강정보가 안 나간다"와 같았다. 지금은 로그인 관문
 * (`RootLayout`)과 챌린지 카드(`ChallengeDashboardCard`)가 홈에 있어서 그 등식이
 * 깨졌다 — 규칙을 뜻에 맞게 다시 적는다.
 *
 * **`challenges/today` 는 판단이 필요한 자리다.** 요청에 건강정보를 싣지 않고
 * 응답도 오늘의 챌린지 목록이지만, 체크 상태(`challenges/checks`)는 생활습관
 * 기록이라 서버에 남는다. 가구 정원을 공유하려면 서버여야 한다는 설계라
 * 여기서는 통과시키되, 경계 정책을 다시 볼 때 함께 봐야 한다.
 */
const SERVICE_METADATA = [
  "/api/v1/auth/refresh",
  "/api/v1/account",
  "/api/v1/challenges/today",
];

test("프로필과 건강기록은 API 요청 없이 암호화 로컬 저장된다", async ({ page }) => {
  await page.route("**/api/v1/auth/refresh", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: { access_token: "e2e-token", token_type: "bearer", expires_in: 900 },
      }),
    }),
  );

  await page.route("**/api/v1/account", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          account: {
            id: "e2e-account",
            email: "e2e@example.com",
            status: "active",
            created_at: "2026-01-01T00:00:00Z",
          },
          subscription: { plan: "FREE", status: "active", renewed_at: null },
        },
      }),
    }),
  );

  const leaked: string[] = [];  // 건강정보가 실려 나간 요청

  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/api/") && !SERVICE_METADATA.includes(path)) {
      leaked.push(request.url());
    }
  });

  await page.goto("/");
  await page.getByRole("button", { name: "첫 구성원 등록" }).click();
  await page.getByRole("textbox", { name: "이름 또는 호칭" }).fill("테스트 가족");
  await page.getByRole("combobox", { name: "관계" }).selectOption("본인");
  await page.getByRole("button", { name: "프로필 저장" }).click();

  await expect(page.getByRole("heading", { name: "테스트 가족님의 건강기록" })).toBeVisible();
  // 작성 버튼이 곧바로 폼을 열지 않는다. `직접 작성` / `검진표 올려서 판정` 을 고르는
  // 다이얼로그가 한 단계 끼어 있다. 통과 중인 `HomePage.test.tsx` 의
  // `openRecordForm()` 과 같은 순서를 쓴다.
  await page.getByRole("button", { name: /건강기록 작성/ }).first().click();
  await page.getByRole("button", { name: /직접 작성/ }).click();
  await page.getByRole("combobox", { name: "기록 종류" }).selectOption("note");
  await page.getByRole("textbox", { name: "기록 내용" }).fill("오늘 컨디션이 좋음");
  await page.getByRole("button", { name: "기록 저장" }).click();

  await expect(page.getByText("오늘 컨디션이 좋음")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "테스트 가족님의 건강기록" })).toBeVisible();
  await expect(page.getByText("오늘 컨디션이 좋음")).toBeVisible();

  expect(leaked).toEqual([]);
});
