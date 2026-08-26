import type { HealthRecord } from "../../shared/local/domainContracts";
import { normalizeExamItem } from "./examItemNormalizer";

export interface RAGQueryResult {
  answer: string;
  matchedRecords: HealthRecord[];
  category: "blood_glucose" | "blood_pressure" | "body_measurement" | "pain" | "screening" | "general";
  metricSummary?: {
    label: string;
    latestValue: string;
    latestDate: string;
    deltaText?: string;
    evidenceText?: string;
  };
}

function formatSourceLabel(source?: string | null): string {
  if (!source) return "로컬 기록";
  if (source === "manual") return "수기 입력";
  if (source === "ocr") return "OCR 확정 기록";
  if (source === "import") return "가져온 기록";
  if (source === "local_ai") return "대화형 기록 초안";
  return "로컬 기록";
}

interface GlucoseItem {
  record: HealthRecord;
  value: number;
  unit: string;
  timing: "fasting" | "after_meal" | "before_meal" | "unknown";
  label: string;
  recordedAt: string;
}

interface BloodPressureItem {
  record: HealthRecord;
  sbp: number;
  dbp: number;
  unit: string;
  label: string;
  recordedAt: string;
}

interface BodyMeasurementItem {
  record: HealthRecord;
  weight?: number;
  height?: number;
  recordedAt: string;
}

const BODY_AREAS = [
  "오른쪽 무릎", "왼쪽 무릎", "양쪽 무릎", "무릎",
  "허리", "목",
  "오른쪽 어깨", "왼쪽 어깨", "어깨",
  "오른쪽 손목", "왼쪽 손목", "손목",
  "오른쪽 발목", "왼쪽 발목", "발목",
  "머리", "두통",
  "가슴", "복부", "배",
  "골반", "팔꿈치", "턱", "치아", "옆구리",
];

function parseNumeric(val: unknown): number | undefined {
  if (typeof val === "number" && !isNaN(val)) return val;
  if (typeof val === "string") {
    const cleaned = val.replace(/,/g, "").trim();
    const parsed = parseFloat(cleaned);
    if (!isNaN(parsed)) return parsed;
  }
  return undefined;
}

function extractGlucoseItem(record: HealthRecord): GlucoseItem | undefined {
  if (record.deletedAt) return undefined;
  const payload = (record.payload as Record<string, unknown>) ?? {};

  // 1. 수기/단일 혈당 기록 (blood_glucose)
  if (record.recordType === "blood_glucose") {
    const rawVal =
      payload.value ??
      payload.valueMgDl ??
      payload.glucose ??
      payload.fastingBloodSugar ??
      payload.val;
    const num = parseNumeric(rawVal);
    if (num === undefined) return undefined;

    const timingRaw = String(payload.timing ?? "").toLowerCase();
    let timing: GlucoseItem["timing"];
    let label: string;

    if (timingRaw === "fasting" || payload.fastingBloodSugar !== undefined) {
      timing = "fasting";
      label = "공복혈당";
    } else if (timingRaw === "after_meal" || timingRaw === "postprandial") {
      timing = "after_meal";
      label = "식후혈당";
    } else if (timingRaw === "before_meal") {
      timing = "before_meal";
      label = "식전혈당";
    } else {
      timing = "unknown";
      label = "시점 미확인 혈당";
    }

    return {
      record,
      value: num,
      unit: "mg/dL",
      timing,
      label,
      recordedAt: record.recordedAt,
    };
  }

  // 2. 검사 결과 항목 (lab_result)
  if (record.recordType === "lab_result") {
    const testName = String(payload.testName ?? payload.examName ?? payload.name ?? "");
    const rawUnit = String(payload.unit ?? "");
    if (testName) {
      const norm = normalizeExamItem(testName, rawUnit);
      if (norm.category === "blood_glucose") {
        const num = parseNumeric(payload.value ?? payload.numericValue);
        if (num === undefined) return undefined;

        let timing: GlucoseItem["timing"] = "unknown";
        let label = norm.canonicalName;

        if (norm.canonicalName === "공복혈당") {
          timing = "fasting";
          label = "공복혈당";
        } else if (norm.canonicalName === "식후혈당") {
          timing = "after_meal";
          label = "식후혈당";
        }

        return {
          record,
          value: num,
          unit: norm.standardUnit || "mg/dL",
          timing,
          label,
          recordedAt: record.recordedAt,
        };
      }
    }
  }

  // 3. 검진/OCR 요약 기록 (health_screening / ocr note 내 명시적 혈당 검사명)
  const noteStr = String(payload.note ?? "");
  if (noteStr) {
    const fastingMatch = noteStr.match(/(?:공복\s*혈당|fbs|fasting\s*(?:blood\s*)?glucose)[\s:=|]*([0-9]{2,3})/i);
    if (fastingMatch) {
      const num = parseInt(fastingMatch[1], 10);
      return {
        record,
        value: num,
        unit: "mg/dL",
        timing: "fasting",
        label: "공복혈당",
        recordedAt: record.recordedAt,
      };
    }

    const postMatch = noteStr.match(/(?:식후\s*혈당|pp2|postprandial\s*(?:blood\s*)?glucose)[\s:=|]*([0-9]{2,3})/i);
    if (postMatch) {
      const num = parseInt(postMatch[1], 10);
      return {
        record,
        value: num,
        unit: "mg/dL",
        timing: "after_meal",
        label: "식후혈당",
        recordedAt: record.recordedAt,
      };
    }
  }

  return undefined;
}

