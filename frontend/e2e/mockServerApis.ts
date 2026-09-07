import type { Page } from "@playwright/test";

export interface MockServerState {
  households: Array<{ id: string; name: string; role: string; created_at: string }>;
  profiles: Array<{
    id: string;
    household_id: string;
    created_by_account_id: string;
    display_name: string;
    relationship: string;
    gender: "male" | "female" | null;
    birth_date: string | null;
    status: "active" | "hidden" | "deleted";
    created_at: string;
    updated_at: string;
    row_version: number;
  }>;
  healthRecords: Array<{
    id: string;
    profile_id: string;
    record_type: string;
    recorded_at: string;
    source: string;
    payload: Record<string, unknown>;
    note: string | null;
    status: string;
    created_at: string;
    updated_at: string;
    row_version: number;
  }>;
  painRecords: Array<{
    id: string;
    profile_id: string;
    recorded_at: string;
    source: string;
    payload: Record<string, unknown>;
    note: string | null;
    status: string;
    created_at: string;
    updated_at: string;
    row_version: number;
  }>;
}

export async function setupE2eServerMocks(
  page: Page,
  initialState?: Partial<MockServerState>,
): Promise<MockServerState> {
  const state: MockServerState = {
    households: initialState?.households ?? [
      { id: "e2e-household-1", name: "우리집", role: "owner", status: "active", created_at: "2026-01-01T00:00:00Z" },
    ],
    profiles: initialState?.profiles ?? [],
    healthRecords: initialState?.healthRecords ?? [],
    painRecords: initialState?.painRecords ?? [],
  };

  // 0. Fallback for unhandled /api/v1/* requests (lowest priority since registered first in Playwright)
  await page.route(
    (url) => url.pathname.startsWith("/api/v1/"),
    async (route) => {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, data: { items: [] } }),
      });
    },
  );

  // 1. Auth Refresh
  await page.route(
    (url) => url.pathname === "/api/v1/auth/refresh",
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: { access_token: "e2e-token", token_type: "bearer", expires_in: 900 },
        }),
      }),
  );

  // 1-1. Password Reset Request
  await page.route(
    (url) => url.pathname === "/api/v1/auth/password-reset/request",
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: null,
          message: "입력하신 이메일로 비밀번호 재설정 안내를 전송했습니다.",
        }),
      }),
  );

  // 1-2. Password Reset Confirm
  await page.route(
    (url) => url.pathname === "/api/v1/auth/password-reset/confirm",
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: null,
          message: "비밀번호가 성공적으로 변경되었습니다.",
        }),
      }),
  );

  // 2. Account
  await page.route(
    (url) => url.pathname === "/api/v1/account",
    (route) =>
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

  // 3. Challenges
  await page.route(
    (url) => url.pathname === "/api/v1/challenges/today",
    (route) =>
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

  // 4. Households
  await page.route(
    (url) => url.pathname === "/api/v1/households" || url.pathname.startsWith("/api/v1/households/"),
    async (route) => {
      const method = route.request().method();
      if (method === "POST") {
        const newHousehold = {
          id: `hh-${Date.now()}`,
          name: "우리집",
          role: "owner",
          status: "active",
          created_at: new Date().toISOString(),
        };
        state.households.push(newHousehold);
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ success: true, data: newHousehold }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, data: { items: state.households } }),
      });
    },
  );

  // 5. Profiles
  await page.route(
    (url) => url.pathname === "/api/v1/profiles" || url.pathname.startsWith("/api/v1/profiles/"),
    async (route) => {
      const url = new URL(route.request().url());
      const method = route.request().method();

      if (method === "GET") {
        const match = url.pathname.match(/\/api\/v1\/profiles\/([^/?]+)/);
        if (match) {
          const id = decodeURIComponent(match[1]);
          const profile = state.profiles.find((p) => p.id === id);
          if (profile) {
            return route.fulfill({
              status: 200,
              contentType: "application/json",
              body: JSON.stringify({ success: true, data: profile }),
            });
          }
          return route.fulfill({ status: 404, body: JSON.stringify({ success: false, error: "Not Found" }) });
        }

        const householdId = url.searchParams.get("household_id");
        const includeHidden = url.searchParams.get("include_hidden") === "true";
        const items = state.profiles.filter((p) => {
          if (householdId && p.household_id !== householdId) return false;
          if (!includeHidden && p.status !== "active") return false;
          return true;
        });
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ success: true, data: { items } }),
        });
      }

      if (method === "POST") {
        const body = JSON.parse(route.request().postData() || "{}");
        const now = new Date().toISOString();
        const newProfile = {
          id: body.id || `profile-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          household_id: body.household_id || state.households[0]?.id || "e2e-household-1",
          created_by_account_id: "e2e-account",
          display_name: body.display_name || "",
          relationship: body.relationship || "본인",
          gender: body.gender || "male",
          birth_date: body.birth_date || null,
          status: "active" as const,
          created_at: now,
          updated_at: now,
          row_version: 1,
        };
        state.profiles.push(newProfile);
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ success: true, data: newProfile }),
        });
      }

      if (method === "PATCH") {
        const match = url.pathname.match(/\/api\/v1\/profiles\/([^/?]+)/);
        if (match) {
          const id = decodeURIComponent(match[1]);
          const profile = state.profiles.find((p) => p.id === id);
          if (profile) {
            const body = JSON.parse(route.request().postData() || "{}");
            Object.assign(profile, body, {
              updated_at: new Date().toISOString(),
              row_version: (profile.row_version || 1) + 1,
            });
            return route.fulfill({
              status: 200,
              contentType: "application/json",
              body: JSON.stringify({ success: true, data: profile }),
            });
          }
        }
        return route.fulfill({ status: 404, body: JSON.stringify({ success: false, error: "Not Found" }) });
      }

      return route.continue();
    },
  );

  // 6. Health Records
  await page.route(
    (url) => url.pathname === "/api/v1/health-records" || url.pathname.startsWith("/api/v1/health-records/"),
    async (route) => {
      const url = new URL(route.request().url());
      const method = route.request().method();

      if (method === "GET") {
        const profileId = url.searchParams.get("profile_id");
        const items = state.healthRecords.filter((r) => (!profileId || r.profile_id === profileId) && r.status !== "deleted");
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ success: true, data: { items } }),
        });
      }

      if (method === "POST") {
        const body = JSON.parse(route.request().postData() || "{}");
        const now = new Date().toISOString();
        const newRecord = {
          id: body.id || `record-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          profile_id: body.profile_id,
          record_type: body.record_type,
          recorded_at: body.recorded_at || now,
          source: body.source || "manual",
          payload: body.payload || {},
          note: body.note || null,
          status: "active",
          created_at: now,
          updated_at: now,
          row_version: 1,
        };
        state.healthRecords.push(newRecord);
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ success: true, data: newRecord }),
        });
      }

      return route.continue();
    },
  );

  // 7. Pain Records
  await page.route(
    (url) => url.pathname === "/api/v1/pain-records" || url.pathname.startsWith("/api/v1/pain-records/"),
    async (route) => {
      const url = new URL(route.request().url());
      const method = route.request().method();

      if (method === "GET") {
        const profileId = url.searchParams.get("profile_id");
        const items = state.painRecords.filter((r) => (!profileId || r.profile_id === profileId) && r.status !== "deleted");
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ success: true, data: { items } }),
        });
      }

      if (method === "POST") {
        const body = JSON.parse(route.request().postData() || "{}");
        const now = new Date().toISOString();
        const newRecord = {
          id: body.id || `pain-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          profile_id: body.profile_id,
          recorded_at: body.recorded_at || now,
          source: body.source || "manual",
          payload: body.payload || {},
          note: body.note || null,
          status: "active",
          created_at: now,
          updated_at: now,
          row_version: 1,
        };
        state.painRecords.push(newRecord);
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ success: true, data: newRecord }),
        });
      }

      return route.continue();
    },
  );

  return state;
}
