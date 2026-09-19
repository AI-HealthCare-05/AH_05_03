import { expect, test } from "@playwright/test";

import { setupE2eServerMocks } from "./mockServerApis";

test.use({ viewport: { width: 1280, height: 800 } });

test("벽 기기는 페어링 후 개요만 열고 새로고침에 구성원 세션을 복원하지 않는다", async ({ page }) => {
  test.setTimeout(60_000);
  let revoked = false;
  await page.addInitScript(() => {
    try {
      if (!window.localStorage?.getItem("ieobom:wall-device")) {
        window.localStorage?.clear();
        window.sessionStorage?.clear();
      } else {
        window.sessionStorage?.clear();
      }
    } catch {
      // ignore
    }
  });
  await setupE2eServerMocks(page, undefined, { resetStorage: false });

  await page.route(
    (url) => url.pathname === "/api/v1/household-devices",
    async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      return route.fulfill({
        status: 201,
        contentType: "application/json",
        headers: { Location: "/api/v1/household-devices/e2e-wall-device" },
        body: JSON.stringify({
          success: true,
          data: {
            id: "e2e-wall-device",
            household_id: "e2e-household-1",
            display_name: "거실 벽",
            device_token: "e2e-device-token",
            status: "active",
            row_version: 1,
            created_at: "2026-09-19T00:00:00Z",
          },
        }),
      });
    },
  );
  await page.route(
    (url) => url.pathname === "/api/v1/household-devices/me/profiles",
    async (route) => {
      if (revoked) {
        return route.fulfill({
          status: 403,
          contentType: "application/json",
          body: JSON.stringify({ success: false, error_code: "DEVICE_REVOKED", message: "철회된 벽 기기입니다." }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: {
            household_id: "e2e-household-1",
            items: [{ id: "e2e-profile-1", display_name: "오성민", relationship: "본인", member_role: "adult_member" }],
          },
        }),
      });
    },
  );
  await page.route(
    (url) => url.pathname === "/api/v1/household-devices/me/member-sessions",
    async (route) =>
      route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: {
            id: "e2e-session",
            profile_id: "e2e-profile-1",
            household_id: "e2e-household-1",
            member_role: "adult_member",
            must_change: false,
            session_token: "e2e-member-session",
            expires_at: "2026-09-19T21:10:00Z",
          },
        }),
      }),
  );

  await page.goto("/wall/pair");
  await page.getByLabel("가정 ID").fill("e2e-household-1");
  await page.getByLabel("페어링 코드").fill("ABCD2345");
  await page.getByRole("button", { name: "이 가구에 연결" }).click();

  await expect(page.getByRole("heading", { name: "가족 개요" })).toBeVisible();
  await page.getByRole("button", { name: "오성민 · 본인" }).click();
  await page.getByLabel("구성원 PIN").fill("482913");
  await page.getByRole("button", { name: "이 구성원으로" }).click();
  await expect(page.getByText(/지금 오성민 권한입니다/u)).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: "가족 개요" })).toBeVisible();
  await expect(page.getByText(/지금 오성민 권한입니다/u)).toHaveCount(0);

  revoked = true;
  await page.reload();
  await expect(page.getByText(/철회되었거나 등록되지 않았습니다/u)).toBeVisible();
});
