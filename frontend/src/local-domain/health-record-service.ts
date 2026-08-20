import { canonicalHash, decryptJson, encryptJson } from "../local-storage/crypto/record-crypto";
import { findCandidates, getOrCreateDataKey, listRecordsForProfile, openLocalDatabase, saveRecordAndEvent } from "../local-storage/indexeddb/database";
import type { CreateHealthRecordInput, HealthPayload, HealthRecordView, LocalResult, StoredHealthRecord } from "./types";

const fieldError = (field: string, reason: string) => ({ field, reason });
const inRange = (value: number | undefined, min: number, max: number) => value === undefined || (Number.isFinite(value) && value >= min && value <= max);

export function validatePayload(payload: HealthPayload) {
  const errors: Array<{ field: string; reason: string }> = [];
  if ("note" in payload && payload.note && payload.note.length > 2000) errors.push(fieldError("note", "메모는 2,000자 이하여야 합니다."));
  switch (payload.type) {
    case "blood_pressure":
      if (!inRange(payload.systolicMmHg, 40, 300)) errors.push(fieldError("systolicMmHg", "수축기 혈압은 40~300 사이여야 합니다."));
      if (!inRange(payload.diastolicMmHg, 20, 200)) errors.push(fieldError("diastolicMmHg", "이완기 혈압은 20~200 사이여야 합니다."));
      if (payload.diastolicMmHg >= payload.systolicMmHg) errors.push(fieldError("diastolicMmHg", "이완기 혈압은 수축기보다 작아야 합니다."));
      if (!inRange(payload.pulseBpm, 20, 250)) errors.push(fieldError("pulseBpm", "맥박은 20~250 사이여야 합니다."));
      break;
    case "blood_glucose":
      if (!inRange(payload.valueMgDl, 20, 1000)) errors.push(fieldError("valueMgDl", "혈당은 20~1,000 사이여야 합니다."));
      if (payload.timing === "after_meal" && !inRange(payload.minutesAfterMeal, 0, 480)) errors.push(fieldError("minutesAfterMeal", "식후 경과 시간을 입력해 주세요."));
      break;
    case "body_measurement":
      if ([payload.heightCm, payload.weightKg, payload.bodyFatPercent, payload.skeletalMuscleKg, payload.waistCm].every((v) => v === undefined)) errors.push(fieldError("bodyMeasurement", "측정값을 하나 이상 입력해 주세요."));
      if (!inRange(payload.heightCm, 30, 250)) errors.push(fieldError("heightCm", "키는 30~250cm 사이여야 합니다."));
      if (!inRange(payload.weightKg, 1, 500)) errors.push(fieldError("weightKg", "체중은 1~500kg 사이여야 합니다."));
      if (!inRange(payload.bodyFatPercent, 0, 80)) errors.push(fieldError("bodyFatPercent", "체지방률은 0~80% 사이여야 합니다."));
      break;
    case "lab_result":
      if (!payload.testName.trim()) errors.push(fieldError("testName", "검사명을 입력해 주세요."));
      if (payload.value === "") errors.push(fieldError("value", "검사값을 입력해 주세요."));
      break;
    case "vaccination":
      if (!payload.vaccineName.trim()) errors.push(fieldError("vaccineName", "접종명을 입력해 주세요."));
      if (!inRange(payload.doseNumber, 1, 20)) errors.push(fieldError("doseNumber", "접종 차수는 1~20 사이여야 합니다."));
      break;
    case "health_screening":
      if (!payload.screeningName.trim()) errors.push(fieldError("screeningName", "검진명을 입력해 주세요."));
      if (payload.summary && payload.summary.length > 10000) errors.push(fieldError("summary", "요약은 10,000자 이하여야 합니다."));
      break;
    case "pain":
      if (!payload.bodyArea.trim()) errors.push(fieldError("bodyArea", "통증 부위를 입력해 주세요."));
      if (!Number.isInteger(payload.intensity) || payload.intensity < 0 || payload.intensity > 10) errors.push(fieldError("intensity", "통증 강도는 0~10 사이여야 합니다."));
      break;
    case "walking":
      if ([payload.steps, payload.distanceKm, payload.durationMinutes].every((v) => v === undefined)) errors.push(fieldError("walking", "걸음 수, 거리 또는 시간을 하나 이상 입력해 주세요."));
      if (!inRange(payload.steps, 0, 200000)) errors.push(fieldError("steps", "걸음 수는 0~200,000 사이여야 합니다."));
      if (!inRange(payload.distanceKm, 0, 500)) errors.push(fieldError("distanceKm", "거리는 0~500km 사이여야 합니다."));
      if (!inRange(payload.durationMinutes, 0, 1440)) errors.push(fieldError("durationMinutes", "시간은 0~1,440분 사이여야 합니다."));
      break;
    case "note":
      if (!payload.text.trim()) errors.push(fieldError("text", "내용을 입력해 주세요."));
      if (payload.text.length > 20000) errors.push(fieldError("text", "내용은 20,000자 이하여야 합니다."));
  }
  return errors;
}

