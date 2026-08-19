# 브라우저 로컬 데이터 계약

> 상태: 구현 기준안 1.0 초안
>
> 적용 대상: React·TypeScript, IndexedDB, OPFS, Web Crypto
>
> 서버 계약: [03_api_spec.md](03_api_spec.md)
>
> 데이터 모델: [02_erd.md](02_erd.md)
> 결정 근거: [ADR-001](adr/0001-web-local-first-architecture.md), [ADR-002](adr/0002-separate-server-api-and-local-domain-contract.md), [ADR-006](adr/0006-lifecycle-scoped-profile-reference.md)

## 1. 목적과 경계

이 문서는 서버 REST API로 보내지 않는 건강정보 기능의 프로그래밍 계약이다. UI 컴포넌트는 IndexedDB, OPFS와 Web Crypto를 직접 호출하지 않고 아래 서비스 인터페이스를 사용한다.

```text
React UI
  → Local Domain Service
    → Crypto Service
    → IndexedDB repositories
    → OPFS file repository
```

Local Domain Service는 네트워크 요청을 발생시키지 않는다. 서비스 계정·초대·프로필 연결 API 호출은 별도의 Server API Client에서만 수행한다.

## 2. 공통 타입

```ts
type UUID = string;
type ISODate = `${number}-${number}-${number}`;
type ISODateTime = string; // UTC RFC 3339
type Base64Url = string;

type LocalResult<T, E extends LocalErrorCode = LocalErrorCode> =
  | { ok: true; value: T }
  | { ok: false; error: LocalError<E> };

interface LocalError<E extends LocalErrorCode> {
  code: E;
  message: string;
  fieldErrors?: Array<{ field: string; reason: string }>;
  retryable: boolean;
  cause?: unknown; // 개발 모드에서만 사용하고 사용자 로그·분석 도구로 전송하지 않음
}

type LocalErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "VERSION_CONFLICT"
  | "STORAGE_QUOTA_EXCEEDED"
  | "STORAGE_PERMISSION_DENIED"
  | "CRYPTO_KEY_UNAVAILABLE"
  | "ENCRYPTION_FAILED"
  | "DECRYPTION_FAILED"
  | "FILE_INTEGRITY_FAILED"
  | "BACKUP_VERSION_UNSUPPORTED"
  | "BACKUP_PASSWORD_INVALID"
  | "BACKUP_LIMIT_EXCEEDED"
  | "DUPLICATE_RECORD"
  | "PROFILE_MERGE_CONFLICT"
  | "PROFILE_MERGE_NOT_SAFE"
  | "ROLLBACK_REQUIRED"
  | "OCR_UNAVAILABLE"
  | "MODEL_UNAVAILABLE";
```

모든 로컬 엔티티 ID는 `crypto.randomUUID()`로 생성한다. 시간은 저장 직전에 UTC ISO 문자열로 정규화한다. 화면 표시를 제외한 내부 날짜 비교에는 문자열이 아니라 epoch milliseconds를 사용한다.

## 3. 핵심 엔티티

### 3.1 가정과 프로필

```ts
interface LocalHousehold {
  id: UUID;
  serverHouseholdId: UUID | null;
  nameCiphertext: EncryptedValue;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  version: number;
}

interface FamilyProfile {
  id: UUID;
  householdId: UUID;
  opaqueServerRef: Base64Url | null;
  serverRefState: "none" | "pending" | "active" | "retired";
  status: "active" | "hidden" | "merged";
  displayNameCiphertext: EncryptedValue;
  relationshipCiphertext: EncryptedValue;
  birthDateCiphertext: EncryptedValue | null;
  mergedIntoProfileId: UUID | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  version: number;
}

interface EncryptedValue {
  algorithm: "A256GCM";
  keyVersion: number;
  iv: Base64Url;
  ciphertext: Base64Url; // AES-GCM tag 포함
}
```

`opaqueServerRef`는 로컬 프로필의 영구 ID가 아니다. 가족 초대를 시작할 때 32바이트 이상의 CSPRNG로 생성하고, 초대부터 연결 종료까지 한 연결 생명주기에서만 사용한다. 동일 작업 재시도에서는 유지하고, 초대 거절·취소·만료, 연결 해제, 계정 변경 또는 프로필 병합 시 `retired`로 전환한 뒤 값을 지운다. 재연결에는 새 값을 만든다. 프로필 이름·관계·생년을 해시하거나 암호화한 값으로 만들지 않는다.

