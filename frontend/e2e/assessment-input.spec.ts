import { expect, test } from "@playwright/test";
import { setupE2eServerMocks } from "./mockServerApis";

test("추가 입력을 접어도 값이 유지되고 오류 항목으로 이동할 수 있다", async ({ page }) => {
  await setupE2eServerMocks(page, {
    profiles: [{
      id: "assessment-profile", household_id: "e2e-household-1", created_by_account_id: "e2e-account",
      display_name: "가족 대표", relationship: "본인", gender: "male", birth_date: "1990-01-01",
      status: "active", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", row_version: 1,
    }],
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/assessment");
  await expect(page.getByRole("heading", { name: "건강 정보 입력" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "검진표로 간편하게 입력" })).toBeVisible();
  await expect(page.locator(".assess-extra-group[open]")).toHaveCount(0);
  await expect(page.locator(".assess-fields input:visible, .assess-fields select:visible")).toHaveCount(12);
  await page.screenshot({ path: "test-results/assessment-desktop.png", fullPage: true });

  await page.locator(".assess-presets > summary").click();
  await page.getByRole("button", { name: "당뇨", exact: true }).click();
  await expect(page.getByRole("progressbar", { name: "필수 입력 진행률" })).toHaveAttribute("value", "8");
  const extra = page.locator(".assess-extra-group").filter({ has: page.locator("summary", { hasText: "간 · 신장 · 혈액" }) });
  const hemoglobin = page.getByRole("spinbutton", { name: /^혈색소/ });
  await hemoglobin.fill("145");
  await extra.locator("summary").click();
  await expect(hemoglobin).toBeHidden();
  await page.getByRole("button", { name: "판정하기", exact: true }).click();
  await expect(hemoglobin).toBeVisible();
  await expect(hemoglobin).toBeFocused();
  await expect(hemoglobin).toHaveValue("145");
  await expect(hemoglobin).toHaveAttribute("aria-invalid", "true");

  await page.getByRole("button", { name: "테스트 값 비우기" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "test-results/assessment-mobile.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
