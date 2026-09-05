import { createContext, useContext } from "react";

import type { FamilyProfile, Gender, HealthRecord, HealthRecordType } from "../shared/local/domainContracts";
import type { LocalDomainRuntime } from "../shared/local/localDomainRuntime";

export const PRIMARY_HOUSEHOLD_ID = "ieobom-primary-household";

export interface CreateProfileInput {
  displayName: string;
  relationship: string;
  birthDate?: `${number}-${number}-${number}`;
  gender?: Gender | null;
}

export interface UpdateProfileInput extends CreateProfileInput {
  expectedVersion: number;
}

export interface CreateHealthRecordInput {
  profileId: string;
  recordType: HealthRecordType;
  recordedAt: string;
  note: string;
}

export interface UpdateHealthRecordInput {
  recordType: HealthRecordType;
  recordedAt: string;
  note: string;
  expectedVersion: number;
}

export interface LocalDomainContextValue {
  runtime?: LocalDomainRuntime;
  profiles: FamilyProfile[];
  hiddenProfiles: FamilyProfile[];
  loading: boolean;
  error?: string;
  refreshProfiles(): Promise<void>;
  createProfile(input: CreateProfileInput): Promise<FamilyProfile>;
  updateProfile(profileId: string, input: UpdateProfileInput): Promise<FamilyProfile>;
  hideProfile(profileId: string, expectedVersion: number): Promise<FamilyProfile>;
  restoreProfile(profileId: string, expectedVersion: number): Promise<FamilyProfile>;
  deleteEmptyProfile(profileId: string): Promise<void>;
  createHealthRecord(input: CreateHealthRecordInput): Promise<HealthRecord>;
  updateHealthRecord(recordId: string, input: UpdateHealthRecordInput): Promise<HealthRecord>;
  deleteHealthRecord(recordId: string, expectedVersion: number): Promise<HealthRecord>;
  restoreHealthRecord(recordId: string, expectedVersion: number): Promise<HealthRecord>;
  /** 되돌릴 수 없는 삭제. 이미 삭제된 기록만 받는다. */
  purgeHealthRecord(recordId: string, expectedVersion: number): Promise<void>;
}

export const LocalDomainContext = createContext<LocalDomainContextValue | undefined>(undefined);

export function useLocalDomain(): LocalDomainContextValue {
  const value = useContext(LocalDomainContext);
  if (!value) throw new Error("useLocalDomain은 LocalDomainProvider 안에서 사용해야 합니다.");
  return value;
}