백업에서 `retired` 상태나 종료된 연결의 참조값을 읽어도 활성화하지 않는다. 로컬 프로필과 건강정보는 복구하되 `opaqueServerRef=null`, `serverRefState="none"`으로 정규화하고 다음 초대 시 새 값을 만든다.

### 3.2 건강기록

```ts
type HealthRecordType =
  | "blood_pressure"
  | "blood_glucose"
  | "body_measurement"
  | "lab_result"
  | "vaccination"
  | "health_screening"
  | "pain"
  | "walking"
  | "note";

interface HealthRecord<TPayload extends HealthPayload = HealthPayload> {
  id: UUID;
  householdId: UUID;
  profileId: UUID;
  recordType: HealthRecordType;
  schemaVersion: 1;
  recordedAt: ISODateTime;
  source: "manual" | "ocr" | "import" | "local_ai";
  payloadCiphertext: EncryptedValue;
  sourceDocumentId: UUID | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  deletedAt: ISODateTime | null;
  version: number;
}

type HealthPayload =
  | BloodPressurePayload
  | BloodGlucosePayload
  | BodyMeasurementPayload
  | LabResultPayload
  | VaccinationPayload
  | HealthScreeningPayload
  | PainPayload
  | WalkingPayload
  | NotePayload;
```

초기 payload 스키마:

```ts
interface BloodPressurePayload {
  type: "blood_pressure";
  systolicMmHg: number;  // 40..300, integer
  diastolicMmHg: number; // 20..200, integer, systolic보다 작아야 함
  pulseBpm?: number;     // 20..250, integer
  posture?: "sitting" | "standing" | "lying";
  note?: string;         // 최대 2000자
}

interface BloodGlucosePayload {
  type: "blood_glucose";
  valueMgDl: number; // 20..1000
  timing: "fasting" | "before_meal" | "after_meal" | "bedtime" | "random";
  minutesAfterMeal?: number; // timing=after_meal일 때 필수, 0..480
  note?: string;
}

interface BodyMeasurementPayload {
  type: "body_measurement";
  heightCm?: number;      // 30..250
  weightKg?: number;      // 1..500
  bodyFatPercent?: number;// 0..80
  skeletalMuscleKg?: number; // 0..150
  waistCm?: number;       // 20..300
  note?: string;
}

interface LabResultPayload {
  type: "lab_result";
  testCode: string;      // 내부 표준 코드, 최대 80자
  testName: string;      // 원문 검사명, 최대 200자
  value: number | string;
  unit?: string;         // 최대 40자
  referenceLow?: number;
  referenceHigh?: number;
  abnormalFlag?: "low" | "normal" | "high" | "unknown";
  note?: string;
}

interface VaccinationPayload {
  type: "vaccination";
  vaccineName: string;   // 최대 200자
  doseNumber?: number;   // 1..20
  manufacturer?: string;
  lotNumber?: string;
  institution?: string;
  note?: string;
}

interface HealthScreeningPayload {
  type: "health_screening";
  screeningName: string;
  institution?: string;
  summary?: string;      // 최대 10000자
  followUpNote?: string; // 의료 권고를 생성하지 않고 사용자가 입력한 원문만 저장
}

interface PainPayload {
  type: "pain";
  bodyAreas: string[];   // 1..20개, 각 최대 80자
  severity: number;      // 0..10 integer
  quality?: string[];    // 최대 10개
  durationMinutes?: number; // 0..525600
  progression?: "improving" | "stable" | "worsening" | "unknown";
  note?: string;
}

interface WalkingPayload {
  type: "walking";
  steps?: number;        // 0..200000 integer
  distanceKm?: number;   // 0..500
  durationMinutes?: number; // 0..1440
  sourceName?: string;   // 사용자가 입력한 출처, 자동 의료연동 아님
}

interface NotePayload {
  type: "note";
  title?: string; // 최대 200자
  text: string;   // 1..20000자
}
```

범위를 벗어난 값은 저장하지 않고 `VALIDATION_ERROR`를 반환한다. 값이 의학적으로 정상인지 판단하는 검증과 입력 형식 검증을 혼동하지 않는다.

