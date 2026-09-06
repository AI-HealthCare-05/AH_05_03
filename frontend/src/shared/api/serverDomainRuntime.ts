import type {
  DashboardSummary,
  FamilyHistory,
  FamilyProfile,
  HealthRecord,
  HealthRecordType,
  ISODate,
  ISODateTime,
  LocalErrorCode,
  LocalResult,
} from "../local/domainContracts";
import type { LocalDomainRuntime } from "../local/localDomainRuntime";
import { serverApiClient, type ServerApiClient } from "./serverApiClient";
import type {
  HealthRecordServerData,
  ProfileServerData,
} from "./contracts";

export function toClientProfile(server: ProfileServerData): FamilyProfile {
  return {
    id: server.id,
    householdId: server.household_id,
    displayName: server.display_name,
    relationship: server.relationship,
    birthDate: (server.birth_date as ISODate | null) ?? null,
    gender: server.gender,
    opaqueServerRef: null,
    serverRefState: "active",
    status: server.status === "deleted" ? "hidden" : server.status,
    mergedIntoProfileId: null,
    createdAt: server.created_at,
    updatedAt: server.updated_at,
    version: server.row_version,
  };
}

export function toClientHealthRecord<T extends object = Record<string, unknown>>(
  server: HealthRecordServerData,
  householdId = "",
): HealthRecord<T> {
  return {
    id: server.id,
    householdId,
    profileId: server.profile_id,
    recordType: server.record_type as HealthRecordType,
    recordedAt: server.recorded_at,
    source: (server.source as HealthRecord["source"]) || "manual",
    payload: (server.payload || {}) as T,
    sourceDocumentId: null,
    deletedAt: server.status === "deleted" ? server.updated_at : null,
    createdAt: server.created_at,
    updatedAt: server.updated_at,
    version: server.row_version,
  };
}

function success<T>(value: T): LocalResult<T> {
  return { ok: true, value };
}

function failure<T>(code: LocalErrorCode, message: string, retryable = false): LocalResult<T> {
  return { ok: false, error: { code, message, retryable } };
}

export class ServerProfileService {
  public constructor(
    private readonly client: ServerApiClient,
    private readonly householdId: string,
  ) {}

  public async list(householdId = this.householdId): Promise<LocalResult<FamilyProfile[]>> {
    try {
      const items = await this.client.listProfiles(householdId, false);
      const active = items.filter((p) => p.status === "active").map(toClientProfile);
      return success(active);
    } catch (err) {
      return failure("NOT_FOUND", err instanceof Error ? err.message : "프로필 조회 실패");
    }
  }

  public async listHidden(householdId = this.householdId): Promise<LocalResult<FamilyProfile[]>> {
    try {
      const items = await this.client.listProfiles(householdId, true);
      const hidden = items.filter((p) => p.status === "hidden").map(toClientProfile);
      return success(hidden);
    } catch (err) {
      return failure("NOT_FOUND", err instanceof Error ? err.message : "숨김 프로필 조회 실패");
    }
  }

  public async get(profileId: string): Promise<LocalResult<FamilyProfile>> {
    try {
      const res = await this.client.getProfile(profileId);
      return success(toClientProfile(res));
    } catch (err) {
      return failure("NOT_FOUND", err instanceof Error ? err.message : "프로필을 찾을 수 없습니다.");
    }
  }

  public async create(input: {
    householdId: string;
    displayName: string;
    relationship: string;
    birthDate?: ISODate;
    gender?: "male" | "female" | null;
  }): Promise<LocalResult<FamilyProfile>> {
    try {
      const created = await this.client.createProfile({
        household_id: input.householdId || this.householdId,
        display_name: input.displayName,
        relationship: input.relationship,
        birth_date: input.birthDate ?? null,
        gender: input.gender ?? null,
      });
      return success(toClientProfile(created));
    } catch (err) {
      return failure("VALIDATION_ERROR", err instanceof Error ? err.message : "프로필 생성 실패");
    }
  }

  public async update(
    profileId: string,
    input: {
      displayName: string;
      relationship: string;
      birthDate?: ISODate;
      gender?: "male" | "female" | null;
      expectedVersion?: number;
    },
  ): Promise<LocalResult<FamilyProfile>> {
    try {
      const updated = await this.client.updateProfile(profileId, {
        display_name: input.displayName,
        relationship: input.relationship,
        birth_date: input.birthDate ?? null,
        gender: input.gender ?? null,
      });
      return success(toClientProfile(updated));
    } catch (err) {
      return failure("VERSION_CONFLICT", err instanceof Error ? err.message : "프로필 수정 실패");
    }
  }

