import type { HealthRecord, HealthRecordType } from "../../shared/local/domainContracts";
import {
  type ExamCategory,
  type MatchType,
  isUnitCompatible,
  normalizeExamItem,
  normalizeUnit,
} from "./examItemNormalizer";

export interface ExamDataPoint {
  date: string; // YYYY-MM-DD
  dateTime: string; // ISO string
  rawName: string;
  canonicalName: string;
  category: ExamCategory;
  value: string;
  numericValue?: number;
  unit: string;
  judgment: string;
  matchType: MatchType;

  // Provenance / Traceability
  recordId: string;
  recordType: HealthRecordType;
  recordCreatedAt: string;
  source: "manual" | "ocr" | "import" | "local_ai";
  sourceDocumentId?: string;
  isUserConfirmed: boolean;
  rawOcrText?: string;

  diffFromPrev?: {
    numericDiff: number;
    text: string;
    direction: "increased" | "decreased" | "same";
  };
}

export interface MetricTrendSeries {
  canonicalName: string;
  category: ExamCategory;
  unit: string;
  dataPoints: ExamDataPoint[];
  latest: ExamDataPoint;
  earliest: ExamDataPoint;
  overallChange?: {
    numericDiff: number;
    text: string;
    direction: "increased" | "decreased" | "same";
  };
}

export interface LongitudinalTrendSummary {
  dates: string[]; // sorted unique dates
  metrics: MetricTrendSeries[];
  categories: {
    blood_glucose: MetricTrendSeries[];
    blood_pressure: MetricTrendSeries[];
    liver: MetricTrendSeries[];
    lipid: MetricTrendSeries[];
    kidney: MetricTrendSeries[];
    other: MetricTrendSeries[];
  };
}

function parseNumeric(val: string): number | undefined {
  const match = val.replace(/,/g, "").match(/[-+]?[0-9]*\.?[0-9]+/);
  if (!match) return undefined;
  const num = parseFloat(match[0]);
  return isNaN(num) ? undefined : num;
}

/**
 * 전체 로컬 건강기록들로부터 검사항목 시계열 데이터를 추출 및 집계합니다.
 * - 동일한 표준 검사 항목은 단 하나의 행(시리즈)으로만 통합하여 중복 행 생성을 원천 방지합니다.
 * - 동일 날짜에 여러 번 측정된 경우 유효한 수치값을 우선 선별합니다.
 */
