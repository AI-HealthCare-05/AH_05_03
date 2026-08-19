export type LocalRecordType =
  | "family-profile"
  | "health-record"
  | "family-history"
  | "model-result";

export interface EncryptedValue {
  algorithm: "A256GCM";
  keyVersion: number;
  iv: string;
  ciphertext: string;
}

export interface EncryptedLocalRecord {
  id: string;
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
  delete(recordId: string): Promise<void>;
  close(): void;
}
