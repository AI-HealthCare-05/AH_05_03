import { describe, expect, it } from "vitest";

import type { FamilyProfile, LocalDocument } from "../../shared/local/domainContracts";
import { buildAssessmentPrefill, filterDocumentsByProfile } from "./DataManagementPage";

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

function sampleProfile(overrides: Partial<FamilyProfile> = {}): FamilyProfile {
  return {
    id: "profile-1",
    householdId: "household-1",
    displayName: "오성민",
    relationship: "본인",
    birthDate: "1988-10-28",
    gender: "male",
    opaqueServerRef: null,
    serverRefState: "none",
    status: "active",
    mergedIntoProfileId: null,
    createdAt: "2026-09-03T00:00:00.000Z",
    updatedAt: "2026-09-03T00:00:00.000Z",
    version: 1,
    ...overrides,
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

describe("buildAssessmentPrefill", () => {
  it("프로필의 성별과 생년월일 기반 나이를 OCR 수치와 결합한다", () => {
    const values = { fasting_glucose: 91, height_cm: 172.2, waist_cm: 84 };
    const profile = sampleProfile();

    const result = buildAssessmentPrefill(values, profile);
    expect(result.fasting_glucose).toBe(91);
    expect(result.height_cm).toBe(172.2);
    expect(result.waist_cm).toBe(84);
    expect(result.sex).toBe("M");
    expect(typeof result.age).toBe("number");
    expect(result.age).toBeGreaterThanOrEqual(19);
  });

  it("여성 프로필인 경우 성별 F를 설정한다", () => {
    const profile = sampleProfile({ gender: "female" });
    const result = buildAssessmentPrefill({}, profile);
    expect(result.sex).toBe("F");
  });

  it("이미 수치에 sex 또는 age가 있으면 덮어쓰지 않는다", () => {
    const values = { age: 50 };
    const profile = sampleProfile({ birthDate: "1988-10-28" });

    const result = buildAssessmentPrefill(values, profile);
    expect(result.age).toBe(50);
  });

  it("프로필이 없으면 기존 수치 그대로 반환한다", () => {
    const values = { fasting_glucose: 100 };
    expect(buildAssessmentPrefill(values, null)).toEqual(values);
  });
});

