import type { EncryptedRecordRepository, EncryptedValue } from "./contracts";
import type { LocalDocument, LocalResult } from "./domainContracts";
import type { JsonCipher } from "./jsonCipher";

const CHUNK_BYTES = 1024 * 1024;

export interface DocumentFileSnapshot {
  documentId: string;
  profileId: string;
  content: string;
}

export interface DocumentFileStore {
  write(documentId: string, profileId: string, content: string): Promise<void>;
  read(documentId: string): Promise<string | undefined>;
  delete(documentId: string): Promise<void>;
  list(): Promise<DocumentFileSnapshot[]>;
  replaceAll(files: DocumentFileSnapshot[]): Promise<void>;
}

export class OpfsDocumentFileStore implements DocumentFileStore {
  public constructor(private readonly root: FileSystemDirectoryHandle) {}

  public async write(documentId: string, profileId: string, content: string): Promise<void> {
    const directory = await this.root.getDirectoryHandle("ieobom-documents", { create: true });
    const handle = await directory.getFileHandle(`${documentId}.json`, { create: true });
    const writable = await handle.createWritable();
    await writable.write(JSON.stringify({ profileId, content }));
    await writable.close();
  }

  public async read(documentId: string): Promise<string | undefined> {
    try {
      const directory = await this.root.getDirectoryHandle("ieobom-documents");
      const file = await (await directory.getFileHandle(`${documentId}.json`)).getFile();
      const stored = JSON.parse(await file.text()) as { content: string };
      return stored.content;
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "NotFoundError") return undefined;
      throw caught;
    }
  }

  public async delete(documentId: string): Promise<void> {
    try {
      const directory = await this.root.getDirectoryHandle("ieobom-documents");
      await directory.removeEntry(`${documentId}.json`);
    } catch (caught) {
      if (!(caught instanceof DOMException && caught.name === "NotFoundError")) throw caught;
    }
  }

  public async list(): Promise<DocumentFileSnapshot[]> {
    const values: DocumentFileSnapshot[] = [];
    let directory: FileSystemDirectoryHandle;
    try {
      directory = await this.root.getDirectoryHandle("ieobom-documents");
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "NotFoundError") return values;
      throw caught;
    }
    for await (const [, entry] of directory.entries()) {
      if (entry.kind !== "file") continue;
      const file = await entry.getFile();
      const stored = JSON.parse(await file.text()) as { profileId: string; content: string };
      values.push({ documentId: entry.name.replace(/\.json$/u, ""), ...stored });
    }
    return values;
  }

  public async replaceAll(files: DocumentFileSnapshot[]): Promise<void> {
    const directory = await this.root.getDirectoryHandle("ieobom-documents", { create: true });
    for await (const [name] of directory.entries()) await directory.removeEntry(name, { recursive: true });
    for (const file of files) await this.write(file.documentId, file.profileId, file.content);
  }
}

export class LocalDocumentService {
  public constructor(
    private readonly repository: EncryptedRecordRepository,
    private readonly cipher: JsonCipher,
    private readonly files: DocumentFileStore,
  ) {}

  public async save(input: { householdId: string; profileId: string; file: Blob; fileName: string }): Promise<LocalResult<LocalDocument>> {
    if (!input.householdId || !input.profileId || !input.fileName || input.file.size === 0) {
      return failure("파일, 가정과 구성원 프로필이 필요합니다.");
    }
    const id = crypto.randomUUID();
    const chunks: EncryptedValue[] = [];
    for (let offset = 0; offset < input.file.size; offset += CHUNK_BYTES) {
      const bytes = new Uint8Array(await input.file.slice(offset, offset + CHUNK_BYTES).arrayBuffer());
      chunks.push(await this.cipher.encrypt(toBase64(bytes)));
    }
    const now = new Date().toISOString();
    const document: LocalDocument = {
      id,
      householdId: input.householdId,
      profileId: input.profileId,
      fileName: input.fileName,
      mimeType: input.file.type || "application/octet-stream",
      byteSize: input.file.size,
      chunkCount: chunks.length,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    try {
      await this.files.write(id, input.profileId, JSON.stringify(chunks));
      await this.repository.put({
        id,
        householdRef: input.householdId,
        profileRef: input.profileId,
        recordType: "document",
        schemaVersion: 1,
        encryptedPayload: await this.cipher.encrypt(document),
        createdAt: now,
        updatedAt: now,
      });
      return { ok: true, value: document };
    } catch {
      await this.files.delete(id);
      return failure("문서를 암호화해 OPFS에 저장하지 못했습니다.", true, "ENCRYPTION_FAILED");
    }
  }

  public async list(profileId?: string): Promise<LocalResult<LocalDocument[]>> {
    const records = await this.repository.list(profileId ? { profileRef: profileId, recordType: "document" } : { recordType: "document" });
    const values: LocalDocument[] = [];
    for (const record of records) {
      try {
        values.push(await this.cipher.decrypt<LocalDocument>(record.encryptedPayload));
      } catch {
        return failure("문서 메타데이터를 복호화하지 못했습니다.", false, "DECRYPTION_FAILED");
      }
    }
    return { ok: true, value: values.sort((left, right) => right.createdAt.localeCompare(left.createdAt)) };
  }

  public async read(document: LocalDocument): Promise<LocalResult<Blob>> {
    const content = await this.files.read(document.id);
    if (!content) return failure("문서 원본을 찾을 수 없습니다.", false, "NOT_FOUND");
    try {
      const encryptedChunks = JSON.parse(content) as EncryptedValue[];
      const parts: Uint8Array<ArrayBuffer>[] = [];
      for (const chunk of encryptedChunks) parts.push(fromBase64(await this.cipher.decrypt<string>(chunk)));
      return { ok: true, value: new Blob(parts, { type: document.mimeType }) };
    } catch {
      return failure("문서 원본을 복호화하지 못했습니다.", false, "DECRYPTION_FAILED");
    }
  }

  /**
   * 문서 id 하나로 원본과 파일명을 함께 꺼낸다.
   *
   * `read()` 는 `LocalDocument` 를 받는다 — 목록을 이미 들고 있는 화면에는 그게 맞다.
   * 그런데 대화에서 "그 서류 보여 줘" 로 들어오는 쪽은 **id 밖에 없다.** 그때마다
   * 호출부가 `list()` 로 찾아 넘기게 두면 같은 코드가 화면마다 복사된다.
   */
  public async readById(documentId: string): Promise<LocalResult<{ file: Blob; fileName: string }>> {
    const documents = await this.list();
    if (!documents.ok) return documents;
    const document = documents.value.find((candidate) => candidate.id === documentId);
    if (!document) return failure("문서를 찾을 수 없습니다.", false, "NOT_FOUND");
    const file = await this.read(document);
    if (!file.ok) return file;
    return { ok: true, value: { file: file.value, fileName: document.fileName } };
  }

  public async delete(documentId: string): Promise<LocalResult<{ deleted: true }>> {
    await this.files.delete(documentId);
    await this.repository.delete(documentId);
    return { ok: true, value: { deleted: true } };
  }
}

function failure(
  message: string,
  retryable = false,
  code: "VALIDATION_ERROR" | "NOT_FOUND" | "ENCRYPTION_FAILED" | "DECRYPTION_FAILED" = "VALIDATION_ERROR",
): LocalResult<never> {
  return { ok: false, error: { code, message, retryable } };
}

function toBase64(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
