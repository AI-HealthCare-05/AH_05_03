import type {
  EncryptedLocalRecord,
  EncryptedRecordQuery,
  EncryptedRecordRepository,
} from "./contracts";

const DATABASE_VERSION = 2;
const ENCRYPTED_RECORD_STORE = "encrypted-records";
export const APP_META_STORE = "app-meta";
const HOUSEHOLD_INDEX = "by-household";
const PROFILE_INDEX = "by-profile";
const RECORD_TYPE_INDEX = "by-record-type";
const PROFILE_RECORD_TYPE_INDEX = "by-profile-record-type";

export class IndexedDbEncryptedRecordRepository implements EncryptedRecordRepository {
  private databasePromise: Promise<IDBDatabase> | undefined;

  public constructor(
    private readonly databaseName = "ieobom-local",
    private readonly indexedDb: IDBFactory = globalThis.indexedDB,
  ) {}

  public async put(record: EncryptedLocalRecord): Promise<void> {
    assertEncryptedRecord(record);
    const database = await this.open();

    await runRequest(
      database
        .transaction(ENCRYPTED_RECORD_STORE, "readwrite")
        .objectStore(ENCRYPTED_RECORD_STORE)
        .put(record),
    );
  }

  public async get(recordId: string): Promise<EncryptedLocalRecord | undefined> {
    const database = await this.open();
    const result = await runRequest<EncryptedLocalRecord | undefined>(
      database
        .transaction(ENCRYPTED_RECORD_STORE, "readonly")
        .objectStore(ENCRYPTED_RECORD_STORE)
        .get(recordId),
    );

    return result;
  }

  public async list(query: EncryptedRecordQuery = {}): Promise<EncryptedLocalRecord[]> {
    const database = await this.open();
    const store = database.transaction(ENCRYPTED_RECORD_STORE, "readonly").objectStore(ENCRYPTED_RECORD_STORE);
    let request: IDBRequest<EncryptedLocalRecord[]>;

    if (query.profileRef && query.recordType) {
      request = store.index(PROFILE_RECORD_TYPE_INDEX).getAll([query.profileRef, query.recordType]);
    } else if (query.profileRef) {
      request = store.index(PROFILE_INDEX).getAll(query.profileRef);
    } else if (query.householdRef) {
      request = store.index(HOUSEHOLD_INDEX).getAll(query.householdRef);
    } else if (query.recordType) {
      request = store.index(RECORD_TYPE_INDEX).getAll(query.recordType);
    } else {
      request = store.getAll();
    }

    const records = await runRequest(request);
    return records
      .filter((record) => !query.householdRef || record.householdRef === query.householdRef)
      .filter((record) => !query.profileRef || record.profileRef === query.profileRef)
      .filter((record) => !query.recordType || record.recordType === query.recordType)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  public async delete(recordId: string): Promise<void> {
    const database = await this.open();

    await runRequest(
      database
        .transaction(ENCRYPTED_RECORD_STORE, "readwrite")
        .objectStore(ENCRYPTED_RECORD_STORE)
        .delete(recordId),
    );
  }

  public async clear(): Promise<void> {
    const database = await this.open();
    await runRequest(
      database.transaction(ENCRYPTED_RECORD_STORE, "readwrite").objectStore(ENCRYPTED_RECORD_STORE).clear(),
    );
  }

  public async replaceAll(records: EncryptedLocalRecord[]): Promise<void> {
    for (const record of records) {
      assertEncryptedRecord(record);
    }
    const database = await this.open();
    const transaction = database.transaction(ENCRYPTED_RECORD_STORE, "readwrite");
    const store = transaction.objectStore(ENCRYPTED_RECORD_STORE);
    store.clear();
    for (const record of records) {
      store.put(record);
    }
    await waitForTransaction(transaction);
  }

  public close(): void {
    void this.databasePromise?.then((database) => database.close());
    this.databasePromise = undefined;
  }

  private open(): Promise<IDBDatabase> {
    if (!this.databasePromise) {
      this.databasePromise = openIeobomLocalDatabase(this.indexedDb, this.databaseName);
    }

    return this.databasePromise;
  }
}

export function openIeobomLocalDatabase(
  indexedDb: IDBFactory,
  databaseName: string,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDb.open(databaseName, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;

      const store = database.objectStoreNames.contains(ENCRYPTED_RECORD_STORE)
        ? request.transaction!.objectStore(ENCRYPTED_RECORD_STORE)
        : database.createObjectStore(ENCRYPTED_RECORD_STORE, { keyPath: "id" });

      createIndexIfMissing(store, HOUSEHOLD_INDEX, "householdRef");
      createIndexIfMissing(store, PROFILE_INDEX, "profileRef");
      createIndexIfMissing(store, RECORD_TYPE_INDEX, "recordType");
      createIndexIfMissing(store, PROFILE_RECORD_TYPE_INDEX, ["profileRef", "recordType"]);

      if (!database.objectStoreNames.contains(APP_META_STORE)) {
        database.createObjectStore(APP_META_STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB를 열 수 없습니다."));
    request.onblocked = () => reject(new Error("IndexedDB 버전 변경이 다른 탭에 의해 차단되었습니다."));
  });
}

function createIndexIfMissing(store: IDBObjectStore, name: string, keyPath: string | string[]): void {
  if (!store.indexNames.contains(name)) {
    store.createIndex(name, keyPath, { unique: false });
  }
}

function runRequest<T = IDBValidKey>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB 요청에 실패했습니다."));
  });
}

function waitForTransaction(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB 트랜잭션에 실패했습니다."));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB 트랜잭션이 취소되었습니다."));
  });
}

function assertEncryptedRecord(record: EncryptedLocalRecord): void {
  if (record.encryptedPayload.algorithm !== "A256GCM") {
    throw new Error("지원하지 않는 암호화 알고리즘입니다.");
  }
  if (!record.encryptedPayload.iv || !record.encryptedPayload.ciphertext) {
    throw new Error("암호화된 레코드에는 IV와 ciphertext가 필요합니다.");
  }
  if (!record.householdRef || !record.profileRef) {
    throw new Error("암호화된 레코드에는 householdRef와 profileRef가 필요합니다.");
  }
  if ("plaintext" in record || "payload" in record) {
    throw new Error("평문 payload는 IndexedDB 저장 계약에 포함할 수 없습니다.");
  }
}
