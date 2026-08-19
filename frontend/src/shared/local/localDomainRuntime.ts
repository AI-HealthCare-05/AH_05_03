import { IndexedDbEncryptedRecordRepository } from "./indexedDbEncryptedRecordRepository";
import { LocalBackupService } from "./localBackupService";
import { LocalDashboardService, LocalHealthRecordService, LocalProfileService } from "./localDomainServices";
import { IndexedDbLocalKeyVault } from "./localKeyVault";

export interface LocalDomainRuntime {
  profiles: LocalProfileService;
  healthRecords: LocalHealthRecordService;
  dashboard: LocalDashboardService;
  backup: LocalBackupService;
  close(): void;
}

export async function createLocalDomainRuntime(
  databaseName = "ieobom-local",
  indexedDb: IDBFactory = globalThis.indexedDB,
  cryptoApi: Crypto = globalThis.crypto,
): Promise<LocalDomainRuntime> {
  const repository = new IndexedDbEncryptedRecordRepository(databaseName, indexedDb);
  const keyVault = new IndexedDbLocalKeyVault(databaseName, indexedDb, cryptoApi);
  const cipher = await keyVault.getOrCreateCipher();
  const profiles = new LocalProfileService(repository, cipher);
  const healthRecords = new LocalHealthRecordService(repository, cipher);

  return {
    profiles,
    healthRecords,
    dashboard: new LocalDashboardService(healthRecords),
    backup: new LocalBackupService(repository, cipher, cryptoApi),
    close() {
      repository.close();
      keyVault.close();
    },
  };
}
