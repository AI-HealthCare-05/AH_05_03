import type { EncryptedLocalRecord, EncryptedRecordRepository } from "./contracts";
import type { ShareableRecordType } from "./domainContracts";
import type { JsonCipher } from "./jsonCipher";

const BACKUP_FORMAT = "ieobom-backup";
const BACKUP_VERSION = 1;
const KDF_ITERATIONS = 310_000;
const MIN_IMPORT_ITERATIONS = 100_000;
const MAX_IMPORT_ITERATIONS = 2_000_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

interface BackupRecord {
  id: string;
  householdRef: string;
  profileRef: string;
  recordType: EncryptedLocalRecord["recordType"];
  schemaVersion: 1;
  payload: unknown;
  createdAt: string;
  updatedAt: string;
}

interface BackupPayload {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  createdAt: string;
  records: BackupRecord[];
}

interface BackupEnvelope {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  kdf: "PBKDF2-SHA-256";
  iterations: number;
  salt: string;
  cipher: "A256GCM";
  iv: string;
  ciphertext: string;
}

export interface BackupPreview {
  createdAt: string;
  totalRecords: number;
  countsByType: Partial<Record<EncryptedLocalRecord["recordType"], number>>;
}

export class LocalBackupService {
  public constructor(
    private readonly repository: EncryptedRecordRepository,
    private readonly localCipher: JsonCipher,
    private readonly cryptoApi: Crypto = globalThis.crypto,
  ) {}

  public async exportAll(passphrase: string): Promise<Blob> {
    validatePassphrase(passphrase);
    const records = await this.repository.list();
    return this.exportRecords(records, passphrase);
  }

  public async exportProfileTransfer(
    profileId: string,
    allowedRecordTypes: ShareableRecordType[],
    passphrase: string,
  ): Promise<Blob> {
    validatePassphrase(passphrase);
    if (allowedRecordTypes.length === 0) throw new Error("하나 이상의 공유 범위를 선택해야 합니다.");
    const records = await this.repository.list({ profileRef: profileId });
    const selected = records.filter(
      (record) => record.recordType === "family-profile" || allowedRecordTypes.includes(record.recordType as ShareableRecordType),
    );
    if (!selected.some((record) => record.recordType === "family-profile")) {
      throw new Error("공유할 가족 구성원 프로필을 찾을 수 없습니다.");
    }
    return this.exportRecords(selected, passphrase);
  }

  private async exportRecords(records: EncryptedLocalRecord[], passphrase: string): Promise<Blob> {
    const backupRecords: BackupRecord[] = [];
    for (const record of records) {
      backupRecords.push({
        id: record.id,
        householdRef: record.householdRef,
        profileRef: record.profileRef,
        recordType: record.recordType,
        schemaVersion: record.schemaVersion,
        payload: await this.localCipher.decrypt<unknown>(record.encryptedPayload),
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      });
    }

    const payload: BackupPayload = {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      createdAt: new Date().toISOString(),
      records: backupRecords,
    };
    const envelope = await encryptBackup(payload, passphrase, this.cryptoApi);
    return new Blob([JSON.stringify(envelope)], { type: "application/vnd.ieobom.backup+json" });
  }

  public async inspect(file: Blob, passphrase: string): Promise<BackupPreview> {
    const payload = await readBackup(file, passphrase, this.cryptoApi);
    return summarize(payload);
  }

  public async importAll(
    file: Blob,
    passphrase: string,
    mode: "replace" | "merge" | "reject-if-not-empty" = "reject-if-not-empty",
  ): Promise<BackupPreview> {
    const payload = await readBackup(file, passphrase, this.cryptoApi);
    const existing = await this.repository.list();
    if (mode === "reject-if-not-empty" && existing.length > 0) {
      throw new Error("기존 로컬 데이터가 있어 자동으로 덮어쓸 수 없습니다.");
    }

    const encryptedRecords: EncryptedLocalRecord[] = [];
    for (const record of payload.records) {
      validateBackupRecord(record);
      const normalizedPayload = normalizeImportedPayload(record);
      encryptedRecords.push({
        id: record.id,
        householdRef: record.householdRef,
        profileRef: record.profileRef,
        recordType: record.recordType,
        schemaVersion: record.schemaVersion,
        encryptedPayload: await this.localCipher.encrypt(normalizedPayload),
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      });
    }

    if (mode === "merge") {
      const existingIds = new Set(existing.map((record) => record.id));
      const duplicate = encryptedRecords.find((record) => existingIds.has(record.id));
      if (duplicate) throw new Error("가져올 파일에 현재 브라우저와 중복되는 기록이 있습니다.");
      await this.repository.replaceAll([...existing, ...encryptedRecords]);
    } else {
      await this.repository.replaceAll(encryptedRecords);
    }
    return summarize(payload);
  }
}

