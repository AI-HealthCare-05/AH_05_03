/**
 * 공통 시계열 관측 데이터 계층 (TimeSeries Observation Engine)
 *
 * 일반 건강기록(healthRecords: 혈압계, 체중계, 검진표)과
 * 질환 판정 스냅샷(assessment: 판정 당시의 입력값)을
 * 단일한 표준 'ObservationPoint' 구조로 통합하고 중복을 제거합니다.
 *
 * 정본 규칙 (AGENTS.md & 34번 문서 준수):
 * 1. 수치 추출의 단일 진실 원천은 `recordSummary.ts`의 `recordValues`를 재사용합니다.
 * 2. 동일 시점·동일 지표의 중복 점(스냅샷 vs 직접 기록)은 합치되, 측정 날짜가 다르면 절대 합치지 않습니다.
 * 3. 가로축은 순번이 아닌 실제 측정 타임스탬프(ISO 8601)를 유지합니다.
 */

import type { HealthRecord, AssessmentSnapshotPayload, FamilyProfile } from "../../shared/local/domainContracts";
import { recordValues } from "../../shared/local/recordSummary";
import { TREND_SERIES, type TrendSeries } from "../assessment/snapshots";

/** 표준 관측 수치 한 점 */
export interface ObservationPoint {
  id: string; // 고유 측정점 식별자 (recordId:metricKey)
  profileId: string;
  metricKey: string; // "sbp" | "dbp" | "weight_kg" | "fasting_glucose" 등
  label: string;
  value: number;
  unit: string;
  measuredAt: string; // 실제 측정 일시 (ISO 8601)
  recordedAt: string; // 저장 일시
  sourceType: "direct_vital" | "assessment_snapshot" | "lab_ocr";
  sourceRecordId: string;
  linkedSourceRecordId?: string;
  sourceDocumentId?: string;
}

/** 건강기록(HealthRecord)에서 표준 관측점 목록 추출 */
export function extractObservationsFromRecord(record: HealthRecord): ObservationPoint[] {
  if (record.deletedAt) return [];
  const p = record.payload as Record<string, unknown>;
  const values = recordValues(record);
  const out: ObservationPoint[] = [];

  const measuredAt = (typeof p.measuredAt === "string" && p.measuredAt) || record.recordedAt;
  const payloadDocumentId = typeof p.sourceDocumentId === "string" ? p.sourceDocumentId : undefined;
  const sourceDocId = record.sourceDocumentId || payloadDocumentId;

  for (const v of values) {
    if (!v.field || typeof v.value !== "number" || !Number.isFinite(v.value)) continue;

    out.push({
      id: `${record.id}:${v.field}`,
      profileId: record.profileId,
      metricKey: v.field,
      label: v.label,
      value: v.value,
      unit: v.unit || "",
      measuredAt,
      recordedAt: record.recordedAt,
      sourceType: record.recordType === "lab_result" ? "lab_ocr" : "direct_vital",
      sourceRecordId: record.id,
      sourceDocumentId: sourceDocId,
    });
  }

  return out;
}

/** 판정 스냅샷(Assessment Snapshot)에서 표준 관측점 목록 추출 */
export function extractObservationsFromSnapshot(
  snapshot: HealthRecord<AssessmentSnapshotPayload>,
): ObservationPoint[] {
  if (snapshot.deletedAt) return [];
  const inputs = snapshot.payload.inputs;
  if (!inputs) return [];

  const out: ObservationPoint[] = [];
  const measuredAt = snapshot.recordedAt;

  for (const spec of TREND_SERIES) {
    const rawVal = inputs[spec.key];
    if (typeof rawVal === "number" && Number.isFinite(rawVal)) {
      out.push({
        id: `${snapshot.id}:${spec.key}`,
        profileId: snapshot.profileId,
        metricKey: spec.key,
        label: spec.label,
        value: rawVal,
        unit: spec.unit,
        measuredAt,
        recordedAt: snapshot.recordedAt,
        sourceType: "assessment_snapshot",
        sourceRecordId: snapshot.id,
        linkedSourceRecordId:
          typeof snapshot.payload.sourceRecordId === "string"
            ? snapshot.payload.sourceRecordId
            : undefined,
        sourceDocumentId: snapshot.sourceDocumentId || undefined,
      });
    }
  }

  return out;
}

/**
 * 중복 제거 및 시간순 정렬 (Fusion & De-duplication)
 *
 * 판정 스냅샷이 `sourceRecordId`로 실측 기록을 명시적으로 가리킬 때만 중복으로 제거합니다.
 * 같은 날이라는 이유만으로 서로 다른 재측정을 합치지 않습니다.
 */
export function mergeObservations(points: ObservationPoint[]): ObservationPoint[] {
  const sorted = points.slice().sort((a, b) => a.measuredAt.localeCompare(b.measuredAt));
  const directKeys = new Set(
    sorted
      .filter((point) => point.sourceType !== "assessment_snapshot")
      .map((point) => `${point.sourceRecordId}:${point.metricKey}`),
  );
  const seenIds = new Set<string>();

  return sorted.filter((point) => {
    if (seenIds.has(point.id)) return false;
    seenIds.add(point.id);
    if (
      point.sourceType === "assessment_snapshot" &&
      point.linkedSourceRecordId &&
      directKeys.has(`${point.linkedSourceRecordId}:${point.metricKey}`)
    ) {
      return false;
    }
    return true;
  });
}

/** 관측점 목록을 기존 차트용 TrendSeries[] 배열로 변환 */
export function observationsToTrendSeries(
  observations: ObservationPoint[],
  targetProfileId?: string,
): TrendSeries[] {
  const filtered = targetProfileId
    ? observations.filter((o) => o.profileId === targetProfileId)
    : observations;

  const seriesMap = new Map<string, { at: string; value: number }[]>();

  for (const obs of filtered) {
    let arr = seriesMap.get(obs.metricKey);
    if (!arr) {
      arr = [];
      seriesMap.set(obs.metricKey, arr);
    }
    arr.push({ at: obs.measuredAt, value: obs.value });
  }

  const result: TrendSeries[] = [];

  for (const spec of TREND_SERIES) {
    const points = seriesMap.get(spec.key);
    if (points && points.length >= 2) {
      result.push({
        key: spec.key,
        label: spec.label,
        unit: spec.unit,
        points: points.sort((a, b) => a.at.localeCompare(b.at)),
      });
    }
  }

  return result;
}

/** 관측점 목록을 FamilyComparisonChart가 사용하는 familyData 맵으로 변환 */
export function observationsToFamilyData(
  observations: ObservationPoint[],
  profiles: FamilyProfile[],
): Record<string, {
  name: string;
  relation?: string;
  metrics: Record<string, { at: string; value: number }[]>;
}> {
  const result: Record<string, {
    name: string;
    relation?: string;
    metrics: Record<string, { at: string; value: number }[]>;
  }> = {};

  profiles.forEach((p) => {
    result[p.id] = {
      name: p.displayName,
      relation: p.relationship,
      metrics: {},
    };
  });

  for (const obs of observations) {
    const prof = result[obs.profileId];
    if (!prof) continue;

    if (!prof.metrics[obs.metricKey]) {
      prof.metrics[obs.metricKey] = [];
    }
    prof.metrics[obs.metricKey].push({ at: obs.measuredAt, value: obs.value });
  }

  // 각 지표의 점들을 시간순 정렬
  Object.values(result).forEach((pData) => {
    Object.keys(pData.metrics).forEach((mKey) => {
      pData.metrics[mKey].sort((a, b) => a.at.localeCompare(b.at));
    });
  });

  return result;
}