### 3.3 원본 서류와 OCR

```ts
interface HealthDocument {
  id: UUID;
  householdId: UUID;
  profileId: UUID;
  encryptedFileId: UUID;
  originalNameCiphertext: EncryptedValue;
  mimeType: "application/pdf" | "image/jpeg" | "image/png" | "image/webp";
  plaintextSize: number;
  plaintextSha256Ciphertext: EncryptedValue;
  capturedAt: ISODateTime | null;
  createdAt: ISODateTime;
  deletedAt: ISODateTime | null;
  version: number;
}

interface OcrResult {
  id: UUID;
  documentId: UUID;
  engine: string;
  engineVersion: string;
  rawTextCiphertext: EncryptedValue;
  confirmedTextCiphertext: EncryptedValue;
  confidence: number | null; // 0..1
  status: "draft" | "confirmed" | "failed";
  createdAt: ISODateTime;
  confirmedAt: ISODateTime | null;
  version: number;
}
```

OCR 원문과 사용자가 확정한 값은 덮어쓰지 않고 별도로 저장한다. 외부 OCR로 원본 파일을 보내는 fallback은 제공하지 않는다.

### 3.4 가족력·예측·변경 이력

```ts
interface FamilyHistory {
  id: UUID;
  householdId: UUID;
  subjectProfileId: UUID;
  relativeProfileId: UUID | null;
  relativeLabelCiphertext: EncryptedValue | null;
  conditionCode: string;
  conditionNameCiphertext: EncryptedValue;
  onsetAgeCiphertext: EncryptedValue | null;
  noteCiphertext: EncryptedValue | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  deletedAt: ISODateTime | null;
  version: number;
}

interface PredictionResult {
  id: UUID;
  profileId: UUID;
  modelId: string;
  modelVersion: string;
  targetCode: string;
  inputCutoffAt: ISODateTime;
  resultCiphertext: EncryptedValue;
  createdAt: ISODateTime;
  version: number;
}

interface ChangeEvent {
  id: UUID;
  householdId: UUID;
  entityType: string;
  entityId: UUID;
  operation: "create" | "update" | "soft_delete" | "restore" | "merge";
  beforeCiphertext: EncryptedValue | null;
  afterCiphertext: EncryptedValue | null;
  occurredAt: ISODateTime;
  transactionId: UUID;
}
```

예측은 지원 모델 목록에 등록된 모델만 실행한다. 모델 입력과 결과는 서버 API, 원격 로그와 분석 도구로 보내지 않는다.

## 4. Local Domain API

### 4.1 프로필

```ts
interface ProfileService {
  create(input: CreateProfileInput): Promise<LocalResult<FamilyProfile>>;
  get(profileId: UUID): Promise<LocalResult<FamilyProfile, "NOT_FOUND" | "DECRYPTION_FAILED">>;
  list(householdId: UUID, includeHidden?: boolean): Promise<LocalResult<FamilyProfile[]>>;
  update(input: UpdateProfileInput): Promise<LocalResult<FamilyProfile>>;
  softDelete(profileId: UUID, expectedVersion: number): Promise<LocalResult<void>>;
}

interface CreateProfileInput {
  householdId: UUID;
  displayName: string;  // 1..100자
  relationship: string; // 1..80자
  birthDate?: ISODate;
}

interface UpdateProfileInput {
  profileId: UUID;
  expectedVersion: number;
  patch: {
    displayName?: string;
    relationship?: string;
    birthDate?: ISODate | null;
  };
}
```

`expectedVersion` 불일치는 `VERSION_CONFLICT`를 반환한다. 프로필 삭제는 연결된 기록을 즉시 물리 삭제하지 않고 `hidden` 처리 후 별도 영구삭제 확인 흐름을 사용한다.

### 4.2 건강기록

