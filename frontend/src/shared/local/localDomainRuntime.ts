import { IndexedDbEncryptedRecordRepository } from "./indexedDbEncryptedRecordRepository";
import { LocalBackupService } from "./localBackupService";
import { LocalChallengeService } from "./localChallengeService";
import {
  LocalAccessGrantService,
  LocalDashboardService,
  LocalFamilyHistoryService,
  LocalHealthRecordService,
  LocalProfileMergeService,
  LocalProfileService,
} from "./localDomainServices";
import { IndexedDbLocalKeyVault } from "./localKeyVault";
import {
  LocalDocumentService,
  OpfsDocumentFileStore,
  type DocumentFileStore,
} from "./localDocumentService";

export interface LocalDomainRuntime {
  profiles: LocalProfileService;
  healthRecords: LocalHealthRecordService;
  dashboard: LocalDashboardService;
  challenges: LocalChallengeService;
  familyHistories: LocalFamilyHistoryService;
  accessGrants: LocalAccessGrantService;
  profileMerges: LocalProfileMergeService;
  backup: LocalBackupService;
  documents?: LocalDocumentService;
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
  let documentFiles: DocumentFileStore | undefined;
  if (typeof navigator.storage?.getDirectory === "function") {
    documentFiles = new OpfsDocumentFileStore(await navigator.storage.getDirectory());
  }
  const documents = documentFiles
    ? new LocalDocumentService(repository, cipher, documentFiles)
    : undefined;

  return {
    profiles,
    healthRecords,
    dashboard: new LocalDashboardService(healthRecords),
    challenges: new LocalChallengeService(repository, cipher),
    familyHistories: new LocalFamilyHistoryService(repository, cipher),
    accessGrants: new LocalAccessGrantService(repository, cipher),
    profileMerges: new LocalProfileMergeService(repository, cipher),
    backup: new LocalBackupService(repository, cipher, cryptoApi, documentFiles),
    documents,
    close() {
      repository.close();
      keyVault.close();
    },
  };
}
