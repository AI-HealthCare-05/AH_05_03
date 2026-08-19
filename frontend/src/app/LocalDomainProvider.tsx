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
} from "./localDomainContext";
import type { FamilyProfile } from "../shared/local/domainContracts";

export function LocalDomainProvider({
  children,
  databaseName = "ieobom-local",
}: PropsWithChildren<{ databaseName?: string }>) {
  const [runtime, setRuntime] = useState<LocalDomainRuntime>();
  const [profiles, setProfiles] = useState<FamilyProfile[]>([]);
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
        const result = await createdRuntime.profiles.list(PRIMARY_HOUSEHOLD_ID);
        if (disposed) return;
        if (!result.ok) throw new Error(result.error.message);
        setRuntime(createdRuntime);
        setProfiles(result.value);
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
    const result = await runtime.profiles.list(PRIMARY_HOUSEHOLD_ID);
    if (!result.ok) throw new Error(result.error.message);
    setProfiles(result.value);
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

  const value = useMemo<LocalDomainContextValue>(
    () => ({
      runtime,
      profiles,
      loading,
      error,
      refreshProfiles,
      createProfile,
      createHealthRecord,
    }),
    [createHealthRecord, createProfile, error, loading, profiles, refreshProfiles, runtime],
  );

  return <LocalDomainContext.Provider value={value}>{children}</LocalDomainContext.Provider>;
}

function errorMessage(caught: unknown, fallback: string): string {
  return caught instanceof Error ? caught.message : fallback;
}
