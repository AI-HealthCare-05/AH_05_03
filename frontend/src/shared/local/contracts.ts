export type LocalRecordType =
  | "family-profile"
  | "document"
  | "health-record"
  | "family-history"
  | "model-result"
  | "access-grant"
  | "merge-operation"
  | "restore-point"
  | "challenge-plan"
  | "challenge-progress";

export interface EncryptedValue {
  algorithm: "A256GCM";
  keyVersion: number;
  iv: string;
  ciphertext: string;
}

export interface EncryptedLocalRecord {
  id: string;
  householdRef: string;
  profileRef: string;
  recordType: LocalRecordType;
  schemaVersion: 1;
  encryptedPayload: EncryptedValue;
  createdAt: string;
  updatedAt: string;
}

export interface EncryptedRecordRepository {
  put(record: EncryptedLocalRecord): Promise<void>;
  get(recordId: string): Promise<EncryptedLocalRecord | undefined>;
  list(query?: EncryptedRecordQuery): Promise<EncryptedLocalRecord[]>;
  delete(recordId: string): Promise<void>;
  clear(): Promise<void>;
  replaceAll(records: EncryptedLocalRecord[]): Promise<void>;
  close(): void;
}

export interface EncryptedRecordQuery {
  householdRef?: string;
  profileRef?: string;
  recordType?: LocalRecordType;
}
