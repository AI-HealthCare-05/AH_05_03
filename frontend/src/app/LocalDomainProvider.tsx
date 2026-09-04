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
  databaseName = "ieobom-local",
}: PropsWithChildren<{ databaseName?: string }>) {
  const [runtime, setRuntime] = useState<LocalDomainRuntime>();
  const [profiles, setProfiles] = useState<FamilyProfile[]>([]);
  const [hiddenProfiles, setHiddenProfiles] = useState<FamilyProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let disposed = false;
    let activeRuntime: LocalDomainRuntime | undefined;

    void createLocalDomainRuntime(databaseName)
      .then(async (createdRuntime) => {
        activeRuntime = createdRuntime;
        if (disposed) {
          createdRuntime.close();
          return;
        }
        const [result, hiddenResult] = await Promise.all([
          createdRuntime.profiles.list(PRIMARY_HOUSEHOLD_ID),
          createdRuntime.profiles.listHidden(PRIMARY_HOUSEHOLD_ID),
        ]);
        if (disposed) return;
        if (!result.ok) throw new Error(result.error.message);
        if (!hiddenResult.ok) throw new Error(hiddenResult.error.message);
        setRuntime(createdRuntime);
        setProfiles(result.value);
        setHiddenProfiles(hiddenResult.value);
        setError(undefined);
      })
      .catch((caught: unknown) => {
        if (!disposed) {
          setError(errorMessage(caught, "브라우저 로컬 저장소를 준비하지 못했습니다."));
        }
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });

    return () => {
      disposed = true;
      activeRuntime?.close();
    };
  }, [databaseName]);

  const refreshProfiles = useCallback(async () => {
    if (!runtime) return;
    const [result, hiddenResult] = await Promise.all([
      runtime.profiles.list(PRIMARY_HOUSEHOLD_ID),
      runtime.profiles.listHidden(PRIMARY_HOUSEHOLD_ID),
    ]);
    if (!result.ok) throw new Error(result.error.message);
    if (!hiddenResult.ok) throw new Error(hiddenResult.error.message);
    setProfiles(result.value);
    setHiddenProfiles(hiddenResult.value);
  }, [runtime]);

  const createProfile = useCallback(
    async (input: CreateProfileInput) => {
      if (!runtime) throw new Error("로컬 저장소를 준비하는 중입니다.");
      const result = await runtime.profiles.create({
        householdId: PRIMARY_HOUSEHOLD_ID,
        ...input,
      });
      if (!result.ok) throw new Error(result.error.message);
      await refreshProfiles();
      return result.value;
    },
    [refreshProfiles, runtime],
  );

  const createHealthRecord = useCallback(
    async (input: CreateHealthRecordInput) => {
      if (!runtime) throw new Error("로컬 저장소를 준비하는 중입니다.");
      const result = await runtime.healthRecords.create({
        householdId: PRIMARY_HOUSEHOLD_ID,
        profileId: input.profileId,
        recordType: input.recordType,
        recordedAt: input.recordedAt,
        source: "manual",
        payload: { note: input.note.trim() },
      });
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    },
    [runtime],
  );

  const updateProfile = useCallback(
    async (profileId: string, input: UpdateProfileInput) => {
      if (!runtime) throw new Error("로컬 저장소를 준비하는 중입니다.");
      const result = await runtime.profiles.update(profileId, input);
      if (!result.ok) throw new Error(result.error.message);
      await refreshProfiles();
      return result.value;
    },
    [refreshProfiles, runtime],
  );

  const updateHealthRecord = useCallback(
    async (recordId: string, input: UpdateHealthRecordInput) => {
      if (!runtime) throw new Error("로컬 저장소를 준비하는 중입니다.");
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
      if (!runtime) throw new Error("로컬 저장소를 준비하는 중입니다.");
      const result = await runtime.healthRecords.softDelete(recordId, expectedVersion);
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    },
    [runtime],
  );

  const restoreHealthRecord = useCallback(
    async (recordId: string, expectedVersion: number) => {
      if (!runtime) throw new Error("로컬 저장소를 준비하는 중입니다.");
      const result = await runtime.healthRecords.restore(recordId, expectedVersion);
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    },
    [runtime],
  );

  const purgeHealthRecord = useCallback(
    async (recordId: string, expectedVersion: number) => {
      if (!runtime) throw new Error("로컬 저장소를 준비하는 중입니다.");
      const result = await runtime.healthRecords.purge(recordId, expectedVersion);
      if (!result.ok) throw new Error(result.error.message);
    },
    [runtime],
  );

  const hideProfile = useCallback(
    async (profileId: string, expectedVersion: number) => {
      if (!runtime) throw new Error("로컬 저장소를 준비하는 중입니다.");
      const result = await runtime.profiles.hide(profileId, expectedVersion);
      if (!result.ok) throw new Error(result.error.message);
      await refreshProfiles();
      return result.value;
    },
    [refreshProfiles, runtime],
  );

  const deleteEmptyProfile = useCallback(
    async (profileId: string) => {
      if (!runtime) throw new Error("로컬 저장소를 준비하는 중입니다.");
      const result = await runtime.profiles.deleteEmpty(profileId);
      if (!result.ok) throw new Error(result.error.message);
      await refreshProfiles();
    },
    [refreshProfiles, runtime],
  );

  const restoreProfile = useCallback(
    async (profileId: string, expectedVersion: number) => {
      if (!runtime) throw new Error("로컬 저장소를 준비하는 중입니다.");
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
