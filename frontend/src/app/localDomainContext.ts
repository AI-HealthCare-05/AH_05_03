import { createContext, useContext } from "react";

import type { FamilyProfile, Gender, HealthRecord, HealthRecordType } from "../shared/local/domainContracts";
import type { LocalDomainRuntime } from "../shared/local/localDomainRuntime";

export const PRIMARY_HOUSEHOLD_ID = "ieobom-primary-household";

export interface CreateProfileInput {
  displayName: string;
  relationship: string;
  birthDate?: `${number}-${number}-${number}`;
  gender?: Gender | null;
  accountEmail?: string | null;
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
  /**
   * payload 에 **덧쓸** 칸들. 통째로 바꾸는 것이 아니다.
   *
   * 예전에는 이 칸이 없고 `LocalDomainProvider` 가 `payload: { note }` 를 보냈다 —
   * 서버는 `record.payload = req.payload` 로 **통째로 교체**하므로, 메모만 고쳐도
   * 혈압·혈당 수치가 지워졌다. 화면에는 "수정했습니다" 만 뜨고 값이 사라진다.
   * 지금은 기존 payload 를 읽어 병합한다.
   */
  payload?: Record<string, unknown>;
}

export interface LocalDomainContextValue {
  runtime?: LocalDomainRuntime;
  householdId?: string;
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