export function analyzeExamTrends(records: HealthRecord[]): LongitudinalTrendSummary {
  const rawPoints: ExamDataPoint[] = [];

  // 삭제되지 않은 기록만 날짜순(과거->최신)으로 정렬
  const activeRecords = records.filter((r) => !r.deletedAt);
  const sortedRecords = [...activeRecords].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));

  for (const record of sortedRecords) {
    const date = record.recordedAt.slice(0, 10);
    const payload = (record.payload || {}) as Record<string, unknown>;
    const source = record.source || "manual";
    const sourceDocumentId = record.sourceDocumentId || undefined;

    // 1) lab_result 또는 health_screening 레코드
    if (record.recordType === "lab_result" || record.recordType === "health_screening") {
      const note = String(payload.note || payload.summary || "");

      // OCR 요약 표 텍스트 파싱: [검사 결과 요약] 이후 라인별 [검사명 | 결과값 | 단위 | 판정]
      const lines = note.split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("[검사 결과 요약]") || trimmed.startsWith("===")) continue;

        if (trimmed.includes("|")) {
          const parts = trimmed.split("|").map((p) => p.trim());
          if (parts.length >= 2) {
            const rawName = parts[0];
            const val = parts[1];
            const rawUnit = parts[2] || "";
            const judgment = parts[3] || "";
            const norm = normalizeExamItem(rawName, rawUnit);

            // 결과값과 단위가 동일하거나 판정단어가 단위에 들어간 경우 단위 제거 (예: 요단백 '정상 정상' 방지)
            const cleanUnit = norm.unit.toLowerCase() === val.toLowerCase() ? "" : norm.unit;

            rawPoints.push({
              date,
              dateTime: record.recordedAt,
              rawName,
              canonicalName: norm.canonicalName,
              category: norm.category,
              value: val,
              numericValue: parseNumeric(val),
              unit: cleanUnit,
              judgment,
              matchType: norm.matchType,
              recordId: record.id,
              recordType: record.recordType,
              recordCreatedAt: record.createdAt,
              source,
              sourceDocumentId,
              isUserConfirmed: true,
              rawOcrText: trimmed,
            });
          }
        }
      }

      // 단일 필드로 저장된 lab_result인 경우
      if (payload.testName && payload.value !== undefined) {
        const rawName = String(payload.testName);
        const val = String(payload.value);
        const rawUnit = String(payload.unit || "");
        const norm = normalizeExamItem(rawName, rawUnit);
        const cleanUnit = norm.unit.toLowerCase() === val.toLowerCase() ? "" : norm.unit;

        rawPoints.push({
          date,
          dateTime: record.recordedAt,
          rawName,
          canonicalName: norm.canonicalName,
          category: norm.category,
          value: val,
          numericValue: parseNumeric(val),
          unit: cleanUnit,
          judgment: String(payload.judgment || ""),
          matchType: norm.matchType,
          recordId: record.id,
          recordType: record.recordType,
          recordCreatedAt: record.createdAt,
          source,
          sourceDocumentId,
          isUserConfirmed: true,
        });
      }
    }

    // 2) 수기 혈당 기록 (blood_glucose)
    if (record.recordType === "blood_glucose" && typeof payload.value === "number") {
      const isPostprandial = payload.timing === "after_meal" || payload.timing === "postprandial";
      const targetName = isPostprandial ? "식후혈당" : "공복혈당";
      const norm = normalizeExamItem(targetName, "mg/dL");

      rawPoints.push({
        date,
        dateTime: record.recordedAt,
        rawName: isPostprandial ? "식후 혈당" : "공복 혈당",
        canonicalName: norm.canonicalName,
        category: "blood_glucose",
        value: String(payload.value),
        numericValue: payload.value,
        unit: "mg/dL",
        judgment: "",
        matchType: "exact",
        recordId: record.id,
        recordType: "blood_glucose",
        recordCreatedAt: record.createdAt,
        source,
        sourceDocumentId,
        isUserConfirmed: true,
      });
    }

    // 3) 수기 혈압 기록 (blood_pressure)
    if (record.recordType === "blood_pressure") {
      if (typeof payload.systolic === "number") {
        const norm = normalizeExamItem("수축기 혈압", "mmHg");
        rawPoints.push({
          date,
          dateTime: record.recordedAt,
          rawName: "수축기 혈압",
          canonicalName: norm.canonicalName,
          category: "blood_pressure",
          value: String(payload.systolic),
          numericValue: payload.systolic,
          unit: "mmHg",
          judgment: "",
          matchType: "exact",
          recordId: record.id,
          recordType: "blood_pressure",
          recordCreatedAt: record.createdAt,
          source,
          sourceDocumentId,
          isUserConfirmed: true,
        });
      }
      if (typeof payload.diastolic === "number") {
        const norm = normalizeExamItem("이완기 혈압", "mmHg");
        rawPoints.push({
          date,
          dateTime: record.recordedAt,
          rawName: "이완기 혈압",
          canonicalName: norm.canonicalName,
          category: "blood_pressure",
          value: String(payload.diastolic),
          numericValue: payload.diastolic,
          unit: "mmHg",
          judgment: "",
          matchType: "exact",
          recordId: record.id,
          recordType: "blood_pressure",
          recordCreatedAt: record.createdAt,
          source,
          sourceDocumentId,
          isUserConfirmed: true,
        });
      }
    }
  }

  // 고유 날짜 목록
  const uniqueDates = Array.from(new Set(rawPoints.map((p) => p.date))).sort();

  // 항목별로 엄격히 단일 그룹화 (canonicalName 기준 중복 생성 방지)
  const grouped = new Map<string, ExamDataPoint[]>();
  for (const pt of rawPoints) {
    const key = pt.canonicalName;
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key)!.push(pt);
  }

  const seriesList: MetricTrendSeries[] = [];

  for (const [canonicalName, points] of grouped.entries()) {
    if (points.length === 0) continue;

    // 동일 날짜에 여러 번 기록된 경우 가장 유효한 측정 포인트 선택
    const pointsByDate = new Map<string, ExamDataPoint>();
    for (const pt of points) {
      const existing = pointsByDate.get(pt.date);
      if (!existing) {
        pointsByDate.set(pt.date, pt);
      } else {
        // 우선순위: 수치값 존재 > 유효한 문자열 > "비해당"/"비대상"/빈값
        const isExistingInvalid =
          existing.value === "-" ||
          existing.value === "비해당" ||
          existing.value === "비대상" ||
          !existing.value;
        const isPtValid =
          pt.value && pt.value !== "-" && pt.value !== "비해당" && pt.value !== "비대상";

        if (existing.numericValue === undefined && pt.numericValue !== undefined) {
          pointsByDate.set(pt.date, pt);
        } else if (isExistingInvalid && isPtValid) {
          pointsByDate.set(pt.date, pt);
        } else if (pt.dateTime.localeCompare(existing.dateTime) > 0) {
          // 최신 시간 우선
          pointsByDate.set(pt.date, pt);
        }
      }
    }

    const sortedPoints = Array.from(pointsByDate.values()).sort((a, b) => a.dateTime.localeCompare(b.dateTime));

    // 시리즈의 대표 단위 결정 (포인트들 중 가장 많이 사용된 유효 단위)
    const validUnits = sortedPoints.map((p) => p.unit).filter(Boolean);
    const seriesUnit = validUnits[0] || points[0].unit || "";

    // 포인트들의 단위 통일
    for (const pt of sortedPoints) {
      if (!pt.unit && seriesUnit) {
        pt.unit = seriesUnit;
      }
    }

    // 직전 포인트와의 차이 계산
    for (let i = 0; i < sortedPoints.length; i++) {
      if (i > 0) {
        const prev = sortedPoints[i - 1];
        const curr = sortedPoints[i];
        if (
          curr.numericValue !== undefined &&
          prev.numericValue !== undefined &&
          isUnitCompatible(prev.unit, curr.unit)
        ) {
          const diff = Math.round((curr.numericValue - prev.numericValue) * 100) / 100;
          curr.diffFromPrev = {
            numericDiff: diff,
            text: diff > 0 ? `+${diff}` : `${diff}`,
            direction: diff > 0 ? "increased" : diff < 0 ? "decreased" : "same",
          };
        }
      }
    }

    const latest = sortedPoints[sortedPoints.length - 1];
    const earliest = sortedPoints[0];
    let overallChange: MetricTrendSeries["overallChange"] | undefined;

    if (
      sortedPoints.length > 1 &&
      latest.numericValue !== undefined &&
      earliest.numericValue !== undefined &&
      isUnitCompatible(earliest.unit, latest.unit)
    ) {
      const totalDiff = Math.round((latest.numericValue - earliest.numericValue) * 100) / 100;
      overallChange = {
        numericDiff: totalDiff,
        text: totalDiff > 0 ? `+${totalDiff}` : `${totalDiff}`,
        direction: totalDiff > 0 ? "increased" : totalDiff < 0 ? "decreased" : "same",
      };
    }

    seriesList.push({
      canonicalName,
      category: latest.category,
      unit: seriesUnit,
      dataPoints: sortedPoints,
      latest,
      earliest,
      overallChange,
    });
  }

  // 주요 카테고리별 분류
  const categories: LongitudinalTrendSummary["categories"] = {
    blood_glucose: [],
    blood_pressure: [],
    liver: [],
    lipid: [],
    kidney: [],
    other: [],
  };

  for (const s of seriesList) {
    categories[s.category].push(s);
  }

  return {
    dates: uniqueDates,
    metrics: seriesList,
    categories,
  };
}
