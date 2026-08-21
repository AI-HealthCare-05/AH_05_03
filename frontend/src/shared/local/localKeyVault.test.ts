import { indexedDB } from "fake-indexeddb";
import { describe, expect, it } from "vitest";

import { IndexedDbLocalKeyVault } from "./localKeyVault";

describe("IndexedDbLocalKeyVault", () => {
  it("브라우저 재실행을 가정해 다시 열어도 같은 비추출형 키로 복호화한다", async () => {
    const databaseName = "ieobom-key-vault-" + crypto.randomUUID();
    const firstVault = new IndexedDbLocalKeyVault(databaseName, indexedDB);
    const firstCipher = await firstVault.getOrCreateCipher();
    const encrypted = await firstCipher.encrypt({ privateValue: "로컬 전용" });
    firstVault.close();

    const reopenedVault = new IndexedDbLocalKeyVault(databaseName, indexedDB);
    const reopenedCipher = await reopenedVault.getOrCreateCipher();

    await expect(reopenedCipher.decrypt(encrypted)).resolves.toEqual({ privateValue: "로컬 전용" });
    reopenedVault.close();
  });
});
