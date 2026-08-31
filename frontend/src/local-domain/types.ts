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
  | "pain"
  | "walking"
  | "exercise"
  | "medication"
  | "note";

export type HealthPayload =
  | { type: "blood_pressure"; systolicMmHg: number; diastolicMmHg: number; pulseBpm?: number; note?: string }
  | { type: "blood_glucose"; valueMgDl: number; timing: "fasting" | "before_meal" | "after_meal" | "bedtime" | "random"; minutesAfterMeal?: number; note?: string }
  | { type: "body_measurement"; heightCm?: number; weightKg?: number; bodyFatPercent?: number; skeletalMuscleKg?: number; waistCm?: number; note?: string }
  | { type: "lab_result"; testCode: string; testName: string; value: number | string; unit?: string; note?: string }
  | { type: "vaccination"; vaccineName: string; doseNumber?: number; institution?: string; note?: string }
  | { type: "health_screening"; screeningName: string; institution?: string; summary?: string }
  | { type: "pain"; bodyArea: string; intensity: number; sensation?: string; onsetAt?: ISODateTime; aggravatingFactors?: string; note?: string }
  | { type: "walking"; steps?: number; distanceKm?: number; durationMinutes?: number; sourceName?: string; note?: string }
  | { type: "exercise"; exerciseName: string; weightKg?: number; reps?: number; sets?: number; durationMinutes?: number; note?: string }
  | { type: "medication"; medicationName: string; dosage?: string; takenAt?: string; note?: string }
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
  source: "manual" | "ocr" | "import" | "local_ai";
  payloadCiphertext: EncryptedValue;
  canonicalPayloadHashCiphertext: EncryptedValue;
  sourceDocumentId: UUID | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  deletedAt: ISODateTime | null;
  version: 1;
}

export interface CreateHealthRecordInput {
  householdId: UUID;
  profileId: UUID;
  recordedAt: ISODateTime;
  source: "manual" | "ocr" | "import" | "local_ai";
  payload: HealthPayload;
  sourceDocumentId?: UUID;
  duplicatePolicy: "reject" | "allow";
}

export interface HealthRecordView extends Omit<StoredHealthRecord, "payloadCiphertext" | "canonicalPayloadHashCiphertext"> {
  payload: HealthPayload;
}

export interface StoredHealthDocument {
  id: UUID;
  householdId: UUID;
  profileId: UUID;
  encryptedFileId: UUID;
  originalNameCiphertext: EncryptedValue;
  mimeType: "image/jpeg" | "image/png";
  plaintextSize: number;
  plaintextSha256Ciphertext: EncryptedValue;
  capturedAt: ISODateTime | null;
  createdAt: ISODateTime;
  deletedAt: ISODateTime | null;
  version: 1;
}

export interface HealthDocumentView extends Omit<StoredHealthDocument, "originalNameCiphertext" | "plaintextSha256Ciphertext"> {
  originalName: string;
}

export interface OcrExamItem { testName: string; value: string; unit: string; judgment: string }
export interface OcrContent { text: string; tables: Array<{ table_index: number; rows: string[][] }>; examItems?: OcrExamItem[] }
export interface StoredOcrResult {
  id: UUID;
  documentId: UUID;
  engine: string;
  engineVersion: string;
  rawContentCiphertext: EncryptedValue;
  confirmedContentCiphertext: EncryptedValue;
  status: "draft" | "confirmed";
  createdAt: ISODateTime;
  confirmedAt: ISODateTime | null;
  version: number;
}

export type PainProgressStatus = "improved" | "same" | "worse" | "resolved";
export interface PainProgressPayload { intensity: number; status: PainProgressStatus; medication?: string; medicalVisit: boolean; note?: string }
export interface StoredPainProgress {
  id: UUID;
  painRecordId: UUID;
  profileId: UUID;
  recordedAt: ISODateTime;
  payloadCiphertext: EncryptedValue;
  createdAt: ISODateTime;
  version: 1;
}
export interface PainProgressView extends Omit<StoredPainProgress, "payloadCiphertext"> { payload: PainProgressPayload }
