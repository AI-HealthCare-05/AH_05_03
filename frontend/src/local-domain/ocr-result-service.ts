import { encryptJson } from "../local-storage/crypto/record-crypto";
import { getOcrResult, getOrCreateDataKey, openLocalDatabase, putOcrResult } from "../local-storage/indexeddb/database";
import type { LocalResult, OcrContent, StoredOcrResult } from "./types";

export class OcrResultService {
  async saveDraft(documentId: string, content: OcrContent): Promise<LocalResult<StoredOcrResult>> {
    try {
      const db = await openLocalDatabase(); const key = await getOrCreateDataKey(db);
      const id = crypto.randomUUID(); const now = new Date().toISOString();
      const result: StoredOcrResult = { id, documentId, engine: "naver-clova-ocr", engineVersion: "V2-test", rawContentCiphertext: await encryptJson(key, content, `ocrResult:${id}:raw`), confirmedContentCiphertext: await encryptJson(key, content, `ocrResult:${id}:confirmed`), status: "draft", createdAt: now, confirmedAt: null, version: 1 };
      await putOcrResult(db, result); return { ok: true, value: result };
    } catch { return { ok: false, error: { code: "STORAGE_PERMISSION_DENIED", message: "서류 분석 초안을 저장하지 못했습니다.", retryable: true } }; }
  }

  async confirm(resultId: string, content: OcrContent): Promise<LocalResult<StoredOcrResult>> {
    try {
      const db = await openLocalDatabase(); const key = await getOrCreateDataKey(db); const existing = await getOcrResult(db, resultId);
      if (!existing) return { ok: false, error: { code: "NOT_FOUND", message: "서류 분석 초안을 찾을 수 없습니다.", retryable: false } };
      const confirmed: StoredOcrResult = { ...existing, confirmedContentCiphertext: await encryptJson(key, content, `ocrResult:${resultId}:confirmed`), status: "confirmed", confirmedAt: new Date().toISOString(), version: existing.version + 1 };
      await putOcrResult(db, confirmed); return { ok: true, value: confirmed };
    } catch { return { ok: false, error: { code: "ENCRYPTION_FAILED", message: "서류 분석 결과를 저장하지 못했습니다.", retryable: true } }; }
  }
}
