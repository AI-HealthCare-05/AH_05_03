import {
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  createLocalDomainRuntime,
  type LocalDomainRuntime,
} from "../shared/local/localDomainRuntime";
import { createServerDomainRuntime } from "../shared/api/serverDomainRuntime";
import { serverApiClient } from "../shared/api/serverApiClient";
import {
  deduplicateHouseholdProfiles,
  migrateLocalDataToPostgres,
} from "../features/sync/syncToPostgres";
import { AuthContext } from "./authContext";
import {
  type CreateHealthRecordInput,
  type CreateProfileInput,
  LocalDomainContext,
  type LocalDomainContextValue,
  PRIMARY_HOUSEHOLD_ID,
  type UpdateProfileInput,
  type UpdateHealthRecordInput,
} from "./localDomainContext";
import type { FamilyProfile } from "../shared/local/domainContracts";

/**
 * 옛 IndexedDB(`ieobom-local`) → 서버 마이그레이션을 가구별로 한 번만 돌게 하는 표시.
 *
 * 저장 자체가 막힌 환경(사파리 프라이빗 모드 등)에서는 읽기·쓰기가 모두 던진다.
 * 그때는 "안 끝났다" 로 읽혀 예전처럼 매번 돌 뿐이라 기능은 그대로다 — 표시를
 * 남기지 못한다고 마이그레이션을 막지는 않는다.
 */
const LEGACY_MIGRATION_KEY = "ieobom:legacy-migrated";

function legacyMigrationDone(householdId: string): boolean {
  try {
    return window.localStorage.getItem(`${LEGACY_MIGRATION_KEY}:${householdId}`) === "1";
  } catch {
    return false;
  }
}

function markLegacyMigrationDone(householdId: string): void {
  try {
    window.localStorage.setItem(`${LEGACY_MIGRATION_KEY}:${householdId}`, "1");
  } catch {
    // 저장이 막힌 환경. 다음 로드에서 한 번 더 도는 것 말고는 달라지지 않는다.
  }
}

