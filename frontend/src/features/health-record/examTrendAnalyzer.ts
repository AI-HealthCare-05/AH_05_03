import type { HealthRecord } from "../../shared/local/domainContracts";

export interface ExamDataPoint {
  date: string; // YYYY-MM-DD
  dateTime: string; // ISO string
  rawName: string;
  canonicalName: string;
  category: "blood_glucose" | "blood_pressure" | "liver" | "lipid" | "kidney" | "other";
  value: string;
  numericValue?: number;
  unit: string;
  judgment: string;
  diffFromPrev?: {
    numericDiff: number;
    text: string;
    direction: "increased" | "decreased" | "same";
  };
}

export interface MetricTrendSeries {
  canonicalName: string;
  category: "blood_glucose" | "blood_pressure" | "liver" | "lipid" | "kidney" | "other";
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

// 표준 명칭 매핑 사전
const CANONICAL_MAP: Array<{
  canonical: string;
  category: "blood_glucose" | "blood_pressure" | "liver" | "lipid" | "kidney" | "other";
  unit: string;
  keywords: string[];
}> = [
  // 혈당
  { canonical: "공복혈당 (FBS)", category: "blood_glucose", unit: "mg/dL", keywords: ["식전혈당", "공복혈당", "fbs", "혈당(식전)", "혈당(공복)"] },
  { canonical: "당화혈색소 (HbA1c)", category: "blood_glucose", unit: "%", keywords: ["당화혈색소", "hba1c", "당화 혈색소"] },

  // 혈압
  { canonical: "수축기 혈압", category: "blood_pressure", unit: "mmHg", keywords: ["수축기 혈압", "수축기혈압", "최고혈압", "systolic", "수축기"] },
  { canonical: "이완기 혈압", category: "blood_pressure", unit: "mmHg", keywords: ["이완기 혈압", "이완기혈압", "최저혈압", "diastolic", "이완기", "확장기"] },

  // 간기능
  { canonical: "AST (SGOT)", category: "liver", unit: "U/L", keywords: ["ast", "sgot", "got", "ast(sgot)", "ast (sgot)"] },
  { canonical: "ALT (SGPT)", category: "liver", unit: "U/L", keywords: ["alt", "sgpt", "gpt", "alt(sgpt)", "alt (sgpt)"] },
  { canonical: "감마지티피 (γ-GTP)", category: "liver", unit: "U/L", keywords: ["감마지티피", "감마-gtp", "r-gtp", "γ-gtp", "ggt", "감마gtp"] },

  // 지질 / 콜레스테롤
  { canonical: "총콜레스테롤", category: "lipid", unit: "mg/dL", keywords: ["총콜레스테롤", "총 콜레스테롤", "total cholesterol", "cholesterol", "tc"] },
  { canonical: "HDL 콜레스테롤", category: "lipid", unit: "mg/dL", keywords: ["hdl", "hdl 콜레스테롤", "hdl-c", "hdl-콜레스테롤"] },
  { canonical: "LDL 콜레스테롤", category: "lipid", unit: "mg/dL", keywords: ["ldl", "ldl 콜레스테롤", "ldl-c", "ldl-콜레스테롤"] },
  { canonical: "중성지방 (TG)", category: "lipid", unit: "mg/dL", keywords: ["중성지방", "triglyceride", "tg"] },

  // 신장 및 요검사
  { canonical: "혈청 크레아티닌", category: "kidney", unit: "mg/dL", keywords: ["혈청 크레아티닌", "크레아티닌", "creatinine"] },
  { canonical: "신사구체여과율 (e-GFR)", category: "kidney", unit: "mL/min", keywords: ["신사구체여과율", "e-gfr", "egfr", "gfr"] },
  { canonical: "요단백", category: "kidney", unit: "", keywords: ["요단백", "요 단백", "protein in urine"] },

  // 기타
  { canonical: "혈색소 (헤모글로빈)", category: "other", unit: "g/dL", keywords: ["혈색소", "헤모글로빈", "hemoglobin", "hb"] },
  { canonical: "체질량지수 (BMI)", category: "other", unit: "kg/m²", keywords: ["bmi", "체질량지수", "체질량 지수"] },
  { canonical: "허리둘레", category: "other", unit: "cm", keywords: ["허리둘레", "허리 둘레", "waist"] },
];

function resolveCanonical(rawName: string): { canonical: string; category: ExamDataPoint["category"]; unit: string } {
  const normalized = rawName.toLowerCase().replace(/[\s\-_]/g, "");
  for (const item of CANONICAL_MAP) {
    for (const kw of item.keywords) {
      const normKw = kw.toLowerCase().replace(/[\s\-_]/g, "");
      if (normalized === normKw || normalized.includes(normKw)) {
        return { canonical: item.canonical, category: item.category, unit: item.unit };
      }
    }
  }
  return { canonical: rawName.trim(), category: "other", unit: "" };
}

function parseNumeric(val: string): number | undefined {
  const match = val.replace(/,/g, "").match(/[-+]?[0-9]*\.?[0-9]+/);
  if (!match) return undefined;
  const num = parseFloat(match[0]);
  return isNaN(num) ? undefined : num;
}

/**
 * 전체 로컬 건강기록들로부터 검사항목 시계열 데이터를 추출 및 집계합니다.
 */
export function analyzeExamTrends(records: HealthRecord[]): LongitudinalTrendSummary {
  const rawPoints: ExamDataPoint[] = [];

  // 날짜순 오름차순 정렬
  const sortedRecords = [...records].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));

  for (const record of sortedRecords) {
    const date = record.recordedAt.slice(0, 10);
    const payload = (record.payload || {}) as Record<string, unknown>;

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
            const unit = parts[2] || "";
            const judgment = parts[3] || "";
            const resolved = resolveCanonical(rawName);

            rawPoints.push({
              date,
              dateTime: record.recordedAt,
              rawName,
              canonicalName: resolved.canonical,
              category: resolved.category,
              value: val,
              numericValue: parseNumeric(val),
              unit: unit || resolved.unit,
              judgment,
            });
          }
        }
      }

      // 단일 필드로 저장된 lab_result인 경우
      if (payload.testName && payload.value !== undefined) {
        const rawName = String(payload.testName);
        const val = String(payload.value);
        const resolved = resolveCanonical(rawName);
        rawPoints.push({
          date,
          dateTime: record.recordedAt,
          rawName,
          canonicalName: resolved.canonical,
          category: resolved.category,
          value: val,
          numericValue: parseNumeric(val),
          unit: String(payload.unit || resolved.unit || ""),
          judgment: String(payload.judgment || ""),
        });
      }
    }

    // 2) 수기 혈당 기록 (blood_glucose)
    if (record.recordType === "blood_glucose" && typeof payload.value === "number") {
      const timing = payload.timing ? ` (${payload.timing === "fasting" ? "공복" : payload.timing === "after_meal" ? "식후" : "혈당"})` : "";
      rawPoints.push({
        date,
        dateTime: record.recordedAt,
        rawName: `혈당${timing}`,
        canonicalName: "공복혈당 (FBS)",
        category: "blood_glucose",
        value: String(payload.value),
        numericValue: payload.value,
        unit: "mg/dL",
        judgment: "",
      });
    }

    // 3) 수기 혈압 기록 (blood_pressure)
    if (record.recordType === "blood_pressure") {
      if (typeof payload.systolic === "number") {
        rawPoints.push({
          date,
          dateTime: record.recordedAt,
          rawName: "수축기 혈압",
          canonicalName: "수축기 혈압",
          category: "blood_pressure",
          value: String(payload.systolic),
          numericValue: payload.systolic,
          unit: "mmHg",
          judgment: "",
        });
      }
      if (typeof payload.diastolic === "number") {
        rawPoints.push({
          date,
          dateTime: record.recordedAt,
          rawName: "이완기 혈압",
          canonicalName: "이완기 혈압",
          category: "blood_pressure",
          value: String(payload.diastolic),
          numericValue: payload.diastolic,
          unit: "mmHg",
          judgment: "",
        });
      }
    }
  }

  // 고유 날짜 목록
  const uniqueDates = Array.from(new Set(rawPoints.map((p) => p.date))).sort();

  // 항목별 그룹화
  const grouped = new Map<string, ExamDataPoint[]>();
  for (const pt of rawPoints) {
    if (!grouped.has(pt.canonicalName)) {
      grouped.set(pt.canonicalName, []);
    }
    grouped.get(pt.canonicalName)!.push(pt);
  }

  const seriesList: MetricTrendSeries[] = [];

  for (const [canonicalName, points] of grouped.entries()) {
    // 동일 날짜에 여러 번 측정된 경우 가장 최신 시간의 포인트 선택
    const pointsByDate = new Map<string, ExamDataPoint>();
    for (const pt of points) {
      pointsByDate.set(pt.date, pt);
    }
    const sortedPoints = Array.from(pointsByDate.values()).sort((a, b) => a.dateTime.localeCompare(b.dateTime));

    // 직전 포인트와의 차이 계산
    for (let i = 0; i < sortedPoints.length; i++) {
      if (i > 0) {
        const prev = sortedPoints[i - 1];
        const curr = sortedPoints[i];
        if (curr.numericValue !== undefined && prev.numericValue !== undefined) {
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

    if (sortedPoints.length > 1 && latest.numericValue !== undefined && earliest.numericValue !== undefined) {
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
      unit: latest.unit,
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