  public async hide(profileId: string): Promise<LocalResult<FamilyProfile>> {
    try {
      const updated = await this.client.updateProfile(profileId, { status: "hidden" });
      return success(toClientProfile(updated));
    } catch (err) {
      return failure("NOT_FOUND", err instanceof Error ? err.message : "프로필 숨김 실패");
    }
  }

  public async restore(profileId: string): Promise<LocalResult<FamilyProfile>> {
    try {
      const updated = await this.client.updateProfile(profileId, { status: "active" });
      return success(toClientProfile(updated));
    } catch (err) {
      return failure("NOT_FOUND", err instanceof Error ? err.message : "프로필 복원 실패");
    }
  }

  public async softDelete(profileId: string): Promise<LocalResult<FamilyProfile>> {
    try {
      const updated = await this.client.updateProfile(profileId, { status: "deleted" });
      return success(toClientProfile(updated));
    } catch (err) {
      return failure("NOT_FOUND", err instanceof Error ? err.message : "프로필 삭제 실패");
    }
  }

  public async purge(profileId: string): Promise<LocalResult<void>> {
    try {
      await this.client.deleteProfile(profileId);
      return success(undefined);
    } catch (err) {
      return failure("NOT_FOUND", err instanceof Error ? err.message : "프로필 영구 삭제 실패");
    }
  }

  public async setServerReference(profileId: string): Promise<LocalResult<FamilyProfile>> {
    return this.get(profileId);
  }

  public async findServerReference(): Promise<LocalResult<string | null>> {
    return success(null);
  }
}

export class ServerHealthRecordService {
  public constructor(
    private readonly client: ServerApiClient,
    private readonly householdId: string,
  ) {}

  public async create<T extends object>(input: {
    householdId?: string;
    profileId: string;
    recordType: HealthRecordType;
    recordedAt: ISODateTime;
    source?: HealthRecord["source"];
    payload: T;
    sourceDocumentId?: string;
  }): Promise<LocalResult<HealthRecord<T>>> {
    try {
      const created = await this.client.createHealthRecord({
        profile_id: input.profileId,
        record_type: input.recordType,
        recorded_at: input.recordedAt,
        source: input.source || "manual",
        payload: input.payload as Record<string, unknown>,
      });
      return success(toClientHealthRecord<T>(created, input.householdId || this.householdId));
    } catch (err) {
      return failure("VALIDATION_ERROR", err instanceof Error ? err.message : "건강기록 생성 실패");
    }
  }

  public async query(input: {
    profileId: string;
    recordTypes?: HealthRecordType[];
    recordType?: HealthRecordType;
    fromDate?: ISODateTime;
    toDate?: ISODateTime;
    includeDeleted?: boolean;
  }): Promise<LocalResult<HealthRecord[]>> {
    try {
      const serverRecords = await this.client.listHealthRecords(input.profileId, {
        recordType: input.recordType,
        limit: 500,
      });

      let results = serverRecords.map((r) => toClientHealthRecord(r, this.householdId));

      if (!input.includeDeleted) {
        results = results.filter((r) => !r.deletedAt);
      }
      if (input.recordTypes && input.recordTypes.length > 0) {
        const set = new Set(input.recordTypes);
        results = results.filter((r) => set.has(r.recordType));
      }
      if (input.fromDate) {
        results = results.filter((r) => r.recordedAt >= input.fromDate!);
      }
      if (input.toDate) {
        results = results.filter((r) => r.recordedAt <= input.toDate!);
      }

      // 최신순 정렬
      results.sort((a, b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt));
      return success(results);
    } catch (err) {
      return failure("NOT_FOUND", err instanceof Error ? err.message : "건강기록 조회 실패");
    }
  }

  public async get(recordId: string): Promise<LocalResult<HealthRecord>> {
    try {
      const res = await this.client.getHealthRecord(recordId);
      return success(toClientHealthRecord(res, this.householdId));
    } catch (err) {
      return failure("NOT_FOUND", err instanceof Error ? err.message : "기록을 찾을 수 없습니다.");
    }
  }

  public async update<T extends object>(
    recordId: string,
    input: {
      recordType?: HealthRecordType;
      recordedAt?: ISODateTime;
      payload?: T;
      expectedVersion?: number;
    },
  ): Promise<LocalResult<HealthRecord<T>>> {
    try {
      const updated = await this.client.updateHealthRecord(recordId, {
        record_type: input.recordType,
        recorded_at: input.recordedAt,
        payload: input.payload as Record<string, unknown> | undefined,
      });
      return success(toClientHealthRecord<T>(updated, this.householdId));
    } catch (err) {
      return failure("VERSION_CONFLICT", err instanceof Error ? err.message : "기록 수정 실패");
    }
  }

