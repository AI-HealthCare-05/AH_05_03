import { expect, test } from "@playwright/test";

import { DEV_FAMILY_HOME_PATH } from "./devFamilyHome";
import { setupE2eServerMocks } from "./mockServerApis";

test.use({ viewport: { width: 1280, height: 800 } });

test("가구 보안 게이트: 자녀 PIN·직접 URL 차단·감사 화면에 PIN 원문이 없다", async ({ page }) => {
  test.setTimeout(60_000);
  await setupE2eServerMocks(page);

  await page.route(
    (url) => url.pathname === "/api/v1/households",
    async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: {
            items: [
              {
                id: "e2e-household-1",
                master_account_id: "e2e-account",
                created_by_account_id: "e2e-account",
                status: "active",
                created_at: "2026-01-01T00:00:00Z",
                row_version: 1,
              },
            ],
          },
        }),
      });
    },
  );
  await page.route(
    (url) => url.pathname === "/api/v1/households/e2e-household-1/devices",
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: {
            items: [
              {
                id: "e2e-wall",
                household_id: "e2e-household-1",
                display_name: "거실 벽",
                status: "active",
                last_seen_at: null,
                created_at: "2026-09-19T00:00:00Z",
                row_version: 1,
              },
            ],
          },
        }),
      }),
  );
  await page.route(
    (url) => url.pathname === "/api/v1/households/e2e-household-1/pin-lock-alerts",
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: {
            items: [{ id: "e2e-lock", profile_id: "e2e-child", attempts: "5", occurred_at: "2026-09-19T00:00:00Z" }],
          },
        }),
      }),
  );
  await page.route(
    (url) => url.pathname === "/api/v1/households/e2e-household-1/audit-events",
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: {
            items: [
              {
                id: "e2e-audit-1",
                event_type: "member_pin.lock",
                target_type: "family_profile",
                target_ref: "e2e-child",
                actor_account_id: null,
                occurred_at: "2026-09-19T00:00:00Z",
                metadata: { attempts: "5" },
              },
            ],
          },
        }),
      }),
  );
  await page.route(
    (url) => url.pathname === "/api/v1/family-invitations",
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, data: { sent: [], received: [] } }),
      }),
  );
  await page.route(
    (url) => url.pathname === "/api/v1/profile-links",
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, data: { items: [] } }),
      }),
  );

  await page.goto(DEV_FAMILY_HOME_PATH);
  await page.getByRole("button", { name: "구성원 추가" }).click();
  await page.getByRole("textbox", { name: "이름 또는 호칭" }).fill("자녀슬롯");
  await page.getByRole("combobox", { name: "관계" }).selectOption("자녀");
  await page.getByRole("button", { name: "프로필 저장" }).click();
  await expect(page.getByRole("dialog", { name: "이번만 보이는 임시 PIN" })).toBeVisible();
  await page.getByRole("button", { name: "확인했습니다" }).click();
  await expect(page.getByRole("button", { name: "자녀슬롯 · 자녀" })).toBeVisible();

  await page.goto("/account");
  await expect(page.getByRole("heading", { name: "벽 기기 연결" })).toBeVisible();
  await expect(page.getByText("구성원 PIN이 잠겼습니다")).toBeVisible();
  await expect(page.getByRole("heading", { name: "권한 변경 기록" })).toBeVisible();
  await expect(page.getByText("구성원 PIN 잠금")).toBeVisible();
  await expect(page.getByText("482913")).toHaveCount(0);
  await expect(page.getByLabel("계정 비밀번호")).toBeVisible();
  await expect(page.getByRole("button", { name: "모든 벽 기기 비상 철회" })).toBeVisible();
});