export function LocalDomainProvider({
  children,
  databaseName,
}: PropsWithChildren<{ databaseName?: string }>) {
  const [runtime, setRuntime] = useState<LocalDomainRuntime>();
  const [profiles, setProfiles] = useState<FamilyProfile[]>([]);
  const [hiddenProfiles, setHiddenProfiles] = useState<FamilyProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [householdId, setHouseholdId] = useState<string>(PRIMARY_HOUSEHOLD_ID);

  const auth = useContext(AuthContext);
  const authStatus = auth?.status;
  const authAccountId = auth?.accountId;

  useEffect(() => {
    let disposed = false;
    let activeRuntime: LocalDomainRuntime | undefined;

    async function init() {
      // 인증 상태를 확인 중일 때는 세션이 복원될 때까지 대기
      if (authStatus === "checking") {
        setLoading(true);
        return;
      }

      try {
        setLoading(true);
        setError(undefined);

        // 단위 테스트에서 격리된 indexedDB 이름을 명시한 경우 로컬 런타임 사용
        if (databaseName && databaseName !== "ieobom-local") {
          activeRuntime = await createLocalDomainRuntime(databaseName);
          if (disposed) {
            activeRuntime.close();
            return;
          }
          const [result, hiddenResult] = await Promise.all([
            activeRuntime.profiles.list(PRIMARY_HOUSEHOLD_ID),
            activeRuntime.profiles.listHidden(PRIMARY_HOUSEHOLD_ID),
          ]);
          if (disposed) return;
          if (!result.ok) throw new Error(result.error.message);
          if (!hiddenResult.ok) throw new Error(hiddenResult.error.message);
          setRuntime(activeRuntime);
          setProfiles(result.value);
          setHiddenProfiles(hiddenResult.value);
          setError(undefined);
          return;
        }

        // 실제 앱 모드: 로그인 상태(signed-in)일 때만 서버(PostgreSQL) 우선
        let activeHouseholdId: string | undefined;
        if (authStatus === "signed-in") {
          try {
            const households = await serverApiClient.listHouseholds();
            const activeHousehold = households?.find((h) => h.status === "active") ?? households?.[0];
            if (activeHousehold) {
              activeHouseholdId = activeHousehold.id;
            } else {
              const created = await serverApiClient.createHousehold();
              activeHouseholdId = created.id;
            }
          } catch {
            // 비로그인 상태이거나 서버 연결 불가/E2E 모드
            activeHouseholdId = undefined;
          }
        }
        if (disposed) return;

        if (activeHouseholdId) {
          setHouseholdId(activeHouseholdId);

          // 과거 브라우저(IndexedDB)에 저장된 데이터가 있다면 서버로 1회 안전 마이그레이션.
          //
          // **"1회" 가 아니었다.** 표시를 남기지 않아 로그인·새로고침마다 다시 돌았고,
          // 그때마다 `listProfiles` → `syncProfiles` → 프로필 재조회로 왕복 셋이
          // 직렬로 더 붙었다(실측 ~900ms, 첫 화면이 뜨는 시각이 그만큼 밀린다).
          // 옛 IndexedDB 는 지금 버전이 쓰지 않으므로 한 번 옮기고 나면 더 생기지
          // 않는다 — 가구별로 끝났음을 남기고 다음부터는 건너뛴다.
          if (typeof window !== "undefined" && window.indexedDB && !legacyMigrationDone(activeHouseholdId)) {
            try {
              const legacyRuntime = await createLocalDomainRuntime("ieobom-local").catch(() => undefined);
              if (legacyRuntime) {
                const localList = await legacyRuntime.profiles.list(PRIMARY_HOUSEHOLD_ID);
                if (localList.ok && localList.value.length > 0) {
                  await migrateLocalDataToPostgres(legacyRuntime, serverApiClient, activeHouseholdId).catch(() => undefined);
                }
                legacyRuntime.close();
              }
              // 옮길 것이 없었어도 표시를 남긴다 — 없다는 사실을 확인하는 데도
              // IndexedDB 를 열고 목록을 읽는 값이 든다.
              markLegacyMigrationDone(activeHouseholdId);
            } catch {
              // 마이그레이션 오류는 무시하고 계속 진행. 표시를 남기지 않으므로
              // 다음 기회에 다시 시도한다.
            }
          }
          if (disposed) return;

          // 서버 런타임 생성
          activeRuntime = createServerDomainRuntime(activeHouseholdId, serverApiClient);
          setRuntime(activeRuntime);

          const [result, hiddenResult] = await Promise.all([
            activeRuntime.profiles.list(activeHouseholdId),
            activeRuntime.profiles.listHidden(activeHouseholdId),
          ]);
          if (disposed) return;
          if (result.ok) {
            let currentProfiles = result.value;

            // 만약 서버 프로필이 비어있다면, 가구 구성원 정보(household_memberships)를 바탕으로 프로필 자동 복원/생성
            if (currentProfiles.length === 0) {
              try {
                const memberships = await serverApiClient.listHouseholdMemberships(activeHouseholdId);
                const activeMembers = memberships.filter((m) => m.status === "active");
                if (activeMembers.length > 0) {
                  const profilesToCreate = activeMembers.map((m) => {
                    const isMe = m.account_id === authAccountId;
                    const isMaster = m.is_master ?? false;
                    const displayName = isMaster ? "가족 대표" : (isMe ? "본인" : "가족 구성원");
                    const relationship = isMe ? "본인" : "가족";

                    return {
                      id: crypto.randomUUID(),
                      household_id: activeHouseholdId,
                      display_name: displayName,
                      relationship,
                      birth_date: null,
                      gender: null,
                      account_email: m.masked_email,
                      status: "active" as const,
                      row_version: 1,
                    };
                  });

                  if (profilesToCreate.length > 0) {
                    await serverApiClient.syncProfiles(profilesToCreate);
                    const refreshed = await activeRuntime.profiles.list(activeHouseholdId);
                    if (refreshed.ok && refreshed.value.length > 0) {
                      currentProfiles = refreshed.value;
                    }
                  }
                }
              } catch {
                // 구성원 연동 실패 시 빈 배열 유지
              }
            }

            // 동일 가구 내 display_name 중복 프로필 감지 및 자동 정리 (기록 보유 프로필 우선 보존, 빈 중복 프로필 softDelete)
            currentProfiles = await deduplicateHouseholdProfiles(activeRuntime, currentProfiles);
            if (disposed) return;

            setProfiles(currentProfiles);
            if (hiddenResult.ok) setHiddenProfiles(hiddenResult.value);
            setError(undefined);
          } else {
            // 가정이 유효하지 않거나 멤버십이 없는 경우 새 가정을 생성하거나 로컬 fallback
            try {
              const created = await serverApiClient.createHousehold();
              if (disposed) return;
              setHouseholdId(created.id);
              activeRuntime = createServerDomainRuntime(created.id, serverApiClient);
              setRuntime(activeRuntime);
              setProfiles([]);
              setError(undefined);
            } catch {
              setHouseholdId(PRIMARY_HOUSEHOLD_ID);
              activeRuntime = await createLocalDomainRuntime("ieobom-local");
              if (disposed) {
                activeRuntime.close();
                return;
              }
              setRuntime(activeRuntime);
              setProfiles([]);
              setError(undefined);
            }
          }
          if (hiddenResult.ok) setHiddenProfiles(hiddenResult.value);
        } else {
          // 서버 연결 없음 / 비로그인 / E2E 테스트 모드: 로컬 런타임 fallback
          setHouseholdId(PRIMARY_HOUSEHOLD_ID);
          activeRuntime = await createLocalDomainRuntime(databaseName || "ieobom-local");
          if (disposed) {
            activeRuntime.close();
            return;
          }
          setRuntime(activeRuntime);

          const [result, hiddenResult] = await Promise.all([
            activeRuntime.profiles.list(PRIMARY_HOUSEHOLD_ID),
            activeRuntime.profiles.listHidden(PRIMARY_HOUSEHOLD_ID),
          ]);
          if (disposed) return;
          if (result.ok) setProfiles(result.value);
          if (hiddenResult.ok) setHiddenProfiles(hiddenResult.value);
          setError(undefined);
        }
      } catch (caught: unknown) {
        if (!disposed) {
          setError(errorMessage(caught, "저장소를 준비하지 못했습니다."));
        }
      } finally {
        if (!disposed) setLoading(false);
      }
    }

    void init();

    return () => {
      disposed = true;
      activeRuntime?.close();
    };
  }, [databaseName, authStatus, authAccountId]);

  const refreshProfiles = useCallback(async () => {
    if (!runtime) return;
    const [result, hiddenResult] = await Promise.all([
      runtime.profiles.list(householdId),
      runtime.profiles.listHidden(householdId),
    ]);
    if (!result.ok) throw new Error(result.error.message);
    if (!hiddenResult.ok) throw new Error(hiddenResult.error.message);
    const cleaned = await deduplicateHouseholdProfiles(runtime, result.value);
    setProfiles(cleaned);
    setHiddenProfiles(hiddenResult.value);
  }, [householdId, runtime]);

  const createProfile = useCallback(
    async (input: CreateProfileInput) => {
      if (!runtime) throw new Error("저장소를 준비하는 중입니다.");
      const result = await runtime.profiles.create({
        householdId,
        ...input,
      });
      if (!result.ok) throw new Error(result.error.message);
      await refreshProfiles();
      return result.value;
    },
    [householdId, refreshProfiles, runtime],
  );

  const createHealthRecord = useCallback(
    async (input: CreateHealthRecordInput) => {
      if (!runtime) throw new Error("저장소를 준비하는 중입니다.");
      const result = await runtime.healthRecords.create({
        householdId,
        profileId: input.profileId,
        recordType: input.recordType,
        recordedAt: input.recordedAt,
        source: "manual",
        payload: { note: input.note.trim() },
      });
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    },
    [householdId, runtime],
  );

  const updateProfile = useCallback(
    async (profileId: string, input: UpdateProfileInput) => {
      if (!runtime) throw new Error("저장소를 준비하는 중입니다.");
      const result = await runtime.profiles.update(profileId, input);
      if (!result.ok) throw new Error(result.error.message);
      await refreshProfiles();
      return result.value;
    },
    [refreshProfiles, runtime],
  );

  const updateHealthRecord = useCallback(
    async (recordId: string, input: UpdateHealthRecordInput) => {
      if (!runtime) throw new Error("저장소를 준비하는 중입니다.");
      // **payload 를 통째로 보내면 안 된다.** 서버는 `record.payload = req.payload` 로
      // 교체하므로, 예전처럼 `{ note }` 만 보내면 혈압·혈당 수치가 함께 지워졌다.
      // 기존 payload 를 읽어 덧쓴다 — 한 번의 추가 조회로 값 손실을 막는다.
      const current = await runtime.healthRecords.get(recordId);
      if (!current.ok) throw new Error(current.error.message);
      const merged = {
        ...(current.value.payload as Record<string, unknown>),
        ...(input.payload ?? {}),
        note: input.note.trim(),
      };
      const result = await runtime.healthRecords.update(recordId, {
        recordType: input.recordType,
        recordedAt: input.recordedAt,
        payload: merged,
        expectedVersion: input.expectedVersion,
      });
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    },
    [runtime],
  );

  const deleteHealthRecord = useCallback(
    async (recordId: string, expectedVersion: number) => {
      if (!runtime) throw new Error("저장소를 준비하는 중입니다.");
      const result = await runtime.healthRecords.softDelete(recordId, expectedVersion);
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    },
    [runtime],
  );

  const restoreHealthRecord = useCallback(
    async (recordId: string, expectedVersion: number) => {
      if (!runtime) throw new Error("저장소를 준비하는 중입니다.");
      const result = await runtime.healthRecords.restore(recordId, expectedVersion);
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    },
    [runtime],
  );

  const purgeHealthRecord = useCallback(
    async (recordId: string, expectedVersion: number) => {
      if (!runtime) throw new Error("저장소를 준비하는 중입니다.");
      const result = await runtime.healthRecords.purge(recordId, expectedVersion);
      if (!result.ok) throw new Error(result.error.message);
    },
    [runtime],
  );

  const hideProfile = useCallback(
    async (profileId: string, expectedVersion: number) => {
      if (!runtime) throw new Error("저장소를 준비하는 중입니다.");
      const result = await runtime.profiles.hide(profileId, expectedVersion);
      if (!result.ok) throw new Error(result.error.message);
      await refreshProfiles();
      return result.value;
    },
    [refreshProfiles, runtime],
  );

  const deleteEmptyProfile = useCallback(
    async (profileId: string) => {
      if (!runtime) throw new Error("저장소를 준비하는 중입니다.");
      const result = await runtime.profiles.deleteEmpty(profileId);
      if (!result.ok) throw new Error(result.error.message);
      await refreshProfiles();
    },
    [refreshProfiles, runtime],
  );

  const restoreProfile = useCallback(
    async (profileId: string, expectedVersion: number) => {
      if (!runtime) throw new Error("저장소를 준비하는 중입니다.");
      const result = await runtime.profiles.restore(profileId, expectedVersion);
      if (!result.ok) throw new Error(result.error.message);
      await refreshProfiles();
      return result.value;
    },
    [refreshProfiles, runtime],
  );

  const value = useMemo<LocalDomainContextValue>(
    () => ({
      householdId,
      runtime,
      profiles,
      hiddenProfiles,
      loading,
      error,
      refreshProfiles,
      hideProfile,
      updateProfile,
      createProfile,
      restoreProfile,
      deleteEmptyProfile,
      createHealthRecord,
      updateHealthRecord,
      deleteHealthRecord,
      restoreHealthRecord,
      purgeHealthRecord,
    }),
    [
      householdId,
      createHealthRecord,
      createProfile,
      deleteEmptyProfile,
      deleteHealthRecord,
      error,
      hideProfile,
      hiddenProfiles,
      loading,
      profiles,
      refreshProfiles,
      runtime,
      restoreProfile,
      restoreHealthRecord,
      purgeHealthRecord,
      updateProfile,
      updateHealthRecord,
    ],
  );

  return <LocalDomainContext.Provider value={value}>{children}</LocalDomainContext.Provider>;
}

function errorMessage(caught: unknown, fallback: string): string {
  return caught instanceof Error ? caught.message : fallback;
}
