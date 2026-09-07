import { describe, expect, it, vi } from "vitest";
import type { ServerApiClient } from "../../shared/api/serverApiClient";
import type { LocalDomainRuntime } from "../../shared/local/localDomainRuntime";
import { migrateLocalDataToPostgres } from "./syncToPostgres";

describe("migrateLocalDataToPostgres", () => {
  it("로컬 IndexedDB의 프로필과 기록을 서버 sync API로 멱등하게 일괄 전송한다", async () => {
    const mockRuntime = {
      profiles: {
        list: vi.fn().mockResolvedValue({
          ok: true,
          value: [
            {
              id: "profile-1",
              householdId: "household-1",
              displayName: "홍길동",
              relationship: "self",
              birthDate: "1990-01-01",
              gender: "male",
              status: "active",
              version: 1,
            },
          ],
        }),
      },
      healthRecords: {
        query: vi.fn().mockResolvedValue({
          ok: true,
          value: [
            {
              id: "rec-1",
              householdId: "household-1",
              profileId: "profile-1",
              recordType: "blood_pressure",
              recordedAt: "2026-09-06T00:00:00Z",
              source: "manual",
              payload: { systolic: 120, diastolic: 80 },
              deletedAt: null,
              version: 1,
            },
          ],
        }),
      },
    } as unknown as LocalDomainRuntime;

    const mockServerClient = {
      syncProfiles: vi.fn().mockResolvedValue([]),
      syncHealthRecords: vi.fn().mockResolvedValue([]),
    } as unknown as ServerApiClient;

    const result = await migrateLocalDataToPostgres(
      mockRuntime,
      mockServerClient,
      "household-1",
    );

    expect(result.profilesCount).toBe(1);
    expect(result.recordsCount).toBe(1);
    expect(result.success).toBe(true);

    expect(mockServerClient.syncProfiles).toHaveBeenCalledWith([
      {
        id: "profile-1",
        household_id: "household-1",
        display_name: "홍길동",
        relationship: "self",
        birth_date: "1990-01-01",
        gender: "male",
        status: "active",
        row_version: 1,
      },
    ]);

    expect(mockServerClient.syncHealthRecords).toHaveBeenCalledWith([
      {
        id: "rec-1",
        profile_id: "profile-1",
        record_type: "blood_pressure",
        recorded_at: "2026-09-06T00:00:00Z",
        source: "manual",
        payload: { systolic: 120, diastolic: 80 },
        note: null,
        status: "active",
        row_version: 1,
      },
    ]);
  });

  it("로컬 기본 가구(PRIMARY_HOUSEHOLD_ID)에 저장된 프로필도 서버 가구 UUID로 안전하게 이전한다", async () => {
    const mockRuntime = {
      profiles: {
        list: vi.fn().mockImplementation((hId: string) => {
          if (hId === "ieobom-primary-household") {
            return Promise.resolve({
              ok: true,
              value: [
                {
                  id: "profile-local",
                  householdId: "ieobom-primary-household",
                  displayName: "오민재",
                  relationship: "자녀",
                  birthDate: "2010-05-10",
                  gender: "male",
                  status: "active",
                  version: 1,
                },
              ],
            });
          }
          return Promise.resolve({ ok: true, value: [] });
        }),
      },
      healthRecords: {
        query: vi.fn().mockResolvedValue({ ok: true, value: [] }),
      },
    } as unknown as LocalDomainRuntime;

    const mockServerClient = {
      syncProfiles: vi.fn().mockResolvedValue([]),
      syncHealthRecords: vi.fn().mockResolvedValue([]),
    } as unknown as ServerApiClient;

    const result = await migrateLocalDataToPostgres(
      mockRuntime,
      mockServerClient,
      "server-household-uuid-1234",
    );

    expect(result.profilesCount).toBe(1);
    expect(mockServerClient.syncProfiles).toHaveBeenCalledWith([
      {
        id: "profile-local",
        household_id: "server-household-uuid-1234",
        display_name: "오민재",
        relationship: "자녀",
        birth_date: "2010-05-10",
        gender: "male",
        status: "active",
        row_version: 1,
      },
    ]);
  });
});
