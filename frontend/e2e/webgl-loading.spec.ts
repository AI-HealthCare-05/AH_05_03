import { expect, test } from "@playwright/test";

test("남녀 핵심 인체를 먼저 표시하고 세부 레이어와 재방문 캐시를 준비한다", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const appUrl = process.env.E2E_BASE_URL ?? "/";
  const failures: string[] = [];
  const browserErrors: string[] = [];
  const maleGlbRequests: string[] = [];
  page.on("requestfailed", (request) => failures.push(`${request.url()} ${request.failure()?.errorText}`));
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.endsWith(".glb")) maleGlbRequests.push(url.pathname);
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });

  await page.route("**/api/v1/auth/refresh", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: { access_token: "webgl-token", token_type: "bearer", expires_in: 900 },
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
          account: { id: "webgl-account", email: "webgl@example.com", status: "active" },
          subscription: { plan: "FREE", status: "active", renewed_at: null },
        },
      }),
    }),
  );
  await page.route("**/api/v1/challenges/today", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          today: "2026-09-04",
          daily: [],
          measures: [],
          water_requirement: 4,
          checked_count: 0,
          watered_today: false,
          garden: {
            total_points: 0,
            tree: { key: "seed", label: "씨앗", index: 1, total: 6, points_to_next: 10, next_label: "새싹" },
            nutrition: { label: "보통", current_streak: 0 },
            animals: [],
            week: { water_days: 0, water_required: 5, measure_count: 0, measure_required: 1 },
          },
        },
      }),
    }),
  );
  await page.route("**/vanatome-official-complete-*.glb", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    await route.continue();
  });
  await page.route("**/z-anatomy-1.4.0-other-core.glb", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    await route.continue();
  });

  await page.goto(appUrl);
  await page.getByRole("button", { name: "첫 구성원 등록" }).click();
  await page.getByRole("textbox", { name: "이름 또는 호칭" }).fill("WebGL 진단");
  await page.getByRole("combobox", { name: "관계" }).selectOption("본인");
  await page.getByRole("button", { name: "프로필 저장" }).click();
  await expect(page.getByRole("heading", { name: "WebGL 진단님의 건강기록" })).toBeVisible();

  await expect(page.locator(".anatomy-atlas-switch")
    .getByRole("button", { name: "남성", exact: true }))
    .toHaveAttribute("aria-pressed", "true", { timeout: 45_000 });
  await expect(page.locator(".vanatome-loading")).toHaveCount(0);
  await expect(page.locator(".vanatome-lazy-status")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "외피계", exact: true })).toBeEnabled({ timeout: 45_000 });
  await expect(page.getByRole("button", { name: "외피계", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "골격계", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "근육계", exact: true })).toHaveAttribute("aria-pressed", "false");
  const expectedBackgroundAssets = [
    "/vendor/vanatome/models/z-anatomy-1.4.0-other-core.glb",
    "/vendor/vanatome/layers/official-32693313/vanatome-official-complete-head.glb",
    "/vendor/vanatome/layers/official-32693313/vanatome-official-complete-upper.glb",
    "/vendor/vanatome/layers/official-32693313/vanatome-official-complete-lower.glb",
    "/vendor/vanatome/layers/official-32693313/vanatome-official-complete-hand.glb",
  ];
  await expect.poll(
    () => expectedBackgroundAssets.every((asset) => maleGlbRequests.includes(asset)),
    { timeout: 15_000 },
  ).toBe(true);
  await expect(page.getByRole("button", { name: "근육계", exact: true })).toBeEnabled({ timeout: 120_000 });

  const requestsBeforeToggle = maleGlbRequests.length;
  const canvasBeforeMuscle = await page.locator(".body-map-viewer canvas").screenshot();
  await expect(page.getByRole("button", { name: "근육계", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "근육계", exact: true }).click();
  await expect(page.getByRole("button", { name: "근육계", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.waitForTimeout(500);
  const canvasAfterMuscle = await page.locator(".body-map-viewer canvas").screenshot();
  expect(canvasAfterMuscle.equals(canvasBeforeMuscle)).toBe(false);
  expect(maleGlbRequests).toHaveLength(requestsBeforeToggle);

  await page.locator(".anatomy-atlas-switch")
    .getByRole("button", { name: "여성", exact: true })
    .click();
  const femaleAssets = [
    "/vendor/vanatome/composites/tripo-shell-z-anatomy-core-v1/ieobom-female-static-shell-crotch-cleanup-v52.glb",
    "/vendor/vanatome/composites/tripo-shell-z-anatomy-core-v1/ieobom-female-static-skeleton-exposed-bone-fit-v66.glb",
    "/vendor/vanatome/composites/tripo-shell-z-anatomy-core-v1/ieobom-female-organs-core-v2.glb",
    "/vendor/vanatome/composites/tripo-shell-z-anatomy-core-v1/ieobom-female-muscles-anatomy-fit-v67.glb",
    "/vendor/vanatome/composites/tripo-shell-z-anatomy-core-v1/ieobom-female-support-v3-joints-ligaments.glb",
    "/vendor/vanatome/composites/tripo-shell-z-anatomy-core-v1/ieobom-female-nervous-v4-central-major.glb",
    "/vendor/vanatome/composites/tripo-shell-z-anatomy-core-v1/ieobom-female-lymphatic-v3-curated.glb",
    "/vendor/vanatome/composites/tripo-shell-z-anatomy-core-v1/ieobom-female-reproductive-v2.glb",
    "/vendor/vanatome/composites/tripo-shell-z-anatomy-core-v1/ieobom-female-urinary-v2.glb",
    "/vendor/vanatome/composites/tripo-shell-z-anatomy-core-v1/ieobom-female-mammary-v2.glb",
  ];
  await expect.poll(
    () => femaleAssets.every((asset) => maleGlbRequests.includes(asset)),
    { timeout: 120_000 },
  ).toBe(true);
  await expect(page.getByRole("button", { name: "근육계", exact: true })).toBeEnabled({ timeout: 120_000 });
  await expect(page.locator(".body-map-viewer canvas")).toBeVisible();
  await page.locator(".vanatome-focus-buttons")
    .getByRole("button", { name: "하반신", exact: true })
    .click();
  await page.waitForTimeout(800);
  await testInfo.attach("female-v52-lower-body-default-layers", {
    body: await page.locator(".body-map-viewer canvas").screenshot(),
    contentType: "image/png",
  });
  await page.locator(".vanatome-focus-buttons")
    .getByRole("button", { name: "전체", exact: true })
    .click();
  await page.waitForTimeout(500);
  await page.locator(".vanatome-system-layers")
    .getByRole("button", { name: "전체 켜기", exact: true })
    .click();
  await page.waitForTimeout(500);
  await testInfo.attach("female-all-layers", {
    body: await page.locator(".body-map-viewer canvas").screenshot(),
    contentType: "image/png",
  });

  await expect.poll(async () => page.evaluate(async (paths) => {
    const cache = await window.caches.open("ieobom-anatomy-resources-v1");
    const keys = await cache.keys();
    const cachedPaths = keys.map((request) => new URL(request.url).pathname);
    return paths.filter((path) => cachedPaths.includes(path)).length;
  }, femaleAssets), { timeout: 15_000 }).toBe(femaleAssets.length);

  const femaleRequestsBeforeRevisit = maleGlbRequests.filter((path) => femaleAssets.includes(path)).length;
  await page.locator(".anatomy-atlas-switch")
    .getByRole("button", { name: "남성", exact: true })
    .click();
  await expect(page.getByRole("button", { name: "외피계", exact: true })).toBeEnabled({ timeout: 45_000 });
  await page.locator(".anatomy-atlas-switch")
    .getByRole("button", { name: "여성", exact: true })
    .click();
  await expect(page.getByRole("button", { name: "근육계", exact: true })).toBeEnabled({ timeout: 120_000 });
  const femaleRequestsAfterRevisit = maleGlbRequests.filter((path) => femaleAssets.includes(path)).length;
  expect(femaleRequestsAfterRevisit).toBe(femaleRequestsBeforeRevisit);

  // Switching atlases intentionally aborts every still-pending request from
  // the previous scene. Only non-abort network failures are regressions.
  const unexpectedFailures = failures.filter((failure) => !failure.includes("net::ERR_ABORTED"));
  expect(unexpectedFailures).toEqual([]);
  expect(browserErrors).toEqual([]);
  await expect(page.locator(".body-map-viewer canvas")).toBeVisible();
});
