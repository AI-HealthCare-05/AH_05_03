import type { StoredHealthRecord } from "../../local-domain/types";
import { createDataKey } from "../crypto/record-crypto";

const DB_NAME = "ieobom-local";
const DB_VERSION = 1;

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
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
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
