import type {
  EncryptedLocalRecord,
  EncryptedRecordRepository,
} from "./contracts";

const DATABASE_VERSION = 1;
const ENCRYPTED_RECORD_STORE = "encrypted-records";
const APP_META_STORE = "app-meta";

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

  public async delete(recordId: string): Promise<void> {
    const database = await this.open();

    await runRequest(
      database
        .transaction(ENCRYPTED_RECORD_STORE, "readwrite")
        .objectStore(ENCRYPTED_RECORD_STORE)
        .delete(recordId),
    );
  }

  public close(): void {
    void this.databasePromise?.then((database) => database.close());
    this.databasePromise = undefined;
  }

  private open(): Promise<IDBDatabase> {
    if (!this.databasePromise) {
      this.databasePromise = openDatabase(this.indexedDb, this.databaseName);
    }

    return this.databasePromise;
  }
}

function openDatabase(indexedDb: IDBFactory, databaseName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDb.open(databaseName, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;

      if (!database.objectStoreNames.contains(ENCRYPTED_RECORD_STORE)) {
        database.createObjectStore(ENCRYPTED_RECORD_STORE, { keyPath: "id" });
      }

      if (!database.objectStoreNames.contains(APP_META_STORE)) {
        database.createObjectStore(APP_META_STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB를 열 수 없습니다."));
    request.onblocked = () => reject(new Error("IndexedDB 버전 변경이 다른 탭에 의해 차단되었습니다."));
  });
}

function runRequest<T = IDBValidKey>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB 요청에 실패했습니다."));
  });
}

function assertEncryptedRecord(record: EncryptedLocalRecord): void {
  if (record.encryptedPayload.algorithm !== "A256GCM") {
    throw new Error("지원하지 않는 암호화 알고리즘입니다.");
  }
  if (!record.encryptedPayload.iv || !record.encryptedPayload.ciphertext) {
    throw new Error("암호화된 레코드에는 IV와 ciphertext가 필요합니다.");
  }
  if ("plaintext" in record || "payload" in record) {
    throw new Error("평문 payload는 IndexedDB 저장 계약에 포함할 수 없습니다.");
  }
}
