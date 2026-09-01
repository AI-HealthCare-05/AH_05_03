import type { EncryptedLocalRecord, EncryptedRecordRepository } from "./contracts";
import type {
  DashboardSummary,
  FamilyHistory,
  FamilyProfile,
  HealthRecord,
  HealthRecordType,
  ISODate,
  ISODateTime,
  LocalAccessGrant,
  LocalErrorCode,
  LocalResult,
  ProfileMergeOperation,
  ShareableRecordType,
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
      opaqueServerRef: null,
      serverRefState: "none",
      status: "active",
      mergedIntoProfileId: null,
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
    const result = await decryptResult<FamilyProfile>(record, this.cipher);
    return result.ok ? success(normalizeFamilyProfile(result.value)) : result;
  }

  public async list(householdId: string): Promise<LocalResult<FamilyProfile[]>> {
    return this.listByStatus(householdId, "active");
  }

  public async listHidden(householdId: string): Promise<LocalResult<FamilyProfile[]>> {
    return this.listByStatus(householdId, "hidden");
  }

  private async listByStatus(
    householdId: string,
    status: FamilyProfile["status"],
  ): Promise<LocalResult<FamilyProfile[]>> {
    const records = await this.repository.list({ householdRef: householdId, recordType: "family-profile" });
    const profiles: FamilyProfile[] = [];
    for (const record of records) {
      const result = await decryptResult<FamilyProfile>(record, this.cipher);
      if (!result.ok) {
        return result;
      }
      const profile = normalizeFamilyProfile(result.value);
      if (profile.status === status) {
        profiles.push(profile);
      }
    }
    return success(profiles);
  }

  public async update(
    profileId: string,
    input: { displayName: string; relationship: string; birthDate?: ISODate; expectedVersion: number },
  ): Promise<LocalResult<FamilyProfile>> {
    const current = await this.get(profileId);
    if (!current.ok) return current;
    if (current.value.version !== input.expectedVersion) {
      return failure("VERSION_CONFLICT", "다른 화면에서 프로필이 변경되었습니다. 새로고침 후 다시 시도해 주세요.");
    }
    const validationError = validateProfileInput({ householdId: current.value.householdId, ...input });
    if (validationError) return failure("VALIDATION_ERROR", validationError);
    const updated: FamilyProfile = {
      ...current.value,
      displayName: input.displayName.trim(),
      relationship: input.relationship.trim(),
      birthDate: input.birthDate ?? null,
      updatedAt: new Date().toISOString(),
      version: current.value.version + 1,
    };
    await this.repository.put(await toEncryptedRecord(updated, "family-profile", updated.id, this.cipher));
    return success(updated);
  }

  public async hide(profileId: string, expectedVersion: number): Promise<LocalResult<FamilyProfile>> {
    const current = await this.get(profileId);
    if (!current.ok) return current;
    if (current.value.version !== expectedVersion) return failure("VERSION_CONFLICT", "프로필 버전이 변경되었습니다.");
    const updated: FamilyProfile = {
      ...current.value,
      status: "hidden",
      updatedAt: new Date().toISOString(),
      version: current.value.version + 1,
    };
    await this.repository.put(await toEncryptedRecord(updated, "family-profile", updated.id, this.cipher));
    return success(updated);
  }

  public async restore(profileId: string, expectedVersion: number): Promise<LocalResult<FamilyProfile>> {
    const current = await this.get(profileId);
    if (!current.ok) return current;
    if (current.value.version !== expectedVersion) return failure("VERSION_CONFLICT", "프로필 버전이 변경되었습니다.");
    if (current.value.status !== "hidden") {
      return failure("VALIDATION_ERROR", "숨겨진 프로필만 가족 목록으로 복원할 수 있습니다.");
    }
    const updated: FamilyProfile = {
      ...current.value,
      status: "active",
      updatedAt: new Date().toISOString(),
      version: current.value.version + 1,
    };
    await this.repository.put(await toEncryptedRecord(updated, "family-profile", updated.id, this.cipher));
    return success(updated);
  }

  public async deleteEmpty(profileId: string): Promise<LocalResult<{ deleted: true }>> {
    const current = await this.get(profileId);
    if (!current.ok) return current;
    const related = (await this.repository.list({ profileRef: profileId })).filter(
      (record) => record.id !== profileId,
    );
    if (related.length > 0) {
      return failure("DUPLICATE_RECORD", "연결된 기록이 있는 프로필은 삭제할 수 없습니다. 숨김 또는 병합을 사용해 주세요.");
    }
    await this.repository.delete(profileId);
    return success({ deleted: true });
  }

  public async setServerReference(
    profileId: string,
    reference: string | null,
    state: FamilyProfile["serverRefState"],
  ): Promise<LocalResult<FamilyProfile>> {
    const current = await this.get(profileId);
    if (!current.ok) return current;
    if ((state === "pending" || state === "active") && !reference) {
      return failure("VALIDATION_ERROR", "대기 또는 활성 연결에는 불투명 참조값이 필요합니다.");
    }
    const updated: FamilyProfile = {
      ...current.value,
      opaqueServerRef: state === "retired" || state === "none" ? null : reference,
      serverRefState: state,
      updatedAt: new Date().toISOString(),
      version: current.value.version + 1,
    };
    await this.repository.put(await toEncryptedRecord(updated, "family-profile", updated.id, this.cipher));
    return success(updated);
  }
}

