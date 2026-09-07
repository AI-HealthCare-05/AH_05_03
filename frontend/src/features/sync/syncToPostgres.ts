import { PRIMARY_HOUSEHOLD_ID } from "../../app/localDomainContext";
import type { FamilyProfile, HealthRecordType } from "../../shared/local/domainContracts";
import type { ServerApiClient } from "../../shared/api/serverApiClient";
import type { LocalDomainRuntime } from "../../shared/local/localDomainRuntime";

export interface MigrationSyncResult {
  profilesCount: number;
  recordsCount: number;
  success: boolean;
}

/**
 * 동일 가구 내 display_name 중복 프로필을 감지하고,
 * 기록이 있는 진짜 프로필을 보존하며 기록이 없는 빈 중복 프로필은 softDelete로 정리한다.
 */
export async function deduplicateHouseholdProfiles(
  runtime: Pick<LocalDomainRuntime, "profiles" | "healthRecords">,
  profiles: FamilyProfile[],
): Promise<FamilyProfile[]> {
  const profilesByName = new Map<string, FamilyProfile[]>();
  for (const p of profiles) {
    const name = p.displayName.trim();
    const list = profilesByName.get(name) ?? [];
    list.push(p);
    profilesByName.set(name, list);
  }

  const deduplicated: FamilyProfile[] = [];

  for (const list of profilesByName.values()) {
    if (list.length === 1) {
      deduplicated.push(list[0]);
      continue;
    }

    // 중복 발견: 각 프로필의 건강 기록 건수 확인
    const withCounts = await Promise.all(
      list.map(async (p) => {
        try {
          const res = await runtime.healthRecords.query({ profileId: p.id, includeDeleted: false });
          const count = res.ok ? res.value.length : 0;
          return { profile: p, recordCount: count };
        } catch {
          return { profile: p, recordCount: 0 };
        }
      }),
    );

    // 정렬 우선순위:
    // 1. 건강 기록 건수 내림차순
    // 2. 정보 완성도 및 구체성 (배우자 > 본인/자녀 > 가족, 성별, 생년월일)
    // 3. 최신 일시 (updatedAt)
    // 4. 최신 row_version
    withCounts.sort((a, b) => {
      if (b.recordCount !== a.recordCount) return b.recordCount - a.recordCount;

      const getScore = (p: FamilyProfile) => {
        let score = 0;
        if (p.gender) score += 2;
        if (p.birthDate) score += 2;
        if (p.relationship === "배우자") score += 3;
        else if (p.relationship === "본인" || p.relationship === "자녀") score += 2;
        else if (p.relationship !== "가족") score += 1;
        return score;
      };

      const aScore = getScore(a.profile);
      const bScore = getScore(b.profile);
      if (bScore !== aScore) return bScore - aScore;

      const timeCompare = (b.profile.updatedAt || "").localeCompare(a.profile.updatedAt || "");
      if (timeCompare !== 0) return timeCompare;

      return (b.profile.version || 0) - (a.profile.version || 0);
    });

    const winner = withCounts[0].profile;
    deduplicated.push(winner);

    // 빈 중복 프로필(기록 0건)은 softDelete로 정리
    for (let i = 1; i < withCounts.length; i++) {
      const loser = withCounts[i];
      if (loser.recordCount > 0) {
        // 기록이 있는 프로필은 안전을 위해 보존
        deduplicated.push(loser.profile);
      } else {
        try {
          await runtime.profiles.deleteEmpty(loser.profile.id);
        } catch {
          // ignore
        }
      }
    }
  }

  return deduplicated;
}

/**
 * 로컬 IndexedDB의 프로필 및 건강 기록을 서버 PostgreSQL로 멱등하게 일괄 마이그레이션(동기화)한다.
 * 중복 이름 프로필이 서버에 이미 존재하면 새 UUID를 만들지 않고 기존 서버 프로필에 매핑한다.
 */
