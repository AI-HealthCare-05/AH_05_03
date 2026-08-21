import { indexedDB } from "fake-indexeddb";
import { describe, expect, it } from "vitest";

import { IndexedDbEncryptedRecordRepository } from "./indexedDbEncryptedRecordRepository";
import { AesGcmJsonCipher } from "./jsonCipher";
import { LocalBackupService } from "./localBackupService";
import {
  LocalDocumentService,
  type DocumentFileSnapshot,
  type DocumentFileStore,
} from "./localDocumentService";

class MemoryDocumentFileStore implements DocumentFileStore {
  private values = new Map<string, DocumentFileSnapshot>();

  public async write(documentId: string, profileId: string, content: string): Promise<void> {
    this.values.set(documentId, { documentId, profileId, content });
  }

  public async read(documentId: string): Promise<string | undefined> {
    return this.values.get(documentId)?.content;
  }

  public async delete(documentId: string): Promise<void> {
    this.values.delete(documentId);
  }

  public async list(): Promise<DocumentFileSnapshot[]> {
    return [...this.values.values()];
  }

  public async replaceAll(files: DocumentFileSnapshot[]): Promise<void> {
    this.values = new Map(files.map((file) => [file.documentId, file]));
  }
}

describe("LocalDocumentService", () => {
  it("원본 문서를 청크 암호화하고 백업 파일로 함께 왕복한다", async () => {
    const sourceRepository = new IndexedDbEncryptedRecordRepository(
      `ieobom-document-source-${crypto.randomUUID()}`,
      indexedDB,
    );
    const sourceCipher = await AesGcmJsonCipher.create();
    const sourceFiles = new MemoryDocumentFileStore();
    const sourceDocuments = new LocalDocumentService(sourceRepository, sourceCipher, sourceFiles);
    const original = new Blob(["민감한 검진 결과"], { type: "text/plain" });
    const saved = await sourceDocuments.save({
      householdId: crypto.randomUUID(),
      profileId: crypto.randomUUID(),
      file: original,
      fileName: "검진.txt",
    });
    if (!saved.ok) throw new Error(saved.error.message);
    expect(JSON.stringify(await sourceFiles.list())).not.toContain("민감한 검진 결과");
    const read = await sourceDocuments.read(saved.value);
    expect(read.ok && await read.value.text()).toBe("민감한 검진 결과");

    const backup = await new LocalBackupService(
      sourceRepository,
      sourceCipher,
      crypto,
      sourceFiles,
    ).exportAll("correct horse battery staple");
    expect(await backup.text()).not.toContain("검진.txt");

    const targetRepository = new IndexedDbEncryptedRecordRepository(
      `ieobom-document-target-${crypto.randomUUID()}`,
      indexedDB,
    );
    const targetCipher = await AesGcmJsonCipher.create();
    const targetFiles = new MemoryDocumentFileStore();
    const preview = await new LocalBackupService(
      targetRepository,
      targetCipher,
      crypto,
      targetFiles,
    ).importAll(backup, "correct horse battery staple");
    expect(preview.totalFiles).toBe(1);
    const restoredDocuments = new LocalDocumentService(targetRepository, targetCipher, targetFiles);
    const restoredList = await restoredDocuments.list();
    if (!restoredList.ok) throw new Error(restoredList.error.message);
    const restored = await restoredDocuments.read(restoredList.value[0]);
    expect(restored.ok && await restored.value.text()).toBe("민감한 검진 결과");
    sourceRepository.close();
    targetRepository.close();
  });
});