```ts
interface HealthRecordService {
  create<T extends HealthPayload>(input: CreateHealthRecordInput<T>): Promise<LocalResult<HealthRecord<T>>>;
  get(recordId: UUID): Promise<LocalResult<HealthRecord, "NOT_FOUND" | "DECRYPTION_FAILED">>;
  query(input: HealthRecordQuery): Promise<LocalResult<CursorPage<HealthRecord>>>;
  update<T extends HealthPayload>(input: UpdateHealthRecordInput<T>): Promise<LocalResult<HealthRecord<T>>>;
  softDelete(recordId: UUID, expectedVersion: number): Promise<LocalResult<void>>;
  restore(recordId: UUID, expectedVersion: number): Promise<LocalResult<HealthRecord>>;
}

interface CreateHealthRecordInput<T extends HealthPayload> {
  householdId: UUID;
  profileId: UUID;
  recordedAt: ISODateTime;
  source: "manual" | "ocr" | "import" | "local_ai";
  payload: T;
  sourceDocumentId?: UUID;
  duplicatePolicy: "reject" | "allow";
}

interface HealthRecordQuery {
  profileId: UUID;
  recordTypes?: HealthRecordType[];
  from?: ISODateTime;
  to?: ISODateTime;
  includeDeleted?: boolean;
  cursor?: string;
  limit?: number; // 1..200, 기본 50
}

interface UpdateHealthRecordInput<T extends HealthPayload> {
  recordId: UUID;
  expectedVersion: number;
  recordedAt?: ISODateTime;
  payload?: T;
}

interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}
```

중복 후보는 `(profileId, recordType, recordedAt, canonicalPayloadHash)`로 탐지한다. `canonicalPayloadHash`는 정규화한 평문 payload의 SHA-256이지만 암호화해 저장하며 서버에 전송하지 않는다.

### 4.3 원본 파일

```ts
interface DocumentService {
  save(input: SaveDocumentInput): Promise<LocalResult<HealthDocument>>;
  open(documentId: UUID): Promise<LocalResult<ReadableStream<Uint8Array>>>;
  softDelete(documentId: UUID, expectedVersion: number): Promise<LocalResult<void>>;
  verify(documentId: UUID): Promise<LocalResult<{ valid: boolean; sha256: string }>>;
}

interface SaveDocumentInput {
  householdId: UUID;
  profileId: UUID;
  file: File;
  capturedAt?: ISODateTime;
}
```

허용 MIME은 PDF, JPEG, PNG, WebP다. 초기 기본 한도는 파일당 250 MiB, 브라우저 전체 이어봄 데이터 2 GiB다. 저장 전 `navigator.storage.estimate()`로 예상 여유 공간을 확인하고 부족하면 파일 쓰기를 시작하지 않는다.

## 5. IndexedDB 물리 스키마

- Database name: `ieobom-local`
- Database version: `1`
- 모든 저장 객체는 `householdId`를 가져야 한다.
- 암호화 대상 평문을 인덱스 필드에 중복 저장하지 않는다.

| Object store | keyPath | 인덱스 |
|---|---|---|
| `households` | `id` | `serverHouseholdId`, `updatedAt` |
| `profiles` | `id` | `[householdId,status]`, `opaqueServerRef`, `updatedAt` |
| `healthRecords` | `id` | `[profileId,recordedAt]`, `[profileId,recordType,recordedAt]`, `sourceDocumentId`, `updatedAt`, `deletedAt` |
| `documents` | `id` | `[profileId,createdAt]`, `encryptedFileId`, `deletedAt` |
| `ocrResults` | `id` | `documentId`, `[documentId,status]` |
| `familyHistories` | `id` | `subjectProfileId`, `relativeProfileId`, `updatedAt`, `deletedAt` |
| `predictionResults` | `id` | `[profileId,targetCode,createdAt]`, `[modelId,modelVersion]` |
| `changeEvents` | `id` | `[householdId,occurredAt]`, `[entityType,entityId,occurredAt]`, `transactionId` |
| `restorePoints` | `id` | `[householdId,createdAt]`, `operationId`, `expiresAt` |
| `mergeOperations` | `id` | `sourceProfileId`, `targetProfileId`, `status`, `undoExpiresAt` |
| `fileMetadata` | `id` | `documentId`, `opfsPath`, `state`, `createdAt` |
| `cryptoMetadata` | `id` | `keyVersion`, `status` |
| `settings` | `key` | 없음 |

IndexedDB 트랜잭션은 필요한 object store를 시작 시점에 모두 열어야 한다. 트랜잭션 도중 네트워크, 사용자 입력 대기 또는 장시간 암호화 작업을 수행하지 않는다.

