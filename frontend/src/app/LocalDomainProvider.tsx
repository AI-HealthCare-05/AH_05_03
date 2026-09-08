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

          // 과거 브라우저(IndexedDB)에 저장된 데이터가 있다면 서버로 1회 안전 마이그레이션
          if (typeof window !== "undefined" && window.indexedDB) {
            try {
              const legacyRuntime = await createLocalDomainRuntime("ieobom-local").catch(() => undefined);
              if (legacyRuntime) {
                const localList = await legacyRuntime.profiles.list(PRIMARY_HOUSEHOLD_ID);
                if (localList.ok && localList.value.length > 0) {
                  await migrateLocalDataToPostgres(legacyRuntime, serverApiClient, activeHouseholdId).catch(() => undefined);
                }
                legacyRuntime.close();
              }
            } catch {
              // 마이그레이션 오류는 무시하고 계속 진행
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
                    const email = m.masked_email.toLowerCase();

                    let displayName: string;
                    let relationship: string;
                    let birthDate: string | null = null;
                    let gender: "male" | "female" | null = null;

                    if (email.includes("fabxoe.kor") || isMaster) {
                      displayName = "오성민";
                      relationship = isMe ? "본인" : "가족";
                      birthDate = "1988-10-28";
                      gender = "male";
                    } else if (email.includes("fabxoe.se")) {
                      displayName = "오민재";
                      relationship = isMe ? "본인" : "자녀";
                      birthDate = "2010-05-10";
                      gender = "male";
                    } else {
                      displayName = isMaster ? "마스터" : (isMe ? "본인" : email.split("@")[0] || "가족 구성원");
                      relationship = isMe ? "본인" : "가족";
                    }

                    return {
                      id: crypto.randomUUID(),
                      household_id: activeHouseholdId,
                      display_name: displayName,
                      relationship,
                      birth_date: birthDate,
                      gender,
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
      const result = await runtime.healthRecords.update(recordId, {
        recordType: input.recordType,
        recordedAt: input.recordedAt,
        payload: { note: input.note.trim() },
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
      runtime,
      profiles,
      hiddenProfiles,
      loading,
      error,
      refreshProfiles,
      createProfile,
      updateProfile,
      hideProfile,
      restoreProfile,
      deleteEmptyProfile,
      createHealthRecord,
      updateHealthRecord,
      deleteHealthRecord,
      restoreHealthRecord,
      purgeHealthRecord,
    }),
    [
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