export class LocalFamilyHistoryService {
  public constructor(
    private readonly repository: EncryptedRecordRepository,
    private readonly cipher: JsonCipher,
  ) {}

  public async create(input: {
    householdId: string;
    profileId: string;
    relativeRelationship: string;
    conditionName: string;
    onsetAge?: number;
    note?: string;
  }): Promise<LocalResult<FamilyHistory>> {
    const error = validateFamilyHistory(input);
    if (error) return failure("VALIDATION_ERROR", error);
    const now = new Date().toISOString();
    const history: FamilyHistory = {
      id: crypto.randomUUID(),
      householdId: input.householdId,
      profileId: input.profileId,
      relativeRelationship: input.relativeRelationship.trim(),
      conditionName: input.conditionName.trim(),
      onsetAge: input.onsetAge ?? null,
      note: input.note?.trim() || null,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    await this.repository.put(await toEncryptedRecord(history, "family-history", input.profileId, this.cipher));
    return success(history);
  }

  public async list(profileId: string): Promise<LocalResult<FamilyHistory[]>> {
    const records = await this.repository.list({ profileRef: profileId, recordType: "family-history" });
    const values: FamilyHistory[] = [];
    for (const record of records) {
      const result = await decryptResult<FamilyHistory>(record, this.cipher);
      if (!result.ok) return result;
      values.push(result.value);
    }
    return success(values.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)));
  }

  public async update(
    historyId: string,
    input: { relativeRelationship: string; conditionName: string; onsetAge?: number; note?: string; expectedVersion: number },
  ): Promise<LocalResult<FamilyHistory>> {
    const record = await this.repository.get(historyId);
    if (!record || record.recordType !== "family-history") return failure("NOT_FOUND", "가족력 기록을 찾을 수 없습니다.");
    const current = await decryptResult<FamilyHistory>(record, this.cipher);
    if (!current.ok) return current;
    if (current.value.version !== input.expectedVersion) return failure("VERSION_CONFLICT", "가족력 기록이 변경되었습니다.");
    const error = validateFamilyHistory({ householdId: current.value.householdId, profileId: current.value.profileId, ...input });
    if (error) return failure("VALIDATION_ERROR", error);
    const updated: FamilyHistory = {
      ...current.value,
      relativeRelationship: input.relativeRelationship.trim(),
      conditionName: input.conditionName.trim(),
      onsetAge: input.onsetAge ?? null,
      note: input.note?.trim() || null,
      updatedAt: new Date().toISOString(),
      version: current.value.version + 1,
    };
    await this.repository.put(await toEncryptedRecord(updated, "family-history", updated.profileId, this.cipher));
    return success(updated);
  }

  public async delete(historyId: string): Promise<LocalResult<{ deleted: true }>> {
    const record = await this.repository.get(historyId);
    if (!record || record.recordType !== "family-history") return failure("NOT_FOUND", "가족력 기록을 찾을 수 없습니다.");
    await this.repository.delete(historyId);
    return success({ deleted: true });
  }
}

