/**
 * `POST /api/v1/assessments/summary` 응답 타입.
 *
 * 서버의 `app/dtos/assessment_summary.py` 를 옮긴 것이다. 손으로 옮기는 대가로
 * 드리프트 위험이 생기므로 **화면이 실제로 읽는 필드만** 적었다 — 다 적으면 서버가
 * 필드를 더할 때마다 여기도 고쳐야 하고, 안 읽는 필드의 드리프트는 잡을 방법이 없다.
 */

export type RiskLevel = "INSUFFICIENT_DATA" | "NORMAL" | "CAUTION" | "HIGH" | "VERY_HIGH";
export type EngineCode = "E1" | "E2" | "E3";

export interface ModelAccuracy {
  headline_auroc: number;
  grade: string;
  measured_on: string;
  alert_ppv: number | null;
  alert_sensitivity: number | null;
  holdout_n: number | null;
}

export interface VerdictReference {
  probability?: number | null;
  peer_percentile?: number | null;
  peer_group?: string | null;
  peer_ratio?: number | null;
  medical_level?: string | null;
  model_auroc?: number | null;
  tier?: string | null;
  accuracy?: ModelAccuracy | null;
  top_factors?: { feature: string; contribution: number }[];
}

export interface DiseaseVerdict {
  key: string;
  name: string;
  engine: EngineCode;
  engine_label: string;
  engine_reason: string;
  risk_level: RiskLevel;
  sub_status: string;
  display_label: string;
  reason: string;
  criteria_reference: string;
  recommendation: string;
  missing_fields: string[];
  flags: string[];
  superseded_by: string | null;
  reference: VerdictReference | null;
  disclaimer: string;
}

export interface RiskContributor {
  key: string;
  label: string;
  detail: string;
  weight: 1 | 2 | 3;
  effect: string;
  source: string;
  causal: boolean | null;
}

export interface DiseaseRisk {
  category: string;
  risk_level: RiskLevel;
  sub_status: string;
  display_label: string;
  reason: string;
  criteria_reference: string;
  recommendation: string;
  missing_fields: string[];
  contributors: RiskContributor[];
  score: number;
}

export interface AssessmentSummary {
  evaluated: number;
  total: number;
  insufficient: string[];
  by_engine: Record<string, number>;
  needs_attention: string[];
  highest_level: RiskLevel;
  matrix_evaluated: number;
  matrix_total: number;
  matrix_needs_attention: string[];
}

export interface AssessmentSummaryData {
  bmi: number;
  summary: AssessmentSummary;
  verdicts: DiseaseVerdict[];
  disease_risks: Record<string, DiseaseRisk>;
  disclaimers: string[];
  inputs_provided: number;
  inputs_total: number;
  model_available: boolean;
}

/** 등급 표시. 규칙 엔진 5단계를 그대로 쓴다 — 엔진이 달라도 "주의"가 같은 뜻이다. */
export const LEVEL_LABEL: Record<RiskLevel, string> = {
  VERY_HIGH: "매우 높음",
  HIGH: "높음",
  CAUTION: "주의",
  NORMAL: "정상 범위",
  INSUFFICIENT_DATA: "정보 부족",
};

export const LEVEL_ORDER: RiskLevel[] = ["VERY_HIGH", "HIGH", "CAUTION", "NORMAL", "INSUFFICIENT_DATA"];

export const ENGINE_SHORT: Record<EngineCode, string> = {
  E1: "규칙 엔진",
  E2: "ML 추정",
  E3: "공개 공식",
};