## 6. OPFS 계약

평문 파일명을 OPFS 경로에 사용하지 않는다.

```text
/v1/households/{householdId}/profiles/{profileId}/documents/{documentId}/
  meta.json
  chunk-00000001.bin
  chunk-00000002.bin
```

- `meta.json`에는 포맷 버전, 암호화 알고리즘, 키 버전, 청크 수만 기록한다.
- 원본 파일명, MIME, 프로필 이름과 SHA-256 평문값은 IndexedDB의 암호화 필드에 둔다.
- 파일은 1 MiB 청크로 나누고 각 청크를 별도 AES-GCM 메시지로 암호화한다.
- 임시 경로에 모든 청크를 쓴 뒤 해시·태그 검증에 성공하면 IndexedDB 메타데이터를 `committed`로 바꾼다.
- 실패한 `staging` 파일은 다음 앱 시작 시 정리한다.

OPFS와 IndexedDB는 하나의 원자적 트랜잭션을 공유하지 않으므로 다음 상태 머신을 사용한다.

```text
staging → verified → committed → deleting → deleted
             └────────failure──────────→ orphaned
```

## 7. 로컬 암호화 계약

### 7.1 데이터 키

1. 최초 가정 생성 시 256비트 Data Encryption Key(DEK)를 `crypto.getRandomValues`로 생성한다.
2. 런타임에는 `extractable=false`인 AES-GCM `CryptoKey`로 가져온다.
3. 각 레코드와 파일 청크는 12바이트 무작위 IV를 사용한다.
4. 같은 키로 IV를 재사용하지 않는다.
5. AAD에는 `schemaVersion`, `entityType`, `entityId`, `fieldName` 또는 파일 `chunkIndex`를 포함한다.
6. 키 회전 시 새 쓰기는 새 `keyVersion`을 사용하고 기존 데이터는 백그라운드에서 점진적으로 재암호화한다.

이 암호화는 디스크·백업 파일 노출에 대한 방어다. 실행 중인 악성 JavaScript, XSS 또는 오염된 배포 파일이 복호화 함수를 호출하는 위험까지 해결하지 못하므로 CSP, Subresource Integrity, 외부 스크립트 금지와 배포 무결성 검증이 별도로 필요하다.

### 7.2 계정 비밀번호와의 분리

서비스 계정 비밀번호를 로컬 DEK로 직접 사용하지 않는다. 서버 비밀번호 변경이나 계정 해지가 로컬 데이터 복호화 가능성을 자동으로 바꾸지 않아야 한다. 로컬 잠금 비밀번호와 복구 정책은 별도 UX 결정으로 확정한다.

## 8. 암호화 백업·이전 파일

- 확장자: `.ieobom`
- MIME: `application/vnd.ieobom.backup+zip`
- Container version: `1`
- ZIP은 저장 컨테이너로만 사용하며 암호화된 엔트리를 다시 압축하지 않는다.

```text
backup.ieobom
├─ header.json              # 비민감 포맷·KDF 정보
├─ manifest.enc             # 암호화된 엔티티·파일 목록
├─ records/00000001.enc     # 암호화된 NDJSON 레코드 묶음
└─ files/{fileId}/00000001.enc
```

`header.json`:

```json
{
  "format": "ieobom-backup",
  "version": 1,
  "created_at": "2026-08-18T09:30:00Z",
  "kdf": {
    "name": "PBKDF2",
    "hash": "SHA-256",
    "iterations": 600000,
    "salt": "base64url-16-byte-salt"
  },
  "key_wrap": {
    "name": "AES-GCM",
    "iv": "base64url-12-byte-iv",
    "wrapped_dek": "base64url-ciphertext-and-tag"
  },
  "chunk_size": 1048576
}
```

- 백업 비밀번호로 PBKDF2-HMAC-SHA-256을 600,000회 수행해 256비트 KEK를 만든다.
- Salt는 백업마다 새로운 16바이트 무작위 값이다.
- KEK는 백업용 DEK를 AES-GCM으로 감싸는 데만 사용한다.
- `manifest.enc` 안에 가정·프로필·레코드 개수, 파일명, MIME, 평문 SHA-256을 암호화해 둔다.
- 각 엔트리와 파일 청크는 고유 12바이트 IV와 AES-GCM 태그를 가진다.
- 백업 기본 한도는 전체 2 GiB, 파일당 250 MiB, 레코드 100,000건이다.
- 가져오기는 압축 해제 크기·경로 순회·중복 엔트리·청크 개수 한도를 먼저 검사한다.
- 모든 태그와 manifest 해시가 검증되기 전에는 기존 로컬 데이터를 변경하지 않는다.