function extractBloodPressureItem(record: HealthRecord): BloodPressureItem | undefined {
  if (record.deletedAt) return undefined;
  const payload = (record.payload as Record<string, unknown>) ?? {};

  // 1. 구조화 혈압 기록 (blood_pressure)
  if (record.recordType === "blood_pressure") {
    const sbp = parseNumeric(payload.systolic ?? payload.systolicMmHg ?? payload.sbp);
    const dbp = parseNumeric(payload.diastolic ?? payload.diastolicMmHg ?? payload.dbp);
    if (sbp !== undefined && dbp !== undefined) {
      return {
        record,
        sbp,
        dbp,
        unit: "mmHg",
        label: "혈압",
        recordedAt: record.recordedAt,
      };
    }
  }

  // 2. 검사 결과 (lab_result)
  if (record.recordType === "lab_result") {
    const testName = String(payload.testName ?? payload.examName ?? payload.name ?? "");
    const norm = normalizeExamItem(testName);
    if (norm.category === "blood_pressure") {
      const sbp = parseNumeric(payload.systolic ?? payload.systolicValue ?? payload.value);
      const dbp = parseNumeric(payload.diastolic ?? payload.diastolicValue);
      if (sbp !== undefined && dbp !== undefined) {
        return {
          record,
          sbp,
          dbp,
          unit: "mmHg",
          label: "혈압",
          recordedAt: record.recordedAt,
        };
      }
    }
  }

  // 3. 검진/OCR 요약 노트 (혈압 키워드가 명시된 경우만 허용)
  const noteStr = String(payload.note ?? "");
  if (noteStr) {
    const bpMatch =
      noteStr.match(/(?:혈압|bp|blood\s*pressure)[\s:=|]*([0-9]{2,3})\s*(?:\/|~|에)\s*([0-9]{2,3})/i) ||
      noteStr.match(/수축기\s*([0-9]{2,3}).*?이완기\s*([0-9]{2,3})/);
    if (bpMatch) {
      const sbp = parseInt(bpMatch[1], 10);
      const dbp = parseInt(bpMatch[2], 10);
      if (sbp >= 50 && sbp <= 260 && dbp >= 30 && dbp <= 160) {
        return {
          record,
          sbp,
          dbp,
          unit: "mmHg",
          label: "혈압",
          recordedAt: record.recordedAt,
        };
      }
    }
  }

  return undefined;
}

function extractBodyMeasurementItem(record: HealthRecord): BodyMeasurementItem | undefined {
  if (record.deletedAt) return undefined;
  const payload = (record.payload as Record<string, unknown>) ?? {};

  if (record.recordType === "body_measurement") {
    const weight = parseNumeric(payload.weightKg ?? payload.weight ?? payload.wt);
    const height = parseNumeric(payload.heightCm ?? payload.height ?? payload.ht);
    if (weight !== undefined || height !== undefined) {
      return {
        record,
        weight,
        height,
        recordedAt: record.recordedAt,
      };
    }
  }

  return undefined;
}

