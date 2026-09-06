import {
  type PropsWithChildren,
  useCallback,
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
import { migrateLocalDataToPostgres } from "../features/sync/syncToPostgres";
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

  useEffect(() => {
    let disposed = false;
    let activeRuntime: LocalDomainRuntime | undefined;

    async function init() {
      try {
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

        // 실제 앱 모드: 서버(PostgreSQL) 우선
        let activeHouseholdId = PRIMARY_HOUSEHOLD_ID;
        try {
          const households = await serverApiClient.listHouseholds();
          if (households.length > 0) {
            activeHouseholdId = households[0].id;
          } else {
            const created = await serverApiClient.createHousehold();
            activeHouseholdId = created.id;
          }
        } catch {
          // 비로그인 상태일 때는 기본 가정을 유지
        }
        if (disposed) return;
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
        if (result.ok) setProfiles(result.value);
        if (hiddenResult.ok) setHiddenProfiles(hiddenResult.value);
        setError(undefined);
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
  }, [databaseName]);

  const refreshProfiles = useCallback(async () => {
    if (!runtime) return;
    const [result, hiddenResult] = await Promise.all([
      runtime.profiles.list(householdId),
      runtime.profiles.listHidden(householdId),
    ]);
    if (!result.ok) throw new Error(result.error.message);
    if (!hiddenResult.ok) throw new Error(hiddenResult.error.message);
    setProfiles(result.value);
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
