import type { ServerApiClient } from "../../shared/api/serverApiClient";
import type { LocalDomainRuntime } from "../../shared/local/localDomainRuntime";

export interface MigrationSyncResult {
  profilesCount: number;
  recordsCount: number;
  success: boolean;
}

/**
 * 로컬 IndexedDB의 프로필 및 건강 기록을 서버 PostgreSQL로 멱등하게 일괄 마이그레이션(동기화)한다.
 * ADR-011: IndexedDB 로컬 정본에서 PostgreSQL 서버 정본으로의 점진적 전환 4단계.
 */
export async function migrateLocalDataToPostgres(
  runtime: LocalDomainRuntime,
  serverClient: ServerApiClient,
  householdId: string,
): Promise<MigrationSyncResult> {
  // 1. 로컬 프로필 조회
  const profilesResult = await runtime.profiles.list(householdId);
  if (!profilesResult.ok) {
    throw new Error(`로컬 프로필 조회 실패: ${profilesResult.error.message}`);
  }

  const profilesToSync = profilesResult.value.map((p) => ({
    id: p.id,
    household_id: householdId,
    display_name: p.displayName,
    relationship: p.relationship,
    birth_date: p.birthDate,
    gender: p.gender ?? null,
    status: p.status,
    row_version: p.version,
  }));

  if (profilesToSync.length > 0) {
    await serverClient.syncProfiles(profilesToSync);
  }

  // 2. 로컬 건강 기록 조회
  let totalRecords = 0;
  for (const p of profilesResult.value) {
    const recordsResult = await runtime.healthRecords.query({
      profileId: p.id,
      includeDeleted: true,
    });
    if (!recordsResult.ok) continue;

    const recordsToSync = recordsResult.value.map((r) => ({
      id: r.id,
      profile_id: r.profileId,
      record_type: r.recordType,
      recorded_at: r.recordedAt,
      source: r.source,
      payload: r.payload as Record<string, unknown>,
      note: null,
      status: r.deletedAt ? "deleted" : "active",
      row_version: r.version,
    }));

    if (recordsToSync.length > 0) {
      await serverClient.syncHealthRecords(recordsToSync);
      totalRecords += recordsToSync.length;
    }
  }

  return {
    profilesCount: profilesToSync.length,
    recordsCount: totalRecords,
    success: true,
  };
}
