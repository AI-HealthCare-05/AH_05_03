import { decryptBytes, encryptBytes } from "../crypto/record-crypto";

const CHUNK_SIZE = 1024 * 1024;

async function documentDirectory(fileId: string, create: boolean) {
  const root = await navigator.storage.getDirectory();
  const v1 = await root.getDirectoryHandle("v1", { create });
  const documents = await v1.getDirectoryHandle("documents", { create });
  return documents.getDirectoryHandle(fileId, { create });
}

export async function writeEncryptedDocument(fileId: string, bytes: Uint8Array, key: CryptoKey) {
  const directory = await documentDirectory(fileId, true);
  const ivs: string[] = [];
  const chunkCount = Math.ceil(bytes.byteLength / CHUNK_SIZE);
  for (let index = 0; index < chunkCount; index += 1) {
    const encrypted = await encryptBytes(key, bytes.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE), `document:${fileId}:chunk:${index}`);
    ivs.push(encrypted.iv);
    const handle = await directory.getFileHandle(`chunk-${String(index).padStart(8, "0")}.bin`, { create: true });
    const writer = await handle.createWritable(); await writer.write(encrypted.ciphertext); await writer.close();
  }
  const metaHandle = await directory.getFileHandle("meta.json", { create: true });
  const writer = await metaHandle.createWritable(); await writer.write(JSON.stringify({ version: 1, chunkCount, ivs })); await writer.close();
  return chunkCount;
}

export async function readEncryptedDocument(fileId: string, key: CryptoKey) {
  const directory = await documentDirectory(fileId, false);
  const meta = JSON.parse(await (await (await directory.getFileHandle("meta.json")).getFile()).text()) as { chunkCount: number; ivs: string[] };
  const chunks: Uint8Array[] = [];
  for (let index = 0; index < meta.chunkCount; index += 1) {
    const file = await (await directory.getFileHandle(`chunk-${String(index).padStart(8, "0")}.bin`)).getFile();
    chunks.push(await decryptBytes(key, meta.ivs[index], new Uint8Array(await file.arrayBuffer()), `document:${fileId}:chunk:${index}`));
  }
  const size = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const merged = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength; }
  return merged;
}

export async function deleteEncryptedDocument(fileId: string) {
  const root = await navigator.storage.getDirectory();
  const v1 = await root.getDirectoryHandle("v1");
  const documents = await v1.getDirectoryHandle("documents");
  await documents.removeEntry(fileId, { recursive: true });
}
