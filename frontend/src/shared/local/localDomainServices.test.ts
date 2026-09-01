import { indexedDB } from "fake-indexeddb";
import { describe, expect, it } from "vitest";

import { IndexedDbEncryptedRecordRepository } from "./indexedDbEncryptedRecordRepository";
import { AesGcmJsonCipher } from "./jsonCipher";
import {
  LocalAccessGrantService,
  LocalDashboardService,
  LocalFamilyHistoryService,
  LocalHealthRecordService,
  LocalProfileMergeService,
  LocalProfileService,
} from "./localDomainServices";

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

  it("AI가 만든 건강기록은 암호화 저장 직전에 도메인 범위를 검증한다", async () => {
    const repository = new IndexedDbEncryptedRecordRepository(
      "ieobom-ai-validation-" + crypto.randomUUID(),
      indexedDB,
    );
    const cipher = await AesGcmJsonCipher.create();
    const profiles = new LocalProfileService(repository, cipher);
    const records = new LocalHealthRecordService(repository, cipher);
    const householdId = crypto.randomUUID();
    const profile = await profiles.create({ householdId, displayName: "검증 대상", relationship: "본인" });
    if (!profile.ok) throw new Error(profile.error.message);

    const invalidBloodPressure = await records.create({
      householdId,
      profileId: profile.value.id,
      recordType: "blood_pressure",
      recordedAt: "2026-08-31T09:00:00.000Z",
      source: "local_ai",
      payload: { type: "blood_pressure", systolicMmHg: 80, diastolicMmHg: 120 },
    });
    expect(invalidBloodPressure).toEqual(expect.objectContaining({
      ok: false,
      error: expect.objectContaining({ code: "VALIDATION_ERROR" }),
    }));

    const invalidExercise = await records.create({
      householdId,
      profileId: profile.value.id,
      recordType: "exercise",
      recordedAt: "2026-08-31T09:00:00.000Z",
      source: "local_ai",
      payload: { type: "exercise", exerciseName: "랫풀다운", weightKg: -20 },
    });
    expect(invalidExercise.ok).toBe(false);

    const invalidExerciseDistance = await records.create({
      householdId,
      profileId: profile.value.id,
      recordType: "exercise",
      recordedAt: "2026-08-31T09:00:00.000Z",
      source: "local_ai",
      payload: { type: "exercise", exerciseName: "달리기", distanceKm: 501 },
    });
    expect(invalidExerciseDistance).toEqual(expect.objectContaining({
      ok: false,
      error: expect.objectContaining({ code: "VALIDATION_ERROR" }),
    }));

    const stored = await records.query({ profileId: profile.value.id });
    expect(stored.ok && stored.value).toHaveLength(0);
    repository.close();
  });

  it("건강기록을 수정하고 소프트 삭제한 뒤 복원한다", async () => {
    const repository = new IndexedDbEncryptedRecordRepository(
      "ieobom-health-lifecycle-" + crypto.randomUUID(),
      indexedDB,
    );
    const cipher = await AesGcmJsonCipher.create();
    const profiles = new LocalProfileService(repository, cipher);
    const records = new LocalHealthRecordService(repository, cipher);
    const householdId = crypto.randomUUID();
    const profile = await profiles.create({ householdId, displayName: "기록 대상", relationship: "본인" });
    if (!profile.ok) throw new Error(profile.error.message);
    const created = await records.create({
      householdId,
      profileId: profile.value.id,
      recordType: "note",
      recordedAt: "2026-08-20T01:00:00.000Z",
      source: "manual",
      payload: { note: "수정 전" },
    });
    if (!created.ok) throw new Error(created.error.message);

    const updated = await records.update(created.value.id, {
      recordType: "pain",
      recordedAt: "2026-08-20T02:00:00.000Z",
      payload: { note: "수정 후" },
      expectedVersion: 1,
    });
    expect(updated.ok && updated.value.version).toBe(2);
    const removed = await records.softDelete(created.value.id, 2);
    expect(removed.ok && removed.value.deletedAt).not.toBeNull();
    const afterDelete = await records.query({ profileId: profile.value.id });
    expect(afterDelete.ok && afterDelete.value).toHaveLength(0);
    const restored = await records.restore(created.value.id, 3);
    expect(restored.ok && restored.value.deletedAt).toBeNull();
    const visible = await records.query({ profileId: profile.value.id });
    expect(visible.ok && visible.value[0].payload.note).toBe("수정 후");
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

  it("프로필을 수정하고 기록이 있는 프로필은 삭제 대신 숨긴다", async () => {
    const repository = new IndexedDbEncryptedRecordRepository(
      "ieobom-profile-lifecycle-" + crypto.randomUUID(),
      indexedDB,
    );
    const cipher = await AesGcmJsonCipher.create();
    const profiles = new LocalProfileService(repository, cipher);
    const records = new LocalHealthRecordService(repository, cipher);
    const householdId = crypto.randomUUID();
    const created = await profiles.create({ householdId, displayName: "수정 전", relationship: "본인" });
    if (!created.ok) throw new Error(created.error.message);

    const updated = await profiles.update(created.value.id, {
      displayName: "수정 후",
      relationship: "본인",
      expectedVersion: 1,
    });
    expect(updated.ok && updated.value.version).toBe(2);
    await records.create({
      householdId,
      profileId: created.value.id,
      recordType: "note",
      recordedAt: "2026-08-20T00:00:00.000Z",
      source: "manual",
      payload: { text: "보존할 기록" },
    });
    expect((await profiles.deleteEmpty(created.value.id)).ok).toBe(false);
    expect((await profiles.hide(created.value.id, 2)).ok).toBe(true);
    const visibleProfiles = await profiles.list(householdId);
    expect(visibleProfiles.ok && visibleProfiles.value).toHaveLength(0);
    const hiddenProfiles = await profiles.listHidden(householdId);
    expect(hiddenProfiles.ok && hiddenProfiles.value.map((profile) => profile.displayName)).toEqual(["수정 후"]);
    if (!hiddenProfiles.ok) throw new Error(hiddenProfiles.error.message);
    expect((await profiles.restore(created.value.id, hiddenProfiles.value[0].version)).ok).toBe(true);
    const restoredProfiles = await profiles.list(householdId);
    expect(restoredProfiles.ok && restoredProfiles.value.map((profile) => profile.displayName)).toEqual(["수정 후"]);
    repository.close();
  });

  it("가족력과 구성원별 접근 범위를 로컬 암호화 저장한다", async () => {
    const repository = new IndexedDbEncryptedRecordRepository(
      "ieobom-family-history-" + crypto.randomUUID(),
      indexedDB,
    );
    const cipher = await AesGcmJsonCipher.create();
    const profiles = new LocalProfileService(repository, cipher);
    const histories = new LocalFamilyHistoryService(repository, cipher);
    const grants = new LocalAccessGrantService(repository, cipher);
    const householdId = crypto.randomUUID();
    const profile = await profiles.create({ householdId, displayName: "가족력 대상", relationship: "자녀" });
    if (!profile.ok) throw new Error(profile.error.message);

    const history = await histories.create({
      householdId,
      profileId: profile.value.id,
      relativeRelationship: "외할머니",
      conditionName: "고혈압",
      onsetAge: 60,
    });
    expect(history.ok).toBe(true);
    const grant = await grants.grant({
      householdId,
      profileId: profile.value.id,
      granteeAccountId: crypto.randomUUID(),
      allowedRecordTypes: ["health-record", "family-history"],
    });
    expect(grant.ok && grant.value.allowedRecordTypes).toEqual(["health-record", "family-history"]);
    if (grant.ok) expect((await grants.revoke(grant.value.id)).ok).toBe(true);
    expect(JSON.stringify(await repository.list())).not.toContain("고혈압");
    repository.close();
  });

  it("프로필 병합은 기록을 이동하고 복구 지점으로 되돌린다", async () => {
    const repository = new IndexedDbEncryptedRecordRepository(
      "ieobom-profile-merge-" + crypto.randomUUID(),
      indexedDB,
    );
    const cipher = await AesGcmJsonCipher.create();
    const profiles = new LocalProfileService(repository, cipher);
    const healthRecords = new LocalHealthRecordService(repository, cipher);
    const merges = new LocalProfileMergeService(repository, cipher);
    const householdId = crypto.randomUUID();
    const source = await profiles.create({ householdId, displayName: "중복", relationship: "자녀" });
    const target = await profiles.create({ householdId, displayName: "기존", relationship: "자녀" });
    if (!source.ok || !target.ok) throw new Error("프로필 생성 실패");
    await healthRecords.create({
      householdId,
      profileId: source.value.id,
      recordType: "note",
      recordedAt: "2026-08-20T00:00:00.000Z",
      source: "manual",
      payload: { text: "이동할 기록" },
    });

    const merged = await merges.merge(source.value.id, target.value.id);
    expect(merged.ok).toBe(true);
    expect((await healthRecords.query({ profileId: target.value.id })).ok).toBe(true);
    const mergedSource = await profiles.get(source.value.id);
    expect(mergedSource.ok && mergedSource.value.status).toBe("merged");
    if (!merged.ok) throw new Error(merged.error.message);
    const reverted = await merges.revert(merged.value.id);
    expect(reverted.ok).toBe(true);
    const restoredRecords = await healthRecords.query({ profileId: source.value.id });
    expect(restoredRecords.ok && restoredRecords.value).toHaveLength(1);
    repository.close();
  });
});
