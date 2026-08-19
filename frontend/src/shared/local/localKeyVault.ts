import { APP_META_STORE, openIeobomLocalDatabase } from "./indexedDbEncryptedRecordRepository";
import { AesGcmJsonCipher } from "./jsonCipher";

const DEVICE_KEY_ID = "device-master-key-v1";

interface StoredCryptoKey {
  key: typeof DEVICE_KEY_ID;
  value: CryptoKey;
}

export class IndexedDbLocalKeyVault {
  private databasePromise: Promise<IDBDatabase> | undefined;

  public constructor(
    private readonly databaseName = "ieobom-local",
    private readonly indexedDb: IDBFactory = globalThis.indexedDB,
    private readonly cryptoApi: Crypto = globalThis.crypto,
  ) {}

  public async getOrCreateCipher(): Promise<AesGcmJsonCipher> {
    const key = await this.getOrCreateKey();
    return new AesGcmJsonCipher(key, this.cryptoApi);
  }

  public close(): void {
    void this.databasePromise?.then((database) => database.close());
    this.databasePromise = undefined;
  }

  private async getOrCreateKey(): Promise<CryptoKey> {
    const candidate = await this.cryptoApi.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
    const database = await this.open();
    const transaction = database.transaction(APP_META_STORE, "readwrite");
    const store = transaction.objectStore(APP_META_STORE);

    return new Promise((resolve, reject) => {
      const request = store.get(DEVICE_KEY_ID);
      let selectedKey: CryptoKey = candidate;
      request.onsuccess = () => {
        const stored = request.result as StoredCryptoKey | undefined;
        if (stored?.value) {
          selectedKey = stored.value;
        } else {
          store.put({ key: DEVICE_KEY_ID, value: candidate } satisfies StoredCryptoKey);
        }
      };
      request.onerror = () => reject(request.error ?? new Error("로컬 암호화 키를 읽지 못했습니다."));
      transaction.oncomplete = () => resolve(selectedKey);
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("로컬 암호화 키를 저장하지 못했습니다."));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("로컬 암호화 키 저장이 취소되었습니다."));
    });
  }

  private open(): Promise<IDBDatabase> {
    if (!this.databasePromise) {
      this.databasePromise = openIeobomLocalDatabase(this.indexedDb, this.databaseName);
    }
    return this.databasePromise;
  }
}
