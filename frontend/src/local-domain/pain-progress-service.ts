import { decryptJson, encryptJson } from "../local-storage/crypto/record-crypto";
import { addPainProgress, getOrCreateDataKey, listPainProgress, openLocalDatabase } from "../local-storage/indexeddb/database";
import type { LocalResult, PainProgressPayload, PainProgressView, StoredPainProgress } from "./types";

export class PainProgressService {
  async list(painRecordId: string): Promise<LocalResult<PainProgressView[]>> {
    try {
      const db = await openLocalDatabase(); const key = await getOrCreateDataKey(db);
      const stored = await listPainProgress(db, painRecordId);
      const value = await Promise.all(stored.map(async (item) => ({ ...item, payload: await decryptJson<PainProgressPayload>(key, item.payloadCiphertext, `painProgress:${item.id}:payload`) })));
      return { ok: true, value };
    } catch { return { ok: false, error: { code: "DECRYPTION_FAILED", message: "통증 경과를 불러오지 못했습니다.", retryable: true } }; }
  }

  async create(input: { painRecordId: string; profileId: string; recordedAt: string; payload: PainProgressPayload }): Promise<LocalResult<PainProgressView>> {
    if (!input.painRecordId || !input.profileId || Number.isNaN(Date.parse(input.recordedAt)) || !Number.isInteger(input.payload.intensity) || input.payload.intensity < 0 || input.payload.intensity > 10) {
      return { ok: false, error: { code: "VALIDATION_ERROR", message: "경과 날짜와 통증 강도(0~10)를 확인해 주세요.", retryable: false } };
    }
    try {
      const db = await openLocalDatabase(); const key = await getOrCreateDataKey(db); const id = crypto.randomUUID(); const now = new Date().toISOString();
      const stored: StoredPainProgress = { id, painRecordId: input.painRecordId, profileId: input.profileId, recordedAt: input.recordedAt, payloadCiphertext: await encryptJson(key, input.payload, `painProgress:${id}:payload`), createdAt: now, version: 1 };
      await addPainProgress(db, stored);
      return { ok: true, value: { ...stored, payload: input.payload } };
    } catch { return { ok: false, error: { code: "STORAGE_PERMISSION_DENIED", message: "통증 경과를 저장하지 못했습니다.", retryable: true } }; }
  }
}
