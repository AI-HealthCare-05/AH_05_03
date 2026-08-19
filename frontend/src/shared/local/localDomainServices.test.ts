import { indexedDB } from "fake-indexeddb";
import { describe, expect, it } from "vitest";

import { IndexedDbEncryptedRecordRepository } from "./indexedDbEncryptedRecordRepository";
import { AesGcmJsonCipher } from "./jsonCipher";
import { LocalDashboardService, LocalHealthRecordService, LocalProfileService } from "./localDomainServices";

describe("로컬 수직 기능", () => {
  it("프로필과 건강기록을 암호화 저장하고 대시보드 집계를 만든다", async () => {
    const repository = new IndexedDbEncryptedRecordRepository(
      "ieobom-domain-test-" + crypto.randomUUID(),
      indexedDB,
    );
    const cipher = await AesGcmJsonCipher.create();
    const profiles = new LocalProfileService(repository, cipher);
    const healthRecords = new LocalHealthRecordService(repository, cipher);
    const dashboard = new LocalDashboardService(healthRecords);
    const householdId = crypto.randomUUID();

    const profileResult = await profiles.create({
      householdId,
      displayName: "테스트 구성원",
      relationship: "본인",
      birthDate: "1990-01-01",
    });
    expect(profileResult.ok).toBe(true);
    if (!profileResult.ok) throw new Error(profileResult.error.message);

    const recordResult = await healthRecords.create({
      householdId,
      profileId: profileResult.value.id,
      recordType: "blood_pressure",
      recordedAt: "2026-08-19T09:00:00.000Z",
      source: "manual",
      payload: { systolicMmHg: 120, diastolicMmHg: 80 },
    });
    expect(recordResult.ok).toBe(true);

    const summary = await dashboard.summarize(profileResult.value.id);
    expect(summary).toEqual({
      ok: true,
      value: {
        profileId: profileResult.value.id,
        totalRecords: 1,
        latestRecordedAt: "2026-08-19T09:00:00.000Z",
        countsByType: { blood_pressure: 1 },
      },
    });

    const stored = await repository.list({ profileRef: profileResult.value.id });
    expect(stored).toHaveLength(2);
    expect(JSON.stringify(stored)).not.toContain("테스트 구성원");
    expect(JSON.stringify(stored)).not.toContain("systolicMmHg");
    repository.close();
  });

  it("다른 가정의 프로필을 목록에 섞지 않는다", async () => {
    const repository = new IndexedDbEncryptedRecordRepository(
      "ieobom-domain-test-" + crypto.randomUUID(),
      indexedDB,
    );
    const profiles = new LocalProfileService(repository, await AesGcmJsonCipher.create());
    const firstHousehold = crypto.randomUUID();
    const secondHousehold = crypto.randomUUID();
    await profiles.create({ householdId: firstHousehold, displayName: "첫째", relationship: "자녀" });
    await profiles.create({ householdId: secondHousehold, displayName: "둘째", relationship: "자녀" });

    const result = await profiles.list(firstHousehold);
    expect(result.ok && result.value.map((profile) => profile.displayName)).toEqual(["첫째"]);
    repository.close();
  });
});
