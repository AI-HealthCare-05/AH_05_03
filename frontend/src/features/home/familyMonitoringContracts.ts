/**
 * familyMonitoringContracts.ts
 * GitHub #122: 가족 건강 통합 모니터링을 위한 공통 건강 사건(Health Event) 계약
 * 
 * 원칙:
 * 1. 관찰·기록 뷰와 예측 뷰를 분리한다.
 * 2. 관찰 시점과 시스템 입력 시점을 분리 보존한다.
 * 3. 출처(사용자 보고, 문서 근거, 검토 대기, 가족력, 과거 병력, 의심, 부정)를 구분한다.
 * 4. 장기 강조의 빨간색은 '중요 진단 기록이 연결된 장기'를 뜻하며 손상률/응급도가 아니다.
 * 5. 기록 없는 구간 != 정상 (기록 없음 상태를 명시)
 */

export type MonitoringViewTab = "records" | "predictions";

export type HealthEventProvenance =
  | "user_report"          // 사용자 직접 보고 진단
  | "document_confirmed"    // 의료 문서 명시 + 사용자 확인 완료
  | "ocr_pending"          // 문서에서 자동 추출되었으나 미확인 대기 상태
  | "family_history"        // 다른 가족의 병력 (본인 장기에 연결 금지)
  | "past_history"          // 과거 병력 (현재 진행형과 구분)
  | "suspected"             // 의심 소견
  | "negated"              // 질환 배제 (아님)
  | "clinical_ai_inferred"; // 임상 AI 추론 (복합 증상·연관통 분석)

export type HealthEventCategory =
  | "diagnosis"    // 암, 만성질환 등 확정/보고 진단
  | "symptom"      // 통증 다이어리, 컨디션 보고
  | "test"         // 혈압, 혈당, 검진 수치
  | "treatment"    // 복약, 치료, 운동
  | "prediction";  // AI/ML 예측 모델 결과

export interface HealthEvent {
  id: string;
  profileId: string;
  category: HealthEventCategory;
  title: string;
  organKey?: string;        // 예: 'liver', 'stomach', 'lung', 'kidney', 'heart'
  organLabel?: string;      // 예: '간', '위', '폐', '신장', '심장'
  meshName?: string;        // 3D 메쉬 대응 식별자
  observedAt: string;       // 실제 관찰/진료/검사 일시 (ISO 8601)
  recordedAt: string;       // 시스템 입력/저장 일시 (ISO 8601)
  provenance: HealthEventProvenance;
  sourceDocumentId?: string;
  sourceDocumentName?: string;
  sourceSentence?: string;
  detailNote?: string;
  severityTone?: "diagnosis_alert" | "warning" | "info" | "neutral";
}

export interface TimeBlock {
  dateKey: string;          // YYYY-MM-DD
  displayDate: string;
  hasRecords: boolean;
  events: HealthEvent[];
  dominantTone: "alert" | "warning" | "info" | "empty";
}

export interface FamilyMemberSummary {
  profileId: string;
  displayName: string;
  relationship: string;
  importantDiagnoses: string[];
  recentChanges: string[];
  lastRecordedAt?: string;
  sharingRestricted?: boolean;
}

/**
 * 출처별 사람이 읽을 수 있는 레이블과 배지 색상
 */
export const PROVENANCE_BADGES: Record<HealthEventProvenance, { label: string; tone: string; description: string }> = {
  user_report: {
    label: "사용자 보고",
    tone: "user-report",
    description: "본인이 직접 작성한 진단/증상 보고입니다.",
  },
  document_confirmed: {
    label: "문서 근거 확인",
    tone: "doc-confirmed",
    description: "의료 문서에 기재된 진단이며 추출 확인이 완료되었습니다.",
  },
  ocr_pending: {
    label: "검토 대기",
    tone: "pending",
    description: "문서에서 자동 추출되었으나 아직 확인되지 않았습니다.",
  },
  family_history: {
    label: "가족력",
    tone: "family",
    description: "다른 가족 구성원의 병력입니다.",
  },
  past_history: {
    label: "과거 병력",
    tone: "past",
    description: "과거에 앓았던 병력으로 현재 상태와 구분됩니다.",
  },
  suspected: {
    label: "의심 소견",
    tone: "suspected",
    description: "확정 진단이 아닌 의심 소견입니다.",
  },
  negated: {
    label: "배제(아님)",
    tone: "negated",
    description: "검사 결과 해당 질환이 아님으로 확인되었습니다.",
  },
  clinical_ai_inferred: {
    label: "AI 임상 추론 (연관통)",
    tone: "ai-inferred",
    description: "복합 증상 양상을 분석하여 연관 분절/원인 해부학 구조를 추론한 결과입니다.",
  },
};