export class LocalAccessGrantService {
  public constructor(
    private readonly repository: EncryptedRecordRepository,
    private readonly cipher: JsonCipher,
  ) {}

  public async grant(input: {
    householdId: string;
    profileId: string;
    granteeAccountId: string;
    allowedRecordTypes: ShareableRecordType[];
  }): Promise<LocalResult<LocalAccessGrant>> {
    if (!input.householdId || !input.profileId || !input.granteeAccountId || input.allowedRecordTypes.length === 0) {
      return failure("VALIDATION_ERROR", "가정, 프로필, 대상 계정과 하나 이상의 공유 범위가 필요합니다.");
    }
    const existing = await this.list(input.profileId);
    if (!existing.ok) return existing;
    const duplicate = existing.value.find(
      (item) => item.granteeAccountId === input.granteeAccountId && item.status === "active",
    );
    const now = new Date().toISOString();
    const grant: LocalAccessGrant = duplicate
      ? {
          ...duplicate,
          allowedRecordTypes: [...new Set(input.allowedRecordTypes)],
          updatedAt: now,
          version: duplicate.version + 1,
        }
      : {
          id: crypto.randomUUID(),
          householdId: input.householdId,
          profileId: input.profileId,
          granteeAccountId: input.granteeAccountId,
          allowedRecordTypes: [...new Set(input.allowedRecordTypes)],
          status: "active",
          createdAt: now,
          updatedAt: now,
          revokedAt: null,
          version: 1,
        };
    await this.repository.put(await toEncryptedRecord(grant, "access-grant", grant.profileId, this.cipher));
    return success(grant);
  }

  public async list(profileId: string): Promise<LocalResult<LocalAccessGrant[]>> {
    const records = await this.repository.list({ profileRef: profileId, recordType: "access-grant" });
    const grants: LocalAccessGrant[] = [];
    for (const record of records) {
      const result = await decryptResult<LocalAccessGrant>(record, this.cipher);
      if (!result.ok) return result;
      grants.push(result.value);
    }
    return success(grants);
  }

  public async revoke(grantId: string): Promise<LocalResult<LocalAccessGrant>> {
    const record = await this.repository.get(grantId);
    if (!record || record.recordType !== "access-grant") return failure("NOT_FOUND", "접근 범위를 찾을 수 없습니다.");
    const current = await decryptResult<LocalAccessGrant>(record, this.cipher);
    if (!current.ok) return current;
    if (current.value.status === "revoked") return success(current.value);
    const now = new Date().toISOString();
    const revoked: LocalAccessGrant = {
      ...current.value,
      status: "revoked",
      revokedAt: now,
      updatedAt: now,
      version: current.value.version + 1,
    };
    await this.repository.put(await toEncryptedRecord(revoked, "access-grant", revoked.profileId, this.cipher));
    return success(revoked);
  }
}

interface LocalRestorePoint {
  id: string;
  householdId: string;
  profileId: string;
  mergeOperationId: string;
  records: EncryptedLocalRecord[];
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  version: number;
}

export class LocalProfileMergeService {
  public constructor(
    private readonly repository: EncryptedRecordRepository,
    private readonly cipher: JsonCipher,
  ) {}

