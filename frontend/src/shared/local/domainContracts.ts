export type ISODate = `${number}-${number}-${number}`;
export type ISODateTime = string;

export type LocalErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "VERSION_CONFLICT"
  | "ENCRYPTION_FAILED"
  | "DECRYPTION_FAILED"
  | "VAULT_LOCKED"
  | "DUPLICATE_RECORD"
  | "PROFILE_MERGE_CONFLICT"
  | "PROFILE_MERGE_NOT_SAFE"
  | "ROLLBACK_REQUIRED";

export type LocalResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: LocalErrorCode; message: string; retryable: boolean } };

export interface FamilyProfile {
  id: string;
  householdId: string;
  displayName: string;
  relationship: string;
  birthDate: ISODate | null;
  opaqueServerRef: string | null;
  serverRefState: "none" | "pending" | "active" | "retired";
  status: "active" | "hidden" | "merged";
  mergedIntoProfileId: string | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  version: number;
}

export interface FamilyHistory {
  id: string;
  householdId: string;
  profileId: string;
  relativeRelationship: string;
  conditionName: string;
  onsetAge: number | null;
  note: string | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  version: number;
}

export type ShareableRecordType = "health-record" | "family-history" | "model-result";

export interface LocalAccessGrant {
  id: string;
  householdId: string;
  profileId: string;
  granteeAccountId: string;
  allowedRecordTypes: ShareableRecordType[];
  status: "active" | "revoked";
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  revokedAt: ISODateTime | null;
  version: number;
}

export interface ProfileMergeOperation {
  id: string;
  householdId: string;
  sourceProfileId: string;
  targetProfileId: string;
  restorePointId: string;
  status: "committed" | "reverted";
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  revertedAt: ISODateTime | null;
  version: number;
}

export type HealthRecordType =
  | "blood_pressure"
  | "blood_glucose"
  | "body_measurement"
  | "lab_result"
  | "vaccination"
  | "health_screening"
  | "pain"
  | "walking"
  // 판정 시점 스냅샷. 추적 대시보드가 "같은 사람의 다른 시점"을 그리려면 그 시점의
  // 입력값과 결과를 함께 남겨야 한다. 서버는 판정을 저장하지 않으므로(NFR-01)
  // 남길 자리는 여기, 암호화 로컬 보관함뿐이다.
  | "assessment"
  | "note";

/**
 * `recordType: "assessment"` 의 payload.
 *
 * 등급까지 같이 남기는 이유는 **다시 계산하면 값이 달라질 수 있기** 때문이다. 모델
 * 번들은 재학습으로 갱신되고 규칙 임계값도 지침 개정으로 바뀐다. 그때 과거 시점을
 * 새 모델로 재채점하면 "그날 사용자가 본 화면"과 다른 그래프가 그려진다. 추적은
 * 그날 본 것을 이어야 뜻이 있다.
 */
export interface AssessmentSnapshotPayload {
  /** 그날 넣은 값. 키는 서버 DTO 필드명 그대로다. */
  inputs: Record<string, number | string | boolean>;
  /** 질환별 등급. 키는 `verdicts[].key`. */
  levels: Record<string, string>;
  /** 질환별 정본 엔진. 엔진이 바뀐 시점을 차트에 표시하는 재료다. */
  engines: Record<string, string>;
  bmi: number;
  evaluated: number;
  total: number;
  highestLevel: string;
}

export interface HealthRecord<TPayload extends object = Record<string, unknown>> {
  id: string;
  householdId: string;
  profileId: string;
  recordType: HealthRecordType;
  recordedAt: ISODateTime;
  source: "manual" | "ocr" | "import" | "local_ai";
  payload: TPayload;
  sourceDocumentId: string | null;
  deletedAt: ISODateTime | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  version: number;
}

export interface LocalDocument {
  id: string;
  householdId: string;
  profileId: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
  chunkCount: number;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  version: number;
}

export interface DashboardSummary {
  profileId: string;
  totalRecords: number;
  latestRecordedAt: ISODateTime | null;
  countsByType: Partial<Record<HealthRecordType, number>>;
}
