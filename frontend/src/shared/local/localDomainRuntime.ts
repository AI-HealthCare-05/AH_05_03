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
  indexedDb: IDBFactory | undefined = globalThis.indexedDB,
  cryptoApi: Crypto | undefined = globalThis.crypto,
): Promise<LocalDomainRuntime> {
  if (!cryptoApi?.subtle) {
    throw new Error(
      "로컬 건강정보 암호화를 사용할 수 없습니다. HTTPS 보안 주소로 다시 접속해 주세요.",
    );
  }
  if (!indexedDb) {
    throw new Error("이 브라우저에서는 로컬 건강정보 저장소를 사용할 수 없습니다.");
  }

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
