import { indexedDB } from "fake-indexeddb";
import { describe, expect, it } from "vitest";

import { createLocalDomainRuntime } from "./localDomainRuntime";

describe("createLocalDomainRuntime", () => {
  it("Web Crypto를 사용할 수 없는 HTTP 환경에는 HTTPS 안내를 제공한다", async () => {
    await expect(
      createLocalDomainRuntime("ieobom-insecure-context", indexedDB, {} as Crypto),
    ).rejects.toThrow("HTTPS 보안 주소");
  });

  it("IndexedDB를 사용할 수 없으면 저장소 안내를 제공한다", async () => {
    await expect(
      createLocalDomainRuntime(
        "ieobom-no-indexeddb",
        null as unknown as IDBFactory,
        crypto,
      ),
    ).rejects.toThrow("로컬 건강정보 저장소");
  });
});
