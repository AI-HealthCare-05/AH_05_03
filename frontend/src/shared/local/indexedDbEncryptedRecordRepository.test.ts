import { indexedDB } from "fake-indexeddb";
import { describe, expect, it } from "vitest";

import type { EncryptedLocalRecord } from "./contracts";
import { IndexedDbEncryptedRecordRepository } from "./indexedDbEncryptedRecordRepository";

function createEncryptedRecord(): EncryptedLocalRecord {
  return {
    id: crypto.randomUUID(),
    householdRef: crypto.randomUUID(),
    profileRef: crypto.randomUUID(),
    recordType: "health-record",
    schemaVersion: 1,
    encryptedPayload: {
      algorithm: "A256GCM",
      keyVersion: 1,
      iv: "synthetic-iv",
      ciphertext: "synthetic-ciphertext",
    },
    createdAt: "2026-08-19T00:00:00.000Z",
    updatedAt: "2026-08-19T00:00:00.000Z",
  };
}

describe("IndexedDbEncryptedRecordRepository", () => {
  it("암호화된 envelope만 저장하고 읽는다", async () => {
    const repository = new IndexedDbEncryptedRecordRepository(
      "ieobom-test-" + crypto.randomUUID(),
      indexedDB,
    );
    const record = createEncryptedRecord();

    await repository.put(record);

    const stored = await repository.get(record.id);
    expect(stored).toEqual(record);
    expect(stored).not.toHaveProperty("payload");
    expect(stored).not.toHaveProperty("plaintext");
    repository.close();
  });

  it("ciphertext가 없는 레코드를 거절한다", async () => {
    const repository = new IndexedDbEncryptedRecordRepository(
      "ieobom-test-" + crypto.randomUUID(),
      indexedDB,
    );
    const record = createEncryptedRecord();
    record.encryptedPayload.ciphertext = "";

    await expect(repository.put(record)).rejects.toThrow("ciphertext");
    repository.close();
  });

  it("프로필과 레코드 유형으로 암호문 envelope를 조회하고 전체 삭제한다", async () => {
    const repository = new IndexedDbEncryptedRecordRepository(
      "ieobom-test-" + crypto.randomUUID(),
      indexedDB,
    );
    const first = createEncryptedRecord();
    const second = { ...createEncryptedRecord(), profileRef: first.profileRef };
    await repository.put(first);
    await repository.put(second);

    const records = await repository.list({
      profileRef: first.profileRef,
      recordType: "health-record",
    });
    expect(records).toHaveLength(2);

    await repository.clear();
    expect(await repository.list()).toEqual([]);

    await repository.replaceAll([first]);
    expect(await repository.list()).toEqual([first]);
    repository.close();
  });
});
