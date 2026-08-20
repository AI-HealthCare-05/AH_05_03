import type { StoredHealthDocument, StoredHealthRecord, StoredOcrResult, StoredPainProgress } from "../../local-domain/types";
import { createDataKey } from "../crypto/record-crypto";

const DB_NAME = "ieobom-local";
const DB_VERSION = 4;

export async function openLocalDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("healthRecords")) {
        const store = db.createObjectStore("healthRecords", { keyPath: "id" });
        store.createIndex("profileRecordedAt", ["profileId", "recordedAt"]);
        store.createIndex("profileTypeRecordedAt", ["profileId", "recordType", "recordedAt"]);
      }
      if (!db.objectStoreNames.contains("changeEvents")) {
        const store = db.createObjectStore("changeEvents", { keyPath: "id" });
        store.createIndex("householdOccurredAt", ["householdId", "occurredAt"]);
      }
      if (!db.objectStoreNames.contains("cryptoMetadata")) db.createObjectStore("cryptoMetadata", { keyPath: "id" });
      if (!db.objectStoreNames.contains("documents")) {
        const store = db.createObjectStore("documents", { keyPath: "id" });
        store.createIndex("profileCreatedAt", ["profileId", "createdAt"]);
        store.createIndex("encryptedFileId", "encryptedFileId", { unique: true });
      }
      if (!db.objectStoreNames.contains("fileMetadata")) db.createObjectStore("fileMetadata", { keyPath: "id" });
      if (!db.objectStoreNames.contains("ocrResults")) {
        const store = db.createObjectStore("ocrResults", { keyPath: "id" });
        store.createIndex("documentId", "documentId");
        store.createIndex("documentStatus", ["documentId", "status"]);
      }
      if (!db.objectStoreNames.contains("painProgress")) {
        const store = db.createObjectStore("painProgress", { keyPath: "id" });
        store.createIndex("painRecordedAt", ["painRecordId", "recordedAt"]);
      }
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new DOMException("기존 탭이 로컬 데이터베이스 업데이트를 막고 있습니다.", "VersionError"));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getOrCreateDataKey(db: IDBDatabase): Promise<CryptoKey> {
  const existing = await requestResult<{ id: string; key: CryptoKey } | undefined>(db.transaction("cryptoMetadata").objectStore("cryptoMetadata").get("active-dek"));
  if (existing) return existing.key;
  const key = await createDataKey();
  await requestResult(db.transaction("cryptoMetadata", "readwrite").objectStore("cryptoMetadata").put({ id: "active-dek", key, keyVersion: 1 }));
  return key;
}

export async function findCandidates(db: IDBDatabase, profileId: string, recordType: string, recordedAt: string): Promise<StoredHealthRecord[]> {
  const index = db.transaction("healthRecords").objectStore("healthRecords").index("profileTypeRecordedAt");
  return requestResult(index.getAll(IDBKeyRange.only([profileId, recordType, recordedAt])));
}

export async function listRecordsForProfile(db: IDBDatabase, profileId: string): Promise<StoredHealthRecord[]> {
  const index = db.transaction("healthRecords").objectStore("healthRecords").index("profileRecordedAt");
  const records: StoredHealthRecord[] = await requestResult(
    index.getAll(IDBKeyRange.bound([profileId, ""], [profileId, "\uffff"])),
  );
  return records.filter((record) => !record.deletedAt).sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
}

export async function saveRecordAndEvent(db: IDBDatabase, record: StoredHealthRecord, event: object): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(["healthRecords", "changeEvents"], "readwrite");
    tx.objectStore("healthRecords").add(record);
    tx.objectStore("changeEvents").add(event);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function saveDocumentMetadata(db: IDBDatabase, document: StoredHealthDocument, fileMetadata: object): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(["documents", "fileMetadata"], "readwrite");
    tx.objectStore("documents").add(document);
    tx.objectStore("fileMetadata").add(fileMetadata);
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
  });
}

export async function listDocumentsForProfile(db: IDBDatabase, profileId: string): Promise<StoredHealthDocument[]> {
  const index = db.transaction("documents").objectStore("documents").index("profileCreatedAt");
  const values: StoredHealthDocument[] = await requestResult(index.getAll(IDBKeyRange.bound([profileId, ""], [profileId, "\uffff"])));
  return values.filter((item) => !item.deletedAt).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getDocumentMetadata(db: IDBDatabase, documentId: string): Promise<StoredHealthDocument | undefined> {
  return requestResult(db.transaction("documents").objectStore("documents").get(documentId));
}

export async function deleteDocumentMetadata(db: IDBDatabase, documentId: string, fileId: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(["documents", "fileMetadata"], "readwrite");
    tx.objectStore("documents").delete(documentId); tx.objectStore("fileMetadata").delete(fileId);
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
  });
}

export async function putOcrResult(db: IDBDatabase, result: StoredOcrResult): Promise<void> {
  await requestResult(db.transaction("ocrResults", "readwrite").objectStore("ocrResults").put(result));
}

export async function getOcrResult(db: IDBDatabase, resultId: string): Promise<StoredOcrResult | undefined> {
  return requestResult(db.transaction("ocrResults").objectStore("ocrResults").get(resultId));
}

export async function addPainProgress(db: IDBDatabase, progress: StoredPainProgress): Promise<void> {
  await requestResult(db.transaction("painProgress", "readwrite").objectStore("painProgress").add(progress));
}

export async function listPainProgress(db: IDBDatabase, painRecordId: string): Promise<StoredPainProgress[]> {
  const index = db.transaction("painProgress").objectStore("painProgress").index("painRecordedAt");
  return requestResult(index.getAll(IDBKeyRange.bound([painRecordId, ""], [painRecordId, "\uffff"])));
}