  public async softDelete(recordId: string): Promise<LocalResult<HealthRecord>> {
    try {
      const current = await this.get(recordId);
      await this.client.deleteHealthRecord(recordId);
      if (current.ok) {
        return success({
          ...current.value,
          deletedAt: new Date().toISOString(),
          version: current.value.version + 1,
        });
      }
      return current;
    } catch (err) {
      return failure("NOT_FOUND", err instanceof Error ? err.message : "기록 삭제 실패");
    }
  }

  public async restore(recordId: string): Promise<LocalResult<HealthRecord>> {
    try {
      const updated = await this.client.updateHealthRecord(recordId, { status: "active" });
      return success(toClientHealthRecord(updated, this.householdId));
    } catch (err) {
      return failure("NOT_FOUND", err instanceof Error ? err.message : "기록 복원 실패");
    }
  }

  public async purge(recordId: string): Promise<LocalResult<void>> {
    try {
      await this.client.deleteHealthRecord(recordId);
      return success(undefined);
    } catch (err) {
      return failure("NOT_FOUND", err instanceof Error ? err.message : "기록 영구 삭제 실패");
    }
  }
}

export class ServerDashboardService {
  public constructor(private readonly recordService: ServerHealthRecordService) {}

  public async summarize(profileId: string): Promise<LocalResult<DashboardSummary>> {
    const q = await this.recordService.query({ profileId });
    if (!q.ok) return q;

    const records = q.value;
    const countsByType: Partial<Record<HealthRecordType, number>> = {};
    for (const r of records) {
      countsByType[r.recordType] = (countsByType[r.recordType] ?? 0) + 1;
    }

    return success({
      profileId,
      totalRecords: records.length,
      latestRecordedAt: records[0]?.recordedAt ?? null,
      countsByType,
    });
  }
}

export class DummyChallengeService {
  public async getActivePlan() {
    return success(null);
  }
  public async createPlan() {
    return failure("NOT_FOUND", "서버 챌린지 준비 중");
  }
  public async listPlans() {
    return success([]);
  }
  public async getTasks() {
    return success([]);
  }
  public async completeTask() {
    return failure("NOT_FOUND", "준비 중");
  }
}

export class DummyFamilyHistoryService {
  public async listByProfile(): Promise<LocalResult<FamilyHistory[]>> {
    return success([]);
  }
  public async create() {
    return failure("NOT_FOUND", "가족력 서버 연동 준비 중");
  }
  public async update() {
    return failure("NOT_FOUND", "가족력 서버 연동 준비 중");
  }
  public async delete() {
    return failure("NOT_FOUND", "가족력 서버 연동 준비 중");
  }
}

export function createServerDomainRuntime(
  householdId: string,
  client: ServerApiClient = serverApiClient,
): LocalDomainRuntime {
  const profiles = new ServerProfileService(client, householdId);
  const healthRecords = new ServerHealthRecordService(client, householdId);
  const dashboard = new ServerDashboardService(healthRecords);
  const challenges = new DummyChallengeService();
  const familyHistories = new DummyFamilyHistoryService();

  return {
    profiles: profiles as unknown as LocalDomainRuntime["profiles"],
    healthRecords: healthRecords as unknown as LocalDomainRuntime["healthRecords"],
    dashboard: dashboard as unknown as LocalDomainRuntime["dashboard"],
    challenges: challenges as unknown as LocalDomainRuntime["challenges"],
    familyHistories: familyHistories as unknown as LocalDomainRuntime["familyHistories"],
    accessGrants: {
      listByProfile: async () => success([]),
      grant: async () => failure("NOT_FOUND", "서버 권한 지원"),
      revoke: async () => failure("NOT_FOUND", "서버 권한 지원"),
    } as unknown as LocalDomainRuntime["accessGrants"],
    profileMerges: {
      merge: async () => failure("NOT_FOUND", "미지원"),
      list: async () => success([]),
    } as unknown as LocalDomainRuntime["profileMerges"],
    backup: {
      exportAll: async () => new Blob([]),
      inspect: async () => ({}) as unknown as ReturnType<LocalDomainRuntime["backup"]["inspect"]>,
      importAll: async () => success({ profiles: 0, records: 0, documents: 0 }),
    } as unknown as LocalDomainRuntime["backup"],
    documents: undefined, // OPFS 폐지
    close: () => {},
  };
}
