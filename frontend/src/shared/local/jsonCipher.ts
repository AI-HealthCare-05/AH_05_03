import type { EncryptedValue } from "./contracts";

const IV_BYTES = 12;

export interface JsonCipher {
  encrypt<T>(value: T): Promise<EncryptedValue>;
  decrypt<T>(value: EncryptedValue): Promise<T>;
}

export class AesGcmJsonCipher implements JsonCipher {
  public constructor(
    private readonly key: CryptoKey,
    private readonly cryptoApi: Crypto = globalThis.crypto,
    private readonly keyVersion = 1,
  ) {}

  public static async create(cryptoApi: Crypto = globalThis.crypto): Promise<AesGcmJsonCipher> {
    const key = await cryptoApi.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
      "encrypt",
      "decrypt",
    ]);
    return new AesGcmJsonCipher(key, cryptoApi);
  }

  public async encrypt<T>(value: T): Promise<EncryptedValue> {
    const iv = this.cryptoApi.getRandomValues(new Uint8Array(IV_BYTES));
    const plaintext = new TextEncoder().encode(JSON.stringify(value));
    const ciphertext = await this.cryptoApi.subtle.encrypt({ name: "AES-GCM", iv }, this.key, plaintext);
    return {
      algorithm: "A256GCM",
      keyVersion: this.keyVersion,
      iv: toBase64Url(iv),
      ciphertext: toBase64Url(new Uint8Array(ciphertext)),
    };
  }

  public async decrypt<T>(value: EncryptedValue): Promise<T> {
    if (value.algorithm !== "A256GCM" || value.keyVersion !== this.keyVersion) {
      throw new Error("지원하지 않는 로컬 암호화 형식입니다.");
    }
    const plaintext = await this.cryptoApi.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64Url(value.iv) },
      this.key,
      fromBase64Url(value.ciphertext),
    );
    return JSON.parse(new TextDecoder().decode(plaintext)) as T;
  }
}

function toBase64Url(value: Uint8Array<ArrayBufferLike>): string {
  let binary = "";
  for (const byte of value) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
