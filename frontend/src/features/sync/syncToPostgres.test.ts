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

  it("서버에 이미 동일한 이름의 프로필이 존재하는 경우 중복 생성하지 않고 기존 ID에 매핑한다", async () => {
    const mockRuntime = {
      profiles: {
        list: vi.fn().mockImplementation((hId: string) => {
          if (hId === "ieobom-primary-household") {
            return Promise.resolve({
              ok: true,
              value: [
                {
                  id: "local-sungmin-id",
                  householdId: "ieobom-primary-household",
                  displayName: "오성민",
                  relationship: "본인",
                  birthDate: "1988-10-28",
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
        query: vi.fn().mockResolvedValue({
          ok: true,
          value: [
            {
              id: "rec-1",
              profileId: "local-sungmin-id",
              recordType: "blood_pressure",
              recordedAt: "2026-09-07T00:00:00Z",
              source: "manual",
              payload: { systolic: 125, diastolic: 82 },
              deletedAt: null,
              version: 1,
            },
          ],
        }),
      },
    } as unknown as LocalDomainRuntime;

    const mockServerClient = {
      listProfiles: vi.fn().mockResolvedValue([
        {
          id: "server-sungmin-existing-uuid",
          household_id: "server-household-1",
          display_name: "오성민",
          relationship: "본인",
          birth_date: null,
          gender: null,
          status: "active",
          row_version: 1,
        },
      ]),
      syncProfiles: vi.fn().mockResolvedValue([]),
      syncHealthRecords: vi.fn().mockResolvedValue([]),
      updateProfile: vi.fn().mockResolvedValue({}),
    } as unknown as ServerApiClient;

    const result = await migrateLocalDataToPostgres(
      mockRuntime,
      mockServerClient,
      "server-household-1",
    );

    expect(result.profilesCount).toBe(0); // 중복이므로 새로 생성하지 않음!
    expect(mockServerClient.syncProfiles).not.toHaveBeenCalled();

    // 로컬의 생년월일/성별로 기존 서버 프로필 보완 업데이트 호출됨
    expect(mockServerClient.updateProfile).toHaveBeenCalledWith(
      "server-sungmin-existing-uuid",
      {
        birth_date: "1988-10-28",
        gender: "male",
      },
    );

    // 건강 기록은 서버 프로필 ID로 매핑되어 전송됨
    expect(mockServerClient.syncHealthRecords).toHaveBeenCalledWith([
      expect.objectContaining({
        id: "rec-1",
        profile_id: "server-sungmin-existing-uuid",
      }),
    ]);
  });
});

describe("deduplicateHouseholdProfiles", () => {
  it("동일 이름 중복 프로필 중 건강 기록이 있는 프로필을 보존하고 빈 프로필은 삭제(deleteEmpty)한다", async () => {
    const { deduplicateHouseholdProfiles } = await import("./syncToPostgres");

    const mockProfiles = [
      {
        id: "empty-sungmin",
        householdId: "h-1",
        displayName: "오성민",
        relationship: "본인",
        birthDate: "1988-10-28",
        gender: "male" as const,
        status: "active" as const,
        version: 1,
        createdAt: "2026-09-07T00:00:00Z",
        updatedAt: "2026-09-07T00:00:00Z",
      },
      {
        id: "active-sungmin-with-data",
        householdId: "h-1",
        displayName: "오성민",
        relationship: "본인",
        birthDate: "1988-10-28",
        gender: "male" as const,
        status: "active" as const,
        version: 2,
        createdAt: "2026-09-07T01:00:00Z",
        updatedAt: "2026-09-07T01:00:00Z",
      },
    ];

    const mockRuntime = {
      healthRecords: {
        query: vi.fn().mockImplementation(({ profileId }: { profileId: string }) => {
          if (profileId === "active-sungmin-with-data") {
            return Promise.resolve({ ok: true, value: [{ id: "rec-1" }, { id: "rec-2" }] });
          }
          return Promise.resolve({ ok: true, value: [] });
        }),
      },
      profiles: {
        deleteEmpty: vi.fn().mockResolvedValue({ ok: true, value: { deleted: true } }),
      },
    } as unknown as Parameters<typeof deduplicateHouseholdProfiles>[0];

    const result = await deduplicateHouseholdProfiles(
      mockRuntime,
      mockProfiles as unknown as Parameters<typeof deduplicateHouseholdProfiles>[1],
    );

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("active-sungmin-with-data");
    expect(mockRuntime.profiles.deleteEmpty).toHaveBeenCalledWith("empty-sungmin");
  });

  it("둘 다 건강 기록이 없는 경우 더 완성도 높고 구체적인 프로필(배우자)을 보존한다", async () => {
    const { deduplicateHouseholdProfiles } = await import("./syncToPostgres");

    const mockProfiles = [
      {
        id: "dawon-child-test",
        householdId: "h-1",
        displayName: "김다원",
        relationship: "자녀",
        birthDate: "1988-01-01",
        gender: "female" as const,
        status: "active" as const,
        version: 1,
        createdAt: "2026-09-07T00:00:00Z",
        updatedAt: "2026-09-07T00:00:00Z",
      },
      {
        id: "dawon-spouse-real",
        householdId: "h-1",
        displayName: "김다원",
        relationship: "배우자",
        birthDate: "1990-05-15",
        gender: "female" as const,
        status: "active" as const,
        version: 1,
        createdAt: "2026-09-07T01:00:00Z",
        updatedAt: "2026-09-07T01:00:00Z",
      },
    ];

    const mockRuntime = {
      healthRecords: {
        query: vi.fn().mockResolvedValue({ ok: true, value: [] }),
      },
      profiles: {
        deleteEmpty: vi.fn().mockResolvedValue({ ok: true, value: { deleted: true } }),
      },
    } as unknown as Parameters<typeof deduplicateHouseholdProfiles>[0];

    const result = await deduplicateHouseholdProfiles(
      mockRuntime,
      mockProfiles as unknown as Parameters<typeof deduplicateHouseholdProfiles>[1],
    );

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("dawon-spouse-real");
    expect(result[0].relationship).toBe("배우자");
    expect(mockRuntime.profiles.deleteEmpty).toHaveBeenCalledWith("dawon-child-test");
  });
});