function parseYearCondition(query: string, referenceDate: Date): { year: number; label: string } | undefined {
  const currentYear = referenceDate.getFullYear();
  if (query.includes("작년") || query.includes("지난해")) {
    return { year: currentYear - 1, label: `작년(${currentYear - 1}년)` };
  }
  if (query.includes("올해") || query.includes("금년")) {
    return { year: currentYear, label: `올해(${currentYear}년)` };
  }
  if (query.includes("재작년")) {
    return { year: currentYear - 2, label: `재작년(${currentYear - 2}년)` };
  }
  const yearMatch = query.match(/([12][0-9]{3})\s*년/);
  if (yearMatch) {
    const y = parseInt(yearMatch[1], 10);
    return { year: y, label: `${y}년` };
  }
  return undefined;
}

function findTargetPainArea(query: string): string | undefined {
  for (const area of BODY_AREAS) {
    if (query.includes(area)) {
      return area;
    }
  }
  if (/(?:등\s*통증|등이\s*아파|등\s*부위|등쪽)/.test(query)) {
    return "등";
  }
  return undefined;
}

export function queryLocalHealthRAG(
  queryText: string,
  records: HealthRecord[],
  profileName: string,
  referenceDate: Date = new Date(),
): RAGQueryResult {
  const q = queryText.toLowerCase();

  // 삭제된 기록은 어떤 검색에서도 제외하고 최신순으로 정렬
  const activeRecords = records
    .filter((r) => !r.deletedAt)
    .sort((a, b) => new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime());

  // 1. 혈당 질의
  if (/(혈당|당수치|공복혈당|식후혈당|glucose)/.test(q)) {
    const allGlucoseItems: GlucoseItem[] = activeRecords
      .map(extractGlucoseItem)
      .filter((item): item is GlucoseItem => item !== undefined);

    if (allGlucoseItems.length === 0) {
      return {
        answer: `${profileName}님의 저장된 혈당 기록이 아직 없습니다. 혈당 수치를 측정하셨다면 말씀해 주세요!`,
        matchedRecords: [],
        category: "blood_glucose",
      };
    }

    const wantsFasting = /(공복|식전|fbs|fasting)/.test(q);
    const wantsPostprandial = /(식후|pp2|postprandial)/.test(q);
    const wantsHba1c = /(당화혈색소|hba1c|a1c)/.test(q);

    let targetItems: GlucoseItem[];
    if (wantsFasting) {
      targetItems = allGlucoseItems.filter((item) => item.timing === "fasting");
      if (targetItems.length === 0) {
        return {
          answer: `${profileName}님의 저장된 공복혈당 기록을 찾지 못했습니다.`,
          matchedRecords: [],
          category: "blood_glucose",
        };
      }
    } else if (wantsPostprandial) {
      targetItems = allGlucoseItems.filter((item) => item.timing === "after_meal");
      if (targetItems.length === 0) {
        return {
          answer: `${profileName}님의 저장된 식후혈당 기록을 찾지 못했습니다.`,
          matchedRecords: [],
          category: "blood_glucose",
        };
      }
    } else if (wantsHba1c) {
      targetItems = allGlucoseItems.filter((item) => item.label.includes("당화혈색소"));
      if (targetItems.length === 0) {
        return {
          answer: `${profileName}님의 저장된 당화혈색소 기록을 찾지 못했습니다.`,
          matchedRecords: [],
          category: "blood_glucose",
        };
      }
    } else {
      targetItems = allGlucoseItems;
    }

    const latest = targetItems[0];
    const latestVal = latest.value;
    const latestLabel = latest.label;
    const latestDateStr = latest.recordedAt.slice(0, 10);

    // 변화량은 반드시 같은 timing(시점)의 직전 기록과만 비교
    let deltaText = "";
    const prevSameTiming = targetItems.slice(1).find((item) => item.timing === latest.timing);
    if (prevSameTiming) {
      const diff = latestVal - prevSameTiming.value;
      deltaText =
        diff > 0
          ? `(직전 ${latestLabel} 대비 +${diff} ${latest.unit} 증가)`
          : diff < 0
          ? `(직전 ${latestLabel} 대비 ${diff} ${latest.unit} 감소)`
          : `(직전 ${latestLabel}과 동일)`;
    }

    const valueDisplay = `${latestVal} ${latest.unit}`;
    const deltaPart = deltaText ? ` ${deltaText}` : "";
    const answer = `가장 최근에 기록된 ${profileName}님의 ${latestLabel}은 ${latestDateStr} 기준 ${valueDisplay}입니다.${deltaPart}`;
    const evidenceText = `근거: ${formatSourceLabel(latest.record.source)} · ${latestLabel} · ${latestDateStr}`;

    return {
      answer,
      matchedRecords: targetItems.map((item) => item.record).slice(0, 3),
      category: "blood_glucose",
      metricSummary: {
        label: latestLabel,
        latestValue: valueDisplay,
        latestDate: latestDateStr,
        deltaText: deltaText || undefined,
        evidenceText,
      },
    };
  }

  // 2. 혈압 질의
  if (/(혈압|수축기|이완기|bp)/.test(q)) {
    const allBpItems: BloodPressureItem[] = activeRecords
      .map(extractBloodPressureItem)
      .filter((item): item is BloodPressureItem => item !== undefined);

    if (allBpItems.length === 0) {
      return {
        answer: `${profileName}님의 저장된 혈압 기록이 아직 없습니다. 혈압을 측정하셨다면 기록해 드릴게요!`,
        matchedRecords: [],
        category: "blood_pressure",
      };
    }

    const latest = allBpItems[0];
    const latestDateStr = latest.recordedAt.slice(0, 10);

    let deltaText = "";
    if (allBpItems.length > 1) {
      const prev = allBpItems[1];
      const sbpDiff = latest.sbp - prev.sbp;
      deltaText = `(직전 수축기 대비 ${sbpDiff >= 0 ? `+${sbpDiff}` : sbpDiff} mmHg)`;
    }

    const bpDisplay = `${latest.sbp}/${latest.dbp} ${latest.unit}`;
    const deltaPart = deltaText ? ` ${deltaText}` : "";
    const answer = `가장 최근에 기록된 ${profileName}님의 혈압은 ${latestDateStr} 기준 ${bpDisplay}입니다.${deltaPart}`;
    const evidenceText = `근거: ${formatSourceLabel(latest.record.source)} · 혈압 · ${latestDateStr}`;

    return {
      answer,
      matchedRecords: allBpItems.map((item) => item.record).slice(0, 3),
      category: "blood_pressure",
      metricSummary: {
        label: "혈압",
        latestValue: bpDisplay,
        latestDate: latestDateStr,
        deltaText: deltaText || undefined,
        evidenceText,
      },
    };
  }

  // 3. 체중 / 신체 측정 질의
  if (/(체중|몸무게|키|신장|bmi|몸)/.test(q)) {
    const allBodyItems: BodyMeasurementItem[] = activeRecords
      .map(extractBodyMeasurementItem)
      .filter((item): item is BodyMeasurementItem => item !== undefined);

    if (allBodyItems.length === 0) {
      return {
        answer: `${profileName}님의 저장된 체중/신체 측정 기록이 없습니다.`,
        matchedRecords: [],
        category: "body_measurement",
      };
    }

    const latest = allBodyItems[0];
    const latestDateStr = latest.recordedAt.slice(0, 10);
    const wtDisplay = latest.weight !== undefined ? `${latest.weight} kg` : "체중 기록됨";
    const answer = `가장 최근 체중은 ${latestDateStr} 기준 ${wtDisplay}${latest.height ? ` (신장 ${latest.height} cm)` : ""}입니다.`;
    const evidenceText = `근거: ${formatSourceLabel(latest.record.source)} · 체중 · ${latestDateStr}`;

    return {
      answer,
      matchedRecords: allBodyItems.map((item) => item.record).slice(0, 3),
      category: "body_measurement",
      metricSummary: {
        label: "체중",
        latestValue: wtDisplay,
        latestDate: latestDateStr,
        evidenceText,
      },
    };
  }

  // 4. 통증 질의
  if (/(통증|아픈|아팠|무릎|허리|어깨|손목|발목|머리|두통|목|배|복부|가슴|골반|팔|다리)/.test(q)) {
    let painRecords = activeRecords.filter((r) => r.recordType === "pain");

    // 특정 부위 필터
    const targetArea = findTargetPainArea(q);
    if (targetArea) {
      const areaFiltered = painRecords.filter((r) => {
        const p = (r.payload as Record<string, unknown>) ?? {};
        return (
          String(p.bodyArea ?? "").includes(targetArea) ||
          String(p.note ?? "").includes(targetArea)
        );
      });

      if (areaFiltered.length === 0) {
        return {
          answer: `${profileName}님의 '${targetArea}' 부위 저장된 통증 기록을 찾지 못했습니다.`,
          matchedRecords: [],
          category: "pain",
        };
      }
      painRecords = areaFiltered;
    }

    if (painRecords.length === 0) {
      return {
        answer: `${profileName}님의 저장된 통증 기록이 없습니다.`,
        matchedRecords: [],
        category: "pain",
      };
    }

    const latest = painRecords[0];
    const p = (latest.payload as Record<string, unknown>) ?? {};
    const area = p.bodyArea ?? targetArea ?? "통증 부위";
    const intensity = p.intensity !== undefined ? `강도 ${p.intensity}/10` : "";
    const sensation = p.sensation ? `, ${p.sensation}` : "";
    const latestDateStr = latest.recordedAt.slice(0, 10);

    const answer = `${profileName}님의 가장 최근 통증 기록은 ${latestDateStr}에 등록된 ${area} (${intensity}${sensation})입니다.`;
    const evidenceText = `근거: ${formatSourceLabel(latest.source)} · ${area} · ${latestDateStr}`;

    return {
      answer,
      matchedRecords: painRecords.slice(0, 3),
      category: "pain",
      metricSummary: {
        label: String(area),
        latestValue: `${intensity}${sensation}` || "통증 기록됨",
        latestDate: latestDateStr,
        evidenceText,
      },
    };
  }

  // 5. 검진 이력 질의 (연도 필터 지원)
  if (/(검진|병원|검사|결과지|서류)/.test(q)) {
    const screeningRecords = activeRecords.filter(
      (r) =>
        r.recordType === "health_screening" ||
        r.recordType === "lab_result" ||
        r.source === "ocr",
    );

    if (screeningRecords.length === 0) {
      return {
        answer: `${profileName}님의 저장된 건강검진 및 서류 기록이 없습니다. 검진 결과지(OCR)를 등록해 보세요!`,
        matchedRecords: [],
        category: "screening",
      };
    }

    const yearCond = parseYearCondition(q, referenceDate);
    let matchedList = screeningRecords;

    if (yearCond) {
      matchedList = screeningRecords.filter(
        (r) => new Date(r.recordedAt).getFullYear() === yearCond.year,
      );

      if (matchedList.length === 0) {
        return {
          answer: `${profileName}님의 ${yearCond.label}에 저장된 건강검진 및 서류 기록을 찾지 못했습니다.`,
          matchedRecords: [],
          category: "screening",
        };
      }
    }

    const latest = matchedList[0];
    const p = (latest.payload as Record<string, unknown>) ?? {};
    const dateStr = latest.recordedAt.slice(0, 10);
    const title = p.screeningName ?? (latest.source === "ocr" ? "검진 서류 OCR 기록" : "검사 결과 기록");

    const countPrefix = yearCond ? `${yearCond.label} 총 ${matchedList.length}건 보관 중` : `총 ${screeningRecords.length}회의 검진/검사 이력이 보관되어 있습니다`;
    const answer = `${yearCond ? `${yearCond.label} ` : "가장 최근 "}검진 기록은 ${dateStr}에 등록된 ${title}입니다. (${countPrefix})`;
    const evidenceText = `근거: ${formatSourceLabel(latest.source)} · ${title} · ${dateStr}`;

    return {
      answer,
      matchedRecords: matchedList.slice(0, 3),
      category: "screening",
      metricSummary: {
        label: String(title),
        latestValue: `${matchedList.length}회 기록됨`,
        latestDate: dateStr,
        evidenceText,
      },
    };
  }

  // 6. 일반 검색 fallback (삭제되지 않은 활성 기록만 최신순으로 반환)
  return {
    answer: `${profileName}님의 로컬 기록을 확인했습니다. 현재 총 ${activeRecords.length}건의 건강기록이 보관되어 있습니다. '지난번 혈당 얼마였지?'나 '최근 통증 기록 알려줘'처럼 구체적인 항목을 물어보시면 상세히 찾아드릴게요!`,
    matchedRecords: activeRecords.slice(0, 3),
    category: "general",
  };
}