function normalizeImportedPayload(record: BackupRecord): unknown {
  if (record.recordType !== "family-profile" || typeof record.payload !== "object" || record.payload === null) {
    return record.payload;
  }
  return {
    ...record.payload,
    opaqueServerRef: null,
    serverRefState: "none",
  };
}

async function encryptBackup(
  payload: BackupPayload,
  passphrase: string,
  cryptoApi: Crypto,
): Promise<BackupEnvelope> {
  const salt = cryptoApi.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = cryptoApi.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveBackupKey(passphrase, salt, KDF_ITERATIONS, cryptoApi);
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const ciphertext = await cryptoApi.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    kdf: "PBKDF2-SHA-256",
    iterations: KDF_ITERATIONS,
    salt: toBase64Url(salt),
    cipher: "A256GCM",
    iv: toBase64Url(iv),
    ciphertext: toBase64Url(new Uint8Array(ciphertext)),
  };
}

async function readBackup(file: Blob, passphrase: string, cryptoApi: Crypto): Promise<BackupPayload> {
  validatePassphrase(passphrase);
  let envelope: BackupEnvelope;
  try {
    envelope = JSON.parse(await file.text()) as BackupEnvelope;
  } catch {
    throw new Error("이어봄 백업 파일 형식이 아닙니다.");
  }
  validateEnvelope(envelope);
  const key = await deriveBackupKey(
    passphrase,
    fromBase64Url(envelope.salt),
    envelope.iterations,
    cryptoApi,
  );
  try {
    const plaintext = await cryptoApi.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64Url(envelope.iv) },
      key,
      fromBase64Url(envelope.ciphertext),
    );
    const payload = JSON.parse(new TextDecoder().decode(plaintext)) as BackupPayload;
    validatePayload(payload);
    return payload;
  } catch {
    throw new Error("백업 비밀번호가 틀렸거나 파일이 손상되었습니다.");
  }
}

async function deriveBackupKey(
  passphrase: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
  cryptoApi: Crypto,
): Promise<CryptoKey> {
  const material = await cryptoApi.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return cryptoApi.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function validatePassphrase(passphrase: string): void {
  if (passphrase.length < 12) {
    throw new Error("백업 비밀번호는 12자 이상이어야 합니다.");
  }
}

function validateEnvelope(envelope: BackupEnvelope): void {
  if (
    envelope.format !== BACKUP_FORMAT ||
    envelope.version !== BACKUP_VERSION ||
    envelope.kdf !== "PBKDF2-SHA-256" ||
    envelope.cipher !== "A256GCM" ||
    envelope.iterations < MIN_IMPORT_ITERATIONS ||
    envelope.iterations > MAX_IMPORT_ITERATIONS ||
    !envelope.salt ||
    !envelope.iv ||
    !envelope.ciphertext
  ) {
    throw new Error("지원하지 않는 이어봄 백업 형식입니다.");
  }
}

function validatePayload(payload: BackupPayload): void {
  if (payload.format !== BACKUP_FORMAT || payload.version !== BACKUP_VERSION || !Array.isArray(payload.records)) {
    throw new Error("지원하지 않는 백업 데이터 버전입니다.");
  }
}

function validateBackupRecord(record: BackupRecord): void {
  if (
    !record.id ||
    !record.householdRef ||
    !record.profileRef ||
    !record.recordType ||
    record.schemaVersion !== 1 ||
    record.payload === undefined
  ) {
    throw new Error("백업 레코드가 손상되었습니다.");
  }
}

function summarize(payload: BackupPayload): BackupPreview {
  const countsByType: BackupPreview["countsByType"] = {};
  for (const record of payload.records) {
    countsByType[record.recordType] = (countsByType[record.recordType] ?? 0) + 1;
  }
  return {
    createdAt: payload.createdAt,
    totalRecords: payload.records.length,
    countsByType,
  };
}

function toBase64Url(value: Uint8Array<ArrayBufferLike>): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