백업 생성 순서:

```text
용량 계산 → 사용자 범위 확인 → 임시 백업 생성 → 암호화·태그 검증
→ 사용자 다운로드 성공 확인 → 완료 이벤트 로컬 기록
```

가져오기 순서:

```text
header 제한 검사 → 비밀번호로 DEK 해제 → manifest 복호화
→ 모든 엔트리 무결성 검사 → 중복·충돌 미리보기
→ 복구 지점 생성 → staged import → commit → 결과 확인
```

## 9. 프로필 병합 계약

```ts
interface ProfileMergeService {
  compare(sourceProfileId: UUID, targetProfileId: UUID): Promise<LocalResult<MergePlan>>;
  execute(input: ExecuteMergeInput): Promise<LocalResult<MergeOperation>>;
  commitServerLink(operationId: UUID, serverProfileLinkId: UUID): Promise<LocalResult<MergeOperation>>;
  rollback(operationId: UUID): Promise<LocalResult<MergeOperation>>;
}

interface MergePlan {
  sourceProfileId: UUID;
  targetProfileId: UUID;
  identityWarnings: string[];
  conflicts: MergeConflict[];
  duplicateFiles: Array<{ sourceDocumentId: UUID; targetDocumentId: UUID }>;
  estimatedAdditionalBytes: number;
}

interface ExecuteMergeInput {
  plan: MergePlan;
  resolutions: Array<{
    conflictId: UUID;
    resolution: "keep_source" | "keep_target" | "keep_both";
  }>;
}

interface MergeOperation {
  id: UUID;
  sourceProfileId: UUID;
  targetProfileId: UUID;
  restorePointId: UUID;
  status: "reviewing" | "staged" | "awaiting_server" | "committed" | "rolled_back" | "failed";
  undoExpiresAt: ISODateTime;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}
```

생년이 명백히 다르거나 사용자가 동일인이 아니라고 표시하면 `PROFILE_MERGE_NOT_SAFE`로 중단한다. 서버 프로필 연결이 필요한 병합은 `awaiting_server`에서 멈추고 성공 응답 전에는 source를 영구 삭제하지 않는다.

## 10. 로컬 로그·분석 규칙

- 건강정보를 원격 오류 추적, 세션 리플레이, 분석 SDK로 보내지 않는다.
- 이벤트 이름은 `local_record_created`처럼 일반화하고 프로필 ID, 질환명, 기록 유형, 수치를 속성으로 보내지 않는다.
- 개발 콘솔에도 복호화된 payload와 파일 경로를 출력하지 않는다.
- 로컬 진단 로그가 필요하면 사용자가 직접 암호화 파일로 내보내는 별도 기능을 사용한다.

## 11. 구현 완료 기준

- 네트워크를 차단한 상태에서 프로필·건강기록 CRUD, 원본 파일, 백업·복구가 동작한다.
- UI 코드에서 `indexedDB`, OPFS handle, `crypto.subtle` 직접 호출이 발견되지 않는다.
- 모든 로컬 쓰기가 `LocalResult`와 명시된 오류 코드를 반환한다.
- 버전 충돌, 저장 공간 부족, 브라우저 종료, 잘못된 비밀번호와 손상된 백업 테스트가 통과한다.
- IndexedDB와 OPFS의 고아·누락 파일 정리 테스트가 통과한다.
- 서버 네트워크 요청 본문과 원격 로그에서 로컬 엔티티 평문이 발견되지 않는다.

## 12. 참고 기준

- [W3C Web Cryptography Level 2](https://www.w3.org/TR/WebCryptoAPI/)
- [MDN IndexedDB API](https://developer.mozilla.org/docs/Web/API/IndexedDB_API)
- [MDN Origin private file system](https://developer.mozilla.org/docs/Web/API/File_System_API/Origin_private_file_system)
- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
