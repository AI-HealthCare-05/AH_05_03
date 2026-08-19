import { createContext, useContext } from "react";

import type { FamilyProfile, HealthRecord, HealthRecordType } from "../shared/local/domainContracts";
import type { LocalDomainRuntime } from "../shared/local/localDomainRuntime";

export const PRIMARY_HOUSEHOLD_ID = "ieobom-primary-household";

export interface CreateProfileInput {
  displayName: string;
  relationship: string;
  birthDate?: `${number}-${number}-${number}`;
}

export interface CreateHealthRecordInput {
  profileId: string;
  recordType: HealthRecordType;
  recordedAt: string;
  note: string;
}

export interface LocalDomainContextValue {
  runtime?: LocalDomainRuntime;
  profiles: FamilyProfile[];
  loading: boolean;
  error?: string;
  refreshProfiles(): Promise<void>;
  createProfile(input: CreateProfileInput): Promise<FamilyProfile>;
  createHealthRecord(input: CreateHealthRecordInput): Promise<HealthRecord>;
}

export const LocalDomainContext = createContext<LocalDomainContextValue | undefined>(undefined);

export function useLocalDomain(): LocalDomainContextValue {
  const value = useContext(LocalDomainContext);
  if (!value) throw new Error("useLocalDomain은 LocalDomainProvider 안에서 사용해야 합니다.");
  return value;
}
