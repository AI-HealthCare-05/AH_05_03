import type { EncryptedLocalRecord, EncryptedRecordRepository } from "./contracts";
import type {
  DashboardSummary,
  FamilyProfile,
  HealthRecord,
  HealthRecordType,
  ISODate,
  ISODateTime,
  LocalErrorCode,
  LocalResult,
} from "./domainContracts";
import type { JsonCipher } from "./jsonCipher";

export class LocalProfileService {
  public constructor(
    private readonly repository: EncryptedRecordRepository,
    private readonly cipher: JsonCipher,
  ) {}

  public async create(input: {
    householdId: string;
    displayName: string;
    relationship: string;
    birthDate?: ISODate;
  }): Promise<LocalResult<FamilyProfile>> {
    const validationError = validateProfileInput(input);
    if (validationError) {
      return failure("VALIDATION_ERROR", validationError);
    }
    const now = new Date().toISOString();
    const profile: FamilyProfile = {
      id: crypto.randomUUID(),
      householdId: input.householdId,
      displayName: input.displayName.trim(),
      relationship: input.relationship.trim(),
      birthDate: input.birthDate ?? null,
      status: "active",
      createdAt: now,
      updatedAt: now,
      version: 1,
    };

    try {
      await this.repository.put(await toEncryptedRecord(profile, "family-profile", profile.id, this.cipher));
      return success(profile);
    } catch {
      return failure("ENCRYPTION_FAILED", "가족 구성원 프로필을 암호화해 저장하지 못했습니다.", true);
    }
  }

  public async get(profileId: string): Promise<LocalResult<FamilyProfile>> {
    const record = await this.repository.get(profileId);
    if (!record || record.recordType !== "family-profile") {
      return failure("NOT_FOUND", "가족 구성원 프로필을 찾을 수 없습니다.");
    }
    return decryptResult<FamilyProfile>(record, this.cipher);
  }

  public async list(householdId: string): Promise<LocalResult<FamilyProfile[]>> {
    const records = await this.repository.list({ householdRef: householdId, recordType: "family-profile" });
    const profiles: FamilyProfile[] = [];
    for (const record of records) {
      const result = await decryptResult<FamilyProfile>(record, this.cipher);
      if (!result.ok) {
        return result;
      }
      if (result.value.status === "active") {
        profiles.push(result.value);
      }
    }
    return success(profiles);
  }
}

export class LocalHealthRecordService {
  public constructor(
    private readonly repository: EncryptedRecordRepository,
    private readonly cipher: JsonCipher,
  ) {}

  public async create<TPayload extends object>(input: {
    householdId: string;
    profileId: string;
    recordType: HealthRecordType;
    recordedAt: ISODateTime;
    source: HealthRecord["source"];
    payload: TPayload;
    sourceDocumentId?: string;
  }): Promise<LocalResult<HealthRecord<TPayload>>> {
    if (!input.householdId || !input.profileId || Number.isNaN(Date.parse(input.recordedAt))) {
      return failure("VALIDATION_ERROR", "가정, 프로필과 올바른 기록 시각이 필요합니다.");
    }
    if (!input.payload || Object.keys(input.payload).length === 0) {
      return failure("VALIDATION_ERROR", "건강기록 내용이 필요합니다.");
    }
    const now = new Date().toISOString();
    const healthRecord: HealthRecord<TPayload> = {
      id: crypto.randomUUID(),
      householdId: input.householdId,
      profileId: input.profileId,
      recordType: input.recordType,
      recordedAt: input.recordedAt,
      source: input.source,
      payload: input.payload,
      sourceDocumentId: input.sourceDocumentId ?? null,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };

    try {
      await this.repository.put(
        await toEncryptedRecord(healthRecord, "health-record", input.profileId, this.cipher),
      );
      return success(healthRecord);
    } catch {
      return failure("ENCRYPTION_FAILED", "건강기록을 암호화해 저장하지 못했습니다.", true);
    }
  }

  public async get(recordId: string): Promise<LocalResult<HealthRecord>> {
    const record = await this.repository.get(recordId);
    if (!record || record.recordType !== "health-record") {
      return failure("NOT_FOUND", "건강기록을 찾을 수 없습니다.");
    }
    return decryptResult<HealthRecord>(record, this.cipher);
  }

  public async query(input: {
    profileId: string;
    recordTypes?: HealthRecordType[];
    from?: ISODateTime;
    to?: ISODateTime;
    includeDeleted?: boolean;
  }): Promise<LocalResult<HealthRecord[]>> {
    const records = await this.repository.list({ profileRef: input.profileId, recordType: "health-record" });
    const healthRecords: HealthRecord[] = [];
    for (const record of records) {
      const result = await decryptResult<HealthRecord>(record, this.cipher);
      if (!result.ok) {
        return result;
      }
      const value = result.value;
      if (!input.includeDeleted && value.deletedAt) continue;
      if (input.recordTypes && !input.recordTypes.includes(value.recordType)) continue;
      if (input.from && value.recordedAt < input.from) continue;
      if (input.to && value.recordedAt > input.to) continue;
      healthRecords.push(value);
    }
    healthRecords.sort((left, right) => right.recordedAt.localeCompare(left.recordedAt));
    return success(healthRecords);
  }
}

export class LocalDashboardService {
  public constructor(private readonly healthRecords: LocalHealthRecordService) {}

  public async summarize(profileId: string): Promise<LocalResult<DashboardSummary>> {
    const result = await this.healthRecords.query({ profileId });
    if (!result.ok) return result;

    const countsByType: DashboardSummary["countsByType"] = {};
    for (const record of result.value) {
      countsByType[record.recordType] = (countsByType[record.recordType] ?? 0) + 1;
    }
    return success({
      profileId,
      totalRecords: result.value.length,
      latestRecordedAt: result.value[0]?.recordedAt ?? null,
      countsByType,
    });
  }
}

async function toEncryptedRecord<T extends { id: string; householdId: string; createdAt: string; updatedAt: string }>(
  value: T,
  recordType: EncryptedLocalRecord["recordType"],
  profileRef: string,
  cipher: JsonCipher,
): Promise<EncryptedLocalRecord> {
  return {
    id: value.id,
    householdRef: value.householdId,
    profileRef,
    recordType,
    schemaVersion: 1,
    encryptedPayload: await cipher.encrypt(value),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

async function decryptResult<T>(record: EncryptedLocalRecord, cipher: JsonCipher): Promise<LocalResult<T>> {
  try {
    return success(await cipher.decrypt<T>(record.encryptedPayload));
  } catch {
    return failure("DECRYPTION_FAILED", "로컬 데이터를 복호화하지 못했습니다.");
  }
}

function validateProfileInput(input: {
  householdId: string;
  displayName: string;
  relationship: string;
  birthDate?: ISODate;
}): string | undefined {
  if (!input.householdId) return "가정 식별자가 필요합니다.";
  if (input.displayName.trim().length < 1 || input.displayName.trim().length > 100) {
    return "이름은 1자 이상 100자 이하여야 합니다.";
  }
  if (input.relationship.trim().length < 1 || input.relationship.trim().length > 80) {
    return "관계는 1자 이상 80자 이하여야 합니다.";
  }
  if (input.birthDate && !/^\d{4}-\d{2}-\d{2}$/u.test(input.birthDate)) {
    return "생년 정보는 YYYY-MM-DD 형식이어야 합니다.";
  }
  return undefined;
}

function success<T>(value: T): LocalResult<T> {
  return { ok: true, value };
}

function failure<T>(code: LocalErrorCode, message: string, retryable = false): LocalResult<T> {
  return { ok: false, error: { code, message, retryable } };
}