export async function migrateLocalDataToPostgres(
  runtime: LocalDomainRuntime,
  serverClient: ServerApiClient,
  householdId: string,
): Promise<MigrationSyncResult> {
  // 1. 서버에 이미 존재하는 활성 프로필 확인 (중복 생성 방지)
  const existingServerProfiles =
    typeof serverClient.listProfiles === "function"
      ? await serverClient.listProfiles(householdId, true).catch(() => [])
      : [];
  const serverByName = new Map<string, (typeof existingServerProfiles)[0]>();
  for (const sp of existingServerProfiles) {
    if (sp.status !== "deleted") {
      serverByName.set(sp.display_name.trim(), sp);
    }
  }

  // 2. 로컬 프로필 조회 (인자로 넘어온 householdId 및 로컬 기본 식별자 키들에서 수집)
  const candidateHouseholdIds = Array.from(
    new Set([householdId, PRIMARY_HOUSEHOLD_ID, "household-local-primary", "default-household"]),
  );

  const localProfileMap = new Map<string, FamilyProfile>();
  for (const candidateId of candidateHouseholdIds) {
    try {
      const res = await runtime.profiles.list(candidateId);
      if (res.ok && res.value.length > 0) {
        for (const p of res.value) {
          if (!localProfileMap.has(p.id)) {
            localProfileMap.set(p.id, p);
          }
        }
      }
    } catch {
      // ignore
    }
  }

  // 로컬 프로필들 중 동일한 이름이 있다면 하나로 통합 (중복 후보 정리)
  const localByName = new Map<string, FamilyProfile>();
  for (const p of localProfileMap.values()) {
    const name = p.displayName.trim();
    const existing = localByName.get(name);
    if (!existing) {
      localByName.set(name, p);
    } else {
      const score = (p.gender ? 2 : 0) + (p.birthDate ? 2 : 0) + (p.relationship !== "가족" ? 1 : 0);
      const existingScore =
        (existing.gender ? 2 : 0) + (existing.birthDate ? 2 : 0) + (existing.relationship !== "가족" ? 1 : 0);
      if (score > existingScore || (score === existingScore && p.version > existing.version)) {
        localByName.set(name, p);
      }
    }
  }

  // 로컬 프로필 ID -> 서버 프로필 ID 매핑
  const localToTargetProfileId = new Map<string, string>();
  const profilesToSync: Array<{
    id: string;
    household_id: string;
    display_name: string;
    relationship: string;
    birth_date: string | null;
    gender: "male" | "female" | null;
    status: "active" | "hidden" | "deleted";
    row_version: number;
  }> = [];

  for (const p of localByName.values()) {
    const name = p.displayName.trim();
    const existingServer = serverByName.get(name);

    if (existingServer) {
      // 이미 서버에 동일 이름의 프로필이 존재하는 경우: 새 프로필을 생성하지 않고 기존 서버 프로필에 매핑
      localToTargetProfileId.set(p.id, existingServer.id);
      for (const [origId, origP] of localProfileMap.entries()) {
        if (origP.displayName.trim() === name) {
          localToTargetProfileId.set(origId, existingServer.id);
        }
      }

      // 서버 프로필에 생년월일/성별 등이 비어있고 로컬에 있다면 보완
      if (typeof serverClient.updateProfile === "function") {
        const needsUpdate =
          (!existingServer.birth_date && p.birthDate) ||
          (!existingServer.gender && p.gender);
        if (needsUpdate) {
          await serverClient
            .updateProfile(existingServer.id, {
              birth_date: p.birthDate ?? existingServer.birth_date ?? null,
              gender: p.gender ?? existingServer.gender ?? null,
            })
            .catch(() => undefined);
        }
      }
    } else {
      // 서버에 없는 새로운 프로필인 경우에만 syncProfiles 목록에 포함
      localToTargetProfileId.set(p.id, p.id);
      for (const [origId, origP] of localProfileMap.entries()) {
        if (origP.displayName.trim() === name) {
          localToTargetProfileId.set(origId, p.id);
        }
      }

      profilesToSync.push({
        id: p.id,
        household_id: householdId,
        display_name: p.displayName,
        relationship: p.relationship,
        birth_date: p.birthDate,
        gender: p.gender ?? null,
        status: p.status === "hidden" ? "hidden" : "active",
        row_version: p.version,
      });
    }
  }

  if (profilesToSync.length > 0) {
    await serverClient.syncProfiles(profilesToSync);
  }

  // 3. 로컬 건강 기록 조회 및 전송
  let totalRecords = 0;
  const syncedRecordIds = new Set<string>();
  const recordsToSync: Array<{
    id: string;
    profile_id: string;
    record_type: HealthRecordType;
    recorded_at: string;
    source: string;
    payload: Record<string, unknown>;
    note: null;
    status: string;
    row_version: number;
  }> = [];

  for (const p of localProfileMap.values()) {
    const targetProfileId = localToTargetProfileId.get(p.id) ?? p.id;
    const recordsResult = await runtime.healthRecords.query({
      profileId: p.id,
      includeDeleted: true,
    });
    if (!recordsResult.ok) continue;

    for (const r of recordsResult.value) {
      if (syncedRecordIds.has(r.id)) continue;
      syncedRecordIds.add(r.id);

      recordsToSync.push({
        id: r.id,
        profile_id: targetProfileId,
        record_type: r.recordType,
        recorded_at: r.recordedAt,
        source: r.source,
        payload: r.payload as Record<string, unknown>,
        note: null,
        status: r.deletedAt ? "deleted" : "active",
        row_version: r.version,
      });
    }
  }

  if (recordsToSync.length > 0) {
    await serverClient.syncHealthRecords(recordsToSync);
    totalRecords = recordsToSync.length;
  }

  return {
    profilesCount: profilesToSync.length,
    recordsCount: totalRecords,
    success: true,
  };
}
