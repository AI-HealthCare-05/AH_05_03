export type ISODate = `${number}-${number}-${number}`;
export type ISODateTime = string;

export type LocalErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "VERSION_CONFLICT"
  | "ENCRYPTION_FAILED"
  | "DECRYPTION_FAILED"
  | "VAULT_LOCKED"
  | "DUPLICATE_RECORD"
  | "PROFILE_MERGE_CONFLICT"
  | "PROFILE_MERGE_NOT_SAFE"
  | "ROLLBACK_REQUIRED";

export type LocalResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: LocalErrorCode; message: string; retryable: boolean } };

export interface FamilyProfile {
  id: string;
  householdId: string;
  displayName: string;
  relationship: string;
  birthDate: ISODate | null;
  opaqueServerRef: string | null;
  serverRefState: "none" | "pending" | "active" | "retired";
  status: "active" | "hidden" | "merged";
  mergedIntoProfileId: string | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  version: number;
}

export interface FamilyHistory {
  id: string;
  householdId: string;
  profileId: string;
  relativeRelationship: string;
  conditionName: string;
  onsetAge: number | null;
  note: string | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  version: number;
}

export type ShareableRecordType = "health-record" | "family-history" | "model-result";

export interface LocalAccessGrant {
  id: string;
  householdId: string;
  profileId: string;
  granteeAccountId: string;
  allowedRecordTypes: ShareableRecordType[];
  status: "active" | "revoked";
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  revokedAt: ISODateTime | null;
  version: number;
}

export interface ProfileMergeOperation {
  id: string;
  householdId: string;
  sourceProfileId: string;
  targetProfileId: string;
  restorePointId: string;
  status: "committed" | "reverted";
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  revertedAt: ISODateTime | null;
  version: number;
}

export type HealthRecordType =
  | "blood_pressure"
  | "blood_glucose"
  | "body_measurement"
  | "lab_result"
  | "vaccination"
  | "health_screening"
  | "pain"
  | "walking"
  | "exercise"
  | "medication"
  | "note";

export interface HealthRecord<TPayload extends object = Record<string, unknown>> {
  id: string;
  householdId: string;
  profileId: string;
  recordType: HealthRecordType;
  recordedAt: ISODateTime;
  source: "manual" | "ocr" | "import" | "local_ai";
  payload: TPayload;
  sourceDocumentId: string | null;
  deletedAt: ISODateTime | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  version: number;
}

export interface LocalDocument {
  id: string;
  householdId: string;
  profileId: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
  chunkCount: number;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  version: number;
}

export interface DashboardSummary {
  profileId: string;
  totalRecords: number;
  latestRecordedAt: ISODateTime | null;
  countsByType: Partial<Record<HealthRecordType, number>>;
}
