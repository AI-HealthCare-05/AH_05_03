import { indexedDB } from "fake-indexeddb";
import { describe, expect, it } from "vitest";

import { IndexedDbEncryptedRecordRepository } from "./indexedDbEncryptedRecordRepository";
import { AesGcmJsonCipher } from "./jsonCipher";
import { LocalBackupService } from "./localBackupService";
import { LocalHealthRecordService, LocalProfileService } from "./localDomainServices";

describe("LocalBackupService", () => {
  it("단일 암호화 파일을 새 저장소와 새 로컬 키로 왕복한다", async () => {
    const sourceRepository = new IndexedDbEncryptedRecordRepository(
      "ieobom-backup-source-" + crypto.randomUUID(),
      indexedDB,
    );
    const sourceCipher = await AesGcmJsonCipher.create();
    const profiles = new LocalProfileService(sourceRepository, sourceCipher);
    const records = new LocalHealthRecordService(sourceRepository, sourceCipher);
    const householdId = crypto.randomUUID();
    const profile = await profiles.create({
      householdId,
      displayName: "백업 대상",
      relationship: "본인",
    });
    if (!profile.ok) throw new Error(profile.error.message);
    await records.create({
      householdId,
      profileId: profile.value.id,
      recordType: "blood_glucose",
      recordedAt: "2026-08-19T10:00:00.000Z",
      source: "manual",
      payload: { valueMgDl: 95, timing: "fasting" },
    });

    const backup = await new LocalBackupService(sourceRepository, sourceCipher).exportAll(
      "correct horse battery staple",
    );
    expect(await backup.text()).not.toContain("백업 대상");
    expect(await backup.text()).not.toContain("valueMgDl");

    const targetRepository = new IndexedDbEncryptedRecordRepository(
      "ieobom-backup-target-" + crypto.randomUUID(),
      indexedDB,
    );
    const targetCipher = await AesGcmJsonCipher.create();
    const targetBackup = new LocalBackupService(targetRepository, targetCipher);
    const preview = await targetBackup.importAll(backup, "correct horse battery staple");

    expect(preview.totalRecords).toBe(2);
    const restoredProfiles = await new LocalProfileService(targetRepository, targetCipher).list(householdId);
    expect(restoredProfiles.ok && restoredProfiles.value[0]?.displayName).toBe("백업 대상");
    sourceRepository.close();
    targetRepository.close();
  });

  it("잘못된 비밀번호에서는 기존 로컬 데이터를 변경하지 않는다", async () => {
    const repository = new IndexedDbEncryptedRecordRepository(
      "ieobom-backup-safe-" + crypto.randomUUID(),
      indexedDB,
    );
    const cipher = await AesGcmJsonCipher.create();
    await new LocalProfileService(repository, cipher).create({
      householdId: crypto.randomUUID(),
      displayName: "기존 데이터",
      relationship: "본인",
    });
    const service = new LocalBackupService(repository, cipher);
    const backup = await service.exportAll("correct horse battery staple");

    await expect(service.importAll(backup, "incorrect password", "replace")).rejects.toThrow(
      "틀렸거나",
    );
    expect(await repository.list()).toHaveLength(1);
    repository.close();
  });
});