  public async merge(sourceProfileId: string, targetProfileId: string): Promise<LocalResult<ProfileMergeOperation>> {
    if (sourceProfileId === targetProfileId) {
      return failure("PROFILE_MERGE_CONFLICT", "같은 프로필끼리는 병합할 수 없습니다.");
    }
    const sourceRecord = await this.repository.get(sourceProfileId);
    const targetRecord = await this.repository.get(targetProfileId);
    if (sourceRecord?.recordType !== "family-profile" || targetRecord?.recordType !== "family-profile") {
      return failure("NOT_FOUND", "병합할 프로필을 찾을 수 없습니다.");
    }
    const source = await decryptResult<FamilyProfile>(sourceRecord, this.cipher);
    const target = await decryptResult<FamilyProfile>(targetRecord, this.cipher);
    if (!source.ok) return source;
    if (!target.ok) return target;
    if (
      source.value.householdId !== target.value.householdId ||
      source.value.status !== "active" ||
      target.value.status !== "active"
    ) {
      return failure("PROFILE_MERGE_NOT_SAFE", "같은 가정의 활성 프로필만 병합할 수 있습니다.");
    }

    const allRecords = await this.repository.list();
    const affected = allRecords.filter((record) => record.profileRef === sourceProfileId);
    const now = new Date().toISOString();
    const operationId = crypto.randomUUID();
    const restorePointId = crypto.randomUUID();
    const updatedById = new Map<string, EncryptedLocalRecord>();

    for (const record of affected) {
      if (record.id === sourceProfileId) continue;
      const payload = await this.cipher.decrypt<Record<string, unknown>>(record.encryptedPayload);
      if (record.recordType === "access-grant") {
        payload.status = "revoked";
        payload.revokedAt = now;
      } else {
        if (payload.profileId === sourceProfileId) payload.profileId = targetProfileId;
        if (payload.subjectProfileId === sourceProfileId) payload.subjectProfileId = targetProfileId;
      }
      payload.updatedAt = now;
      if (typeof payload.version === "number") payload.version += 1;
      updatedById.set(
        record.id,
        await reencryptRecord(record, payload, record.recordType === "access-grant" ? sourceProfileId : targetProfileId, this.cipher),
      );
    }

    const mergedSource: FamilyProfile = {
      ...source.value,
      opaqueServerRef: null,
      serverRefState: "retired",
      status: "merged",
      mergedIntoProfileId: targetProfileId,
      updatedAt: now,
      version: source.value.version + 1,
    };
    updatedById.set(
      sourceProfileId,
      await toEncryptedRecord(mergedSource, "family-profile", sourceProfileId, this.cipher),
    );

    const restorePoint: LocalRestorePoint = {
      id: restorePointId,
      householdId: source.value.householdId,
      profileId: targetProfileId,
      mergeOperationId: operationId,
      records: affected,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    const operation: ProfileMergeOperation = {
      id: operationId,
      householdId: source.value.householdId,
      sourceProfileId,
      targetProfileId,
      restorePointId,
      status: "committed",
      createdAt: now,
      updatedAt: now,
      revertedAt: null,
      version: 1,
    };
    const nextRecords = allRecords.map((record) => updatedById.get(record.id) ?? record);
    nextRecords.push(
      await toEncryptedRecord(restorePoint, "restore-point", targetProfileId, this.cipher),
      await toEncryptedRecord(operation, "merge-operation", targetProfileId, this.cipher),
    );
    await this.repository.replaceAll(nextRecords);
    return success(operation);
  }

  public async revert(operationId: string): Promise<LocalResult<ProfileMergeOperation>> {
    const operationRecord = await this.repository.get(operationId);
    if (!operationRecord || operationRecord.recordType !== "merge-operation") {
      return failure("NOT_FOUND", "병합 작업을 찾을 수 없습니다.");
    }
    const operationResult = await decryptResult<ProfileMergeOperation>(operationRecord, this.cipher);
    if (!operationResult.ok) return operationResult;
    if (operationResult.value.status !== "committed") {
      return failure("PROFILE_MERGE_CONFLICT", "이미 되돌린 병합입니다.");
    }
    const restoreRecord = await this.repository.get(operationResult.value.restorePointId);
    if (!restoreRecord || restoreRecord.recordType !== "restore-point") {
      return failure("ROLLBACK_REQUIRED", "병합 복구 지점을 찾을 수 없습니다.");
    }
    const restoreResult = await decryptResult<LocalRestorePoint>(restoreRecord, this.cipher);
    if (!restoreResult.ok) return restoreResult;
    const allRecords = await this.repository.list();
    const originals = new Map(restoreResult.value.records.map((record) => [record.id, record]));
    const restored = allRecords.map((record) => originals.get(record.id) ?? record);
    const now = new Date().toISOString();
    const reverted: ProfileMergeOperation = {
      ...operationResult.value,
      status: "reverted",
      revertedAt: now,
      updatedAt: now,
      version: operationResult.value.version + 1,
    };
    const operationIndex = restored.findIndex((record) => record.id === operationId);
    restored[operationIndex] = await toEncryptedRecord(
      reverted,
      "merge-operation",
      reverted.targetProfileId,
      this.cipher,
    );
    await this.repository.replaceAll(restored);
    return success(reverted);
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
    if (input.source === "local_ai" || input.source === "ocr") {
      const validationError = validateAiHealthRecordPayload(
        input.recordType,
        input.payload as Record<string, unknown>,
      );
      if (validationError) return failure("VALIDATION_ERROR", validationError);
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

  public async update<TPayload extends object>(
    recordId: string,
    input: {
      recordType: HealthRecordType;
      recordedAt: ISODateTime;
      payload: TPayload;
      expectedVersion: number;
    },
  ): Promise<LocalResult<HealthRecord<TPayload>>> {
    const current = await this.get(recordId);
    if (!current.ok) return current;
    if (current.value.version !== input.expectedVersion) {
      return failure("VERSION_CONFLICT", "건강기록이 다른 화면에서 변경되었습니다.");
    }
    if (current.value.deletedAt) {
      return failure("VALIDATION_ERROR", "삭제된 건강기록은 복원한 뒤 수정할 수 있습니다.");
    }
    if (Number.isNaN(Date.parse(input.recordedAt)) || Object.keys(input.payload).length === 0) {
      return failure("VALIDATION_ERROR", "올바른 기록 시각과 건강기록 내용이 필요합니다.");
    }
    const updated: HealthRecord<TPayload> = {
      ...current.value,
      recordType: input.recordType,
      recordedAt: input.recordedAt,
      payload: input.payload,
      updatedAt: new Date().toISOString(),
      version: current.value.version + 1,
    };
    await this.repository.put(
      await toEncryptedRecord(updated, "health-record", updated.profileId, this.cipher),
    );
    return success(updated);
  }

  public async softDelete(recordId: string, expectedVersion: number): Promise<LocalResult<HealthRecord>> {
    return this.changeDeletedState(recordId, expectedVersion, new Date().toISOString());
  }

  public async restore(recordId: string, expectedVersion: number): Promise<LocalResult<HealthRecord>> {
    return this.changeDeletedState(recordId, expectedVersion, null);
  }

  private async changeDeletedState(
    recordId: string,
    expectedVersion: number,
    deletedAt: ISODateTime | null,
  ): Promise<LocalResult<HealthRecord>> {
    const current = await this.get(recordId);
    if (!current.ok) return current;
    if (current.value.version !== expectedVersion) {
      return failure("VERSION_CONFLICT", "건강기록이 다른 화면에서 변경되었습니다.");
    }
    if (deletedAt === null && current.value.deletedAt === null) {
      return failure("VALIDATION_ERROR", "삭제된 건강기록만 복원할 수 있습니다.");
    }
    const updated: HealthRecord = {
      ...current.value,
      deletedAt,
      updatedAt: new Date().toISOString(),
      version: current.value.version + 1,
    };
    await this.repository.put(
      await toEncryptedRecord(updated, "health-record", updated.profileId, this.cipher),
    );
    return success(updated);
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

function validateAiHealthRecordPayload(
  recordType: HealthRecordType,
  payload: Record<string, unknown>,
): string | undefined {
  const numberInRange = (value: unknown, min: number, max: number) =>
    typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
  const optionalNumberInRange = (value: unknown, min: number, max: number) =>
    value === undefined || numberInRange(value, min, max);
  const nonEmptyString = (value: unknown) => typeof value === "string" && value.trim().length > 0;

  switch (recordType) {
    case "exercise":
      if (!nonEmptyString(payload.exerciseName)) return "운동명이 필요합니다.";
      if (!optionalNumberInRange(payload.distanceKm, 0, 500)) return "운동 거리는 0~500km 사이여야 합니다.";
      if (!optionalNumberInRange(payload.weightKg, 0, 1000)) return "운동 중량은 0~1,000kg 사이여야 합니다.";
      if (!optionalNumberInRange(payload.reps, 1, 10000)) return "운동 횟수는 1~10,000회 사이여야 합니다.";
      if (!optionalNumberInRange(payload.sets, 1, 1000)) return "운동 세트는 1~1,000세트 사이여야 합니다.";
      if (!optionalNumberInRange(payload.durationMinutes, 1, 1440)) return "운동 시간은 1~1,440분 사이여야 합니다.";
      return undefined;
    case "blood_pressure": {
      const systolic = payload.systolicMmHg;
      const diastolic = payload.diastolicMmHg;
      if (!numberInRange(systolic, 40, 300)) return "수축기 혈압은 40~300mmHg 사이여야 합니다.";
      if (!numberInRange(diastolic, 20, 200)) return "이완기 혈압은 20~200mmHg 사이여야 합니다.";
      if ((diastolic as number) >= (systolic as number)) return "이완기 혈압은 수축기 혈압보다 낮아야 합니다.";
      if (!optionalNumberInRange(payload.pulseBpm, 20, 250)) return "맥박은 20~250bpm 사이여야 합니다.";
      return undefined;
    }
    case "blood_glucose":
      if (!numberInRange(payload.valueMgDl, 20, 1000)) return "혈당은 20~1,000mg/dL 사이여야 합니다.";
      return undefined;
    case "medication":
      return nonEmptyString(payload.medicationName) ? undefined : "약물명이 필요합니다.";
    case "pain":
      if (!nonEmptyString(payload.bodyArea)) return "통증 부위가 필요합니다.";
      if (!numberInRange(payload.intensity, 0, 10) || !Number.isInteger(payload.intensity)) {
        return "통증 강도는 0~10 사이의 정수여야 합니다.";
      }
      return undefined;
    case "health_screening":
      return nonEmptyString(payload.screeningName) ? undefined : "검진명이 필요합니다.";
    case "lab_result":
      return nonEmptyString(payload.testName) ? undefined : "검사명이 필요합니다.";
    default:
      return undefined;
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

async function reencryptRecord(
  record: EncryptedLocalRecord,
  payload: unknown,
  profileRef: string,
  cipher: JsonCipher,
): Promise<EncryptedLocalRecord> {
  return {
    ...record,
    profileRef,
    encryptedPayload: await cipher.encrypt(payload),
    updatedAt: new Date().toISOString(),
  };
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

function normalizeFamilyProfile(profile: FamilyProfile): FamilyProfile {
  return {
    ...profile,
    opaqueServerRef: profile.opaqueServerRef ?? null,
    serverRefState: profile.serverRefState ?? "none",
    mergedIntoProfileId: profile.mergedIntoProfileId ?? null,
  };
}

function validateFamilyHistory(input: {
  householdId: string;
  profileId: string;
  relativeRelationship: string;
  conditionName: string;
  onsetAge?: number;
  note?: string;
}): string | undefined {
  if (!input.householdId || !input.profileId) return "가정과 구성원 프로필이 필요합니다.";
  if (input.relativeRelationship.trim().length < 1 || input.relativeRelationship.trim().length > 80) {
    return "가족 관계는 1자 이상 80자 이하여야 합니다.";
  }
  if (input.conditionName.trim().length < 1 || input.conditionName.trim().length > 200) {
    return "질환명은 1자 이상 200자 이하여야 합니다.";
  }
  if (input.onsetAge !== undefined && (!Number.isInteger(input.onsetAge) || input.onsetAge < 0 || input.onsetAge > 150)) {
    return "발병 추정 연령은 0세 이상 150세 이하의 정수여야 합니다.";
  }
  if ((input.note?.length ?? 0) > 2000) return "메모는 2000자 이하여야 합니다.";
  return undefined;
}

function success<T>(value: T): LocalResult<T> {
  return { ok: true, value };
}

function failure<T>(code: LocalErrorCode, message: string, retryable = false): LocalResult<T> {
  return { ok: false, error: { code, message, retryable } };
}
