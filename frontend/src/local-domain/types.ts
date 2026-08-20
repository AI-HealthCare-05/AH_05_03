export type UUID = string;
export type ISODateTime = string;

export type LocalErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "DUPLICATE_RECORD"
  | "STORAGE_QUOTA_EXCEEDED"
  | "STORAGE_PERMISSION_DENIED"
  | "CRYPTO_KEY_UNAVAILABLE"
  | "ENCRYPTION_FAILED"
  | "DECRYPTION_FAILED";

export interface LocalError {
  code: LocalErrorCode;
  message: string;
  fieldErrors?: Array<{ field: string; reason: string }>;
  retryable: boolean;
}

export type LocalResult<T> = { ok: true; value: T } | { ok: false; error: LocalError };

export type HealthRecordType =
  | "blood_pressure"
  | "blood_glucose"
  | "body_measurement"
  | "lab_result"
  | "vaccination"
  | "health_screening"
  | "walking"
  | "note";

export type HealthPayload =
  | { type: "blood_pressure"; systolicMmHg: number; diastolicMmHg: number; pulseBpm?: number; note?: string }
  | { type: "blood_glucose"; valueMgDl: number; timing: "fasting" | "before_meal" | "after_meal" | "bedtime" | "random"; minutesAfterMeal?: number; note?: string }
  | { type: "body_measurement"; heightCm?: number; weightKg?: number; bodyFatPercent?: number; skeletalMuscleKg?: number; waistCm?: number; note?: string }
  | { type: "lab_result"; testCode: string; testName: string; value: number | string; unit?: string; note?: string }
  | { type: "vaccination"; vaccineName: string; doseNumber?: number; institution?: string; note?: string }
  | { type: "health_screening"; screeningName: string; institution?: string; summary?: string }
  | { type: "walking"; steps?: number; distanceKm?: number; durationMinutes?: number; sourceName?: string; note?: string }
  | { type: "note"; title?: string; text: string };

export interface EncryptedValue {
  algorithm: "A256GCM";
  keyVersion: 1;
  iv: string;
  ciphertext: string;
}

export interface StoredHealthRecord {
  id: UUID;
  householdId: UUID;
  profileId: UUID;
  recordType: HealthRecordType;
  schemaVersion: 1;
  recordedAt: ISODateTime;
  source: "manual";
  payloadCiphertext: EncryptedValue;
  canonicalPayloadHashCiphertext: EncryptedValue;
  sourceDocumentId: null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  deletedAt: ISODateTime | null;
  version: 1;
}

export interface CreateHealthRecordInput {
  householdId: UUID;
  profileId: UUID;
  recordedAt: ISODateTime;
  source: "manual";
  payload: HealthPayload;
  duplicatePolicy: "reject" | "allow";
}

export interface HealthRecordView extends Omit<StoredHealthRecord, "payloadCiphertext" | "canonicalPayloadHashCiphertext"> {
  payload: HealthPayload;
}
