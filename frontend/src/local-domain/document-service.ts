import { decryptJson, encryptJson, sha256Bytes } from "../local-storage/crypto/record-crypto";
import { deleteDocumentMetadata, getDocumentMetadata, getOrCreateDataKey, listDocumentsForProfile, openLocalDatabase, saveDocumentMetadata } from "../local-storage/indexeddb/database";
import { deleteEncryptedDocument, readEncryptedDocument, writeEncryptedDocument } from "../local-storage/opfs/document-files";
import type { HealthDocumentView, LocalResult, StoredHealthDocument } from "./types";

const ALLOWED = new Set(["image/jpeg", "image/png"]);
const MAX_BYTES = 20 * 1024 * 1024;

export class DocumentService {
  async save(input: { householdId: string; profileId: string; file: File; capturedAt?: string }): Promise<LocalResult<HealthDocumentView>> {
    if (!ALLOWED.has(input.file.type)) return { ok: false, error: { code: "VALIDATION_ERROR", message: "JPEG 또는 PNG 파일만 등록할 수 있습니다.", retryable: false } };
    if (!input.file.size || input.file.size > MAX_BYTES) return { ok: false, error: { code: "VALIDATION_ERROR", message: "파일은 20MB 이하여야 합니다.", retryable: false } };
    const id = crypto.randomUUID(); const fileId = crypto.randomUUID(); const now = new Date().toISOString();
    try {
      const estimate = await navigator.storage.estimate();
      if (estimate.quota && estimate.usage && estimate.quota - estimate.usage < input.file.size * 1.3) return { ok: false, error: { code: "STORAGE_QUOTA_EXCEEDED", message: "브라우저 저장 공간이 부족합니다.", retryable: false } };
      const bytes = new Uint8Array(await input.file.arrayBuffer());
      const db = await openLocalDatabase(); const key = await getOrCreateDataKey(db);
      const chunkCount = await writeEncryptedDocument(fileId, bytes, key);
      const document: StoredHealthDocument = { id, householdId: input.householdId, profileId: input.profileId, encryptedFileId: fileId, originalNameCiphertext: await encryptJson(key, input.file.name, `document:${id}:name`), mimeType: input.file.type as "image/jpeg" | "image/png", plaintextSize: input.file.size, plaintextSha256Ciphertext: await encryptJson(key, await sha256Bytes(bytes), `document:${id}:sha256`), capturedAt: input.capturedAt || null, createdAt: now, deletedAt: null, version: 1 };
      try { await saveDocumentMetadata(db, document, { id: fileId, documentId: id, state: "committed", chunkCount, createdAt: now }); }
      catch (error) { await deleteEncryptedDocument(fileId).catch(() => undefined); throw error; }
      return { ok: true, value: { ...document, originalName: input.file.name } };
    } catch (cause) {
      const message = cause instanceof DOMException && cause.name === "VersionError"
        ? "다른 이어봄 탭을 닫고 이 페이지를 새로고침한 뒤 다시 시도해 주세요."
        : "원본 서류를 이 브라우저에 저장하지 못했습니다.";
      return { ok: false, error: { code: "STORAGE_PERMISSION_DENIED", message, retryable: true } };
    }
  }

  async list(profileId: string): Promise<LocalResult<HealthDocumentView[]>> {
    try {
      const db = await openLocalDatabase(); const key = await getOrCreateDataKey(db);
      const documents = await listDocumentsForProfile(db, profileId);
      return { ok: true, value: await Promise.all(documents.map(async (item) => ({ ...item, originalName: await decryptJson<string>(key, item.originalNameCiphertext, `document:${item.id}:name`) }))) };
    } catch { return { ok: false, error: { code: "DECRYPTION_FAILED", message: "원본 서류 목록을 불러오지 못했습니다.", retryable: true } }; }
  }

  async open(documentId: string): Promise<LocalResult<File>> {
    try {
      const db = await openLocalDatabase(); const key = await getOrCreateDataKey(db); const document = await getDocumentMetadata(db, documentId);
      if (!document || document.deletedAt) return { ok: false, error: { code: "NOT_FOUND", message: "원본 서류를 찾을 수 없습니다.", retryable: false } };
      const name = await decryptJson<string>(key, document.originalNameCiphertext, `document:${document.id}:name`);
      const bytes = await readEncryptedDocument(document.encryptedFileId, key);
      return { ok: true, value: new File([bytes], name, { type: document.mimeType }) };
    } catch { return { ok: false, error: { code: "DECRYPTION_FAILED", message: "원본 서류를 열지 못했습니다.", retryable: true } }; }
  }

  async remove(documentId: string): Promise<LocalResult<void>> {
    try {
      const db = await openLocalDatabase(); const document = await getDocumentMetadata(db, documentId);
      if (!document) return { ok: false, error: { code: "NOT_FOUND", message: "이미 삭제된 서류입니다.", retryable: false } };
      await deleteEncryptedDocument(document.encryptedFileId); await deleteDocumentMetadata(db, documentId, document.encryptedFileId);
      return { ok: true, value: undefined };
    } catch { return { ok: false, error: { code: "STORAGE_PERMISSION_DENIED", message: "원본 서류를 삭제하지 못했습니다.", retryable: true } }; }
  }
}
