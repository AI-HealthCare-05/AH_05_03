import type { EncryptedValue } from "../../local-domain/types";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const toBase64Url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
const fromBase64Url = (value: string) => Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), (c) => c.charCodeAt(0));

export async function createDataKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export async function encryptJson(key: CryptoKey, value: unknown, aad: string): Promise<EncryptedValue> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(aad) },
    key,
    encoder.encode(JSON.stringify(value)),
  );
  return { algorithm: "A256GCM", keyVersion: 1, iv: toBase64Url(iv), ciphertext: toBase64Url(new Uint8Array(ciphertext)) };
}

export async function decryptJson<T>(key: CryptoKey, value: EncryptedValue, aad: string): Promise<T> {
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64Url(value.iv), additionalData: encoder.encode(aad) },
    key,
    fromBase64Url(value.ciphertext),
  );
  return JSON.parse(decoder.decode(plaintext)) as T;
}

export async function canonicalHash(value: unknown): Promise<string> {
  const canonical = JSON.stringify(value, Object.keys(value as object).sort());
  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(canonical));
  return toBase64Url(new Uint8Array(hash));
}
