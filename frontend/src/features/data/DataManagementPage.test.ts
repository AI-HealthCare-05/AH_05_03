import { describe, expect, it } from "vitest";

import type { LocalDocument } from "../../shared/local/domainContracts";
import { filterDocumentsByProfile } from "./DataManagementPage";

function document(id: string, profileId: string): LocalDocument {
  return {
    id,
    householdId: "household-1",
    profileId,
    fileName: `${id}.pdf`,
    mimeType: "application/pdf",
    byteSize: 100,
    chunkCount: 1,
    createdAt: "2026-09-03T00:00:00.000Z",
    updatedAt: "2026-09-03T00:00:00.000Z",
    version: 1,
  };
}

describe("filterDocumentsByProfile", () => {
  it("선택한 구성원의 건강 서류만 반환한다", () => {
    const documents = [document("mine", "profile-me"), document("father", "profile-father")];

    expect(filterDocumentsByProfile(documents, "profile-father").map((item) => item.id)).toEqual(["father"]);
    expect(filterDocumentsByProfile(documents, "profile-me").map((item) => item.id)).toEqual(["mine"]);
    expect(filterDocumentsByProfile(documents, "")).toEqual([]);
  });
});