export class HealthRecordService {
  async query(profileId: string): Promise<LocalResult<HealthRecordView[]>> {
    try {
      const db = await openLocalDatabase();
      const key = await getOrCreateDataKey(db);
      const records = await listRecordsForProfile(db, profileId);
      const values = await Promise.all(records.map(async (record) => ({
        ...record,
        payload: await decryptJson<HealthPayload>(key, record.payloadCiphertext, `healthRecord:${record.id}:payload`),
      })));
      return { ok: true, value: values };
    } catch {
      return { ok: false, error: { code: "DECRYPTION_FAILED", message: "저장된 건강기록을 불러오지 못했습니다.", retryable: true } };
    }
  }

  async create(input: CreateHealthRecordInput): Promise<LocalResult<HealthRecordView>> {
    if (!input.householdId || !input.profileId || Number.isNaN(Date.parse(input.recordedAt))) {
      return { ok: false, error: { code: "VALIDATION_ERROR", message: "기록 대상과 날짜를 확인해 주세요.", retryable: false } };
    }
    const fieldErrors = validatePayload(input.payload);
    if (fieldErrors.length) return { ok: false, error: { code: "VALIDATION_ERROR", message: "입력값을 확인해 주세요.", fieldErrors, retryable: false } };
    try {
      const db = await openLocalDatabase();
      const key = await getOrCreateDataKey(db);
      const id = crypto.randomUUID();
      const recordType = input.payload.type;
      const hash = await canonicalHash(input.payload);
      const candidates = await findCandidates(db, input.profileId, recordType, input.recordedAt);
      for (const candidate of candidates) {
        const candidateHash = await decryptJson<string>(key, candidate.canonicalPayloadHashCiphertext, `healthRecord:${candidate.id}:hash`);
        if (!candidate.deletedAt && candidateHash === hash && input.duplicatePolicy === "reject") {
          return { ok: false, error: { code: "DUPLICATE_RECORD", message: "같은 날짜에 동일한 기록이 이미 있습니다.", retryable: false } };
        }
      }
      const now = new Date().toISOString();
      const record: StoredHealthRecord = {
        id, householdId: input.householdId, profileId: input.profileId, recordType, schemaVersion: 1,
        recordedAt: input.recordedAt, source: input.source, payloadCiphertext: await encryptJson(key, input.payload, `healthRecord:${id}:payload`),
        canonicalPayloadHashCiphertext: await encryptJson(key, hash, `healthRecord:${id}:hash`), sourceDocumentId: input.sourceDocumentId ?? null,
        createdAt: now, updatedAt: now, deletedAt: null, version: 1,
      };
      const eventId = crypto.randomUUID();
      await saveRecordAndEvent(db, record, {
        id: eventId, householdId: input.householdId, entityType: "healthRecord", entityId: id, operation: "create",
        beforeCiphertext: null, afterCiphertext: await encryptJson(key, record, `changeEvent:${eventId}:after`), occurredAt: now, transactionId: crypto.randomUUID(),
      });
      return { ok: true, value: { ...record, payload: input.payload } };
    } catch (cause) {
      const quota = cause instanceof DOMException && cause.name === "QuotaExceededError";
      return { ok: false, error: { code: quota ? "STORAGE_QUOTA_EXCEEDED" : "STORAGE_PERMISSION_DENIED", message: quota ? "브라우저 저장 공간이 부족합니다." : "이 브라우저에 기록을 저장할 수 없습니다.", retryable: !quota } };
    }
  }
}
