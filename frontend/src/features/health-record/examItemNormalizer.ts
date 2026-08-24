export type ExamCategory =
  | "blood_glucose"
  | "blood_pressure"
  | "liver"
  | "lipid"
  | "kidney"
  | "other";

export type MatchType = "exact" | "alias" | "fuzzy" | "unrecognized";

export interface CanonicalExamDefinition {
  canonicalName: string;
  category: ExamCategory;
  standardUnit: string;
  aliases: string[];
  fuzzyKeywords?: string[];
  forbiddenKeywords?: string[];
}

export interface NormalizedExamItem {
  rawName: string;
  canonicalName: string;
  category: ExamCategory;
  standardUnit: string;
  unit: string;
  matchType: MatchType;
}

export const CANONICAL_EXAM_DEFINITIONS: CanonicalExamDefinition[] = [
  // 1. 혈당 지표 (공복혈당 / 식후혈당 / 당화혈색소는 절대 서로 섞이지 않도록 명확히 분리)
  {
    canonicalName: "공복혈당",
    category: "blood_glucose",
    standardUnit: "mg/dL",
    aliases: [
      "공복혈당",
      "공복 혈당",
      "fbs",
      "fasting blood glucose",
      "glucose fasting",
      "fasting blood sugar",
      "식전혈당",
      "식전 혈당",
      "혈당(식전)",
      "혈당(공복)",
      "공복시혈당",
      "공복시 혈당",
    ],
    fuzzyKeywords: ["공복혈당", "식전혈당", "fbs"],
    forbiddenKeywords: ["식후", "pp2", "postprandial", "당화혈색소", "hba1c", "a1c"],
  },
  {
    canonicalName: "식후혈당",
    category: "blood_glucose",
    standardUnit: "mg/dL",
    aliases: [
      "식후혈당",
      "식후 혈당",
      "postprandial blood glucose",
      "pp2",
      "식후2시간혈당",
      "식후 2시간 혈당",
      "혈당(식후)",
      "식후시혈당",
      "식후시 혈당",
    ],
    fuzzyKeywords: ["식후혈당", "pp2", "식후2시간"],
    forbiddenKeywords: ["공복", "식전", "fbs", "당화혈색소", "hba1c", "a1c"],
  },
  {
    canonicalName: "당화혈색소 (HbA1c)",
    category: "blood_glucose",
    standardUnit: "%",
    aliases: [
      "당화혈색소",
      "당화 혈색소",
      "hba1c",
      "hemoglobin a1c",
      "a1c",
      "glycated hemoglobin",
      "당화혈색소(hba1c)",
      "당화혈색소 (hba1c)",
    ],
    fuzzyKeywords: ["당화혈색소", "hba1c"],
    forbiddenKeywords: ["공복", "식전", "식후", "fbs", "pp2"],
  },

  // 2. 혈압 지표 (수축기 / 이완기는 절대 서로 섞이지 않도록 분리)
  {
    canonicalName: "수축기 혈압",
    category: "blood_pressure",
    standardUnit: "mmHg",
    aliases: [
      "수축기 혈압",
      "수축기혈압",
      "sbp",
      "최고혈압",
      "최고 혈압",
      "systolic",
      "systolic bp",
      "수축기",
      "수축기 혈압(최고)",
    ],
    fuzzyKeywords: ["수축기", "sbp", "최고혈압"],
    forbiddenKeywords: ["이완기", "dbp", "최저혈압", "확장기"],
  },
  {
    canonicalName: "이완기 혈압",
    category: "blood_pressure",
    standardUnit: "mmHg",
    aliases: [
      "이완기 혈압",
      "이완기혈압",
      "dbp",
      "최저혈압",
      "최저 혈압",
      "diastolic",
      "diastolic bp",
      "이완기",
      "확장기",
      "이완기 혈압(최저)",
    ],
    fuzzyKeywords: ["이완기", "dbp", "최저혈압", "확장기"],
    forbiddenKeywords: ["수축기", "sbp", "최고혈압"],
  },

  // 3. 간기능 지표
  {
    canonicalName: "AST (SGOT)",
    category: "liver",
    standardUnit: "U/L",
    aliases: ["ast", "ast(sgot)", "ast (sgot)", "sgot", "got", "aspartate aminotransferase", "ast(got)"],
    fuzzyKeywords: ["ast", "sgot", "got"],
  },
  {
    canonicalName: "ALT (SGPT)",
    category: "liver",
    standardUnit: "U/L",
    aliases: ["alt", "alt(sgpt)", "alt (sgpt)", "sgpt", "gpt", "alanine aminotransferase", "alt(gpt)"],
    fuzzyKeywords: ["alt", "sgpt", "gpt"],
  },
  {
    canonicalName: "감마지티피 (γ-GTP)",
    category: "liver",
    standardUnit: "U/L",
    aliases: [
      "감마지티피",
      "감마 지티피",
      "γ-gtp",
      "r-gtp",
      "ggt",
      "감마-gtp",
      "감마gtp",
      "gamma-gtp",
      "gamma gtp",
      "y-gtp",
    ],
    fuzzyKeywords: ["감마지티피", "gtp", "ggt"],
  },

  // 4. 지질 / 콜레스테롤 지표
  {
    canonicalName: "총콜레스테롤",
    category: "lipid",
    standardUnit: "mg/dL",
    aliases: ["총콜레스테롤", "총 콜레스테롤", "total cholesterol", "total chol", "tc", "총콜레스테롤(tc)"],
    fuzzyKeywords: ["총콜레스테롤", "total cholesterol", "total chol"],
    forbiddenKeywords: ["hdl", "ldl"],
  },
  {
    canonicalName: "HDL 콜레스테롤",
    category: "lipid",
    standardUnit: "mg/dL",
    aliases: [
      "hdl",
      "hdl cholesterol",
      "hdl 콜레스테롤",
      "hdl-c",
      "hdl-콜레스테롤",
      "hdlc",
      "고밀도지단백",
      "고밀도 콜레스테롤",
    ],
    fuzzyKeywords: ["hdl"],
  },
  {
    canonicalName: "LDL 콜레스테롤",
    category: "lipid",
    standardUnit: "mg/dL",
    aliases: [
      "ldl",
      "ldl cholesterol",
      "ldl 콜레스테롤",
      "ldl-c",
      "ldl-콜레스테롤",
      "ldlc",
      "저밀도지단백",
      "저밀도 콜레스테롤",
    ],
    fuzzyKeywords: ["ldl"],
  },
  {
    canonicalName: "중성지방 (TG)",
    category: "lipid",
    standardUnit: "mg/dL",
    aliases: ["중성지방", "중성 지방", "triglyceride", "tg", "중성지방(tg)", "triglycerides"],
    fuzzyKeywords: ["중성지방", "triglyceride"],
  },

  // 5. 신장 기능 및 요검사 지표
  {
    canonicalName: "혈청 크레아티닌",
    category: "kidney",
    standardUnit: "mg/dL",
    aliases: ["혈청 크레아티닌", "크레아티닌", "creatinine", "혈청크레아티닌", "cr", "혈청 크레아티닌(cr)"],
    fuzzyKeywords: ["크레아티닌", "creatinine"],
  },
  {
    canonicalName: "신사구체여과율 (e-GFR)",
    category: "kidney",
    standardUnit: "mL/min",
    aliases: [
      "신사구체여과율",
      "사구체여과율",
      "신사구체 여과율",
      "사구체 여과율",
      "e-gfr",
      "egfr",
      "gfr",
      "신사구체여과율(e-gfr)",
    ],
    fuzzyKeywords: ["사구체여과율", "egfr", "e-gfr", "gfr"],
  },
  {
    canonicalName: "요단백",
    category: "kidney",
    standardUnit: "",
    aliases: ["요단백", "요 단백", "protein in urine", "urine protein", "요단백(protein)"],
    fuzzyKeywords: ["요단백"],
  },

  // 6. 기타 일반 신체/활력 징후 측정 지표
  {
    canonicalName: "혈색소 (헤모글로빈)",
    category: "other",
    standardUnit: "g/dL",
    aliases: ["혈색소", "헤모글로빈", "hemoglobin", "hb", "혈색소(헤모글로빈)"],
    fuzzyKeywords: ["혈색소", "헤모글로빈"],
    forbiddenKeywords: ["당화혈색소", "hba1c"],
  },
  {
    canonicalName: "체질량지수 (BMI)",
    category: "other",
    standardUnit: "kg/m²",
    aliases: ["bmi", "체질량지수", "체질량 지수", "body mass index", "체질량지수(bmi)"],
    fuzzyKeywords: ["체질량지수", "bmi"],
  },
  {
    canonicalName: "허리둘레",
    category: "other",
    standardUnit: "cm",
    aliases: ["허리둘레", "허리 둘레", "waist", "waist circumference"],
    fuzzyKeywords: ["허리둘레", "waist"],
  },
  {
    canonicalName: "맥박수",
    category: "other",
    standardUnit: "bpm",
    aliases: ["맥박수", "맥박", "심박수", "pulse", "hr", "heart rate", "맥박(분)", "맥박수(분)"],
    fuzzyKeywords: ["맥박", "심박"],
  },
  {
    canonicalName: "내장지방레벨",
    category: "other",
    standardUnit: "",
    aliases: ["내장지방레벨", "내장지방", "내장지방수치", "내장지방 레벨", "내장지방 등급"],
    fuzzyKeywords: ["내장지방"],
  },
  {
    canonicalName: "복부지방률",
    category: "other",
    standardUnit: "",
    aliases: ["복부지방률", "복부지방율", "복부비만율", "복부 지방률", "복부 지방율", "waist hip ratio", "whr"],
    fuzzyKeywords: ["복부지방", "복부비만"],
  },
  {
    canonicalName: "키 (신장)",
    category: "other",
    standardUnit: "cm",
    aliases: ["키", "신장", "height", "ht", "키(신장)", "신장(cm)", "키(cm)"],
    fuzzyKeywords: ["신장", "키"],
    forbiddenKeywords: ["신사구체", "gfr", "egfr"],
  },
  {
    canonicalName: "체중 (몸무게)",
    category: "other",
    standardUnit: "kg",
    aliases: ["체중", "몸무게", "weight", "wt", "체중(몸무게)", "체중(kg)", "몸무게(kg)"],
    fuzzyKeywords: ["체중", "몸무게"],
    forbiddenKeywords: ["중성지방", "tg"],
  },
];

const JUDGMENT_WORDS = new Set([
  "정상",
  "정상a",
  "정상b",
  "정상(a)",
  "정상(b)",
  "음성",
  "양성",
  "의심",
  "질환의심",
  "유질환자",
  "비해당",
  "비대상",
  "해당없음",
  "미시행",
  "-",
  "+",
  "++",
  "+++",
  "1+",
  "2+",
  "3+",
  "4+",
  "negative",
  "positive",
  "normal",
]);

/**
 * 문자열을 정규화합니다 (소문자화, 공백/특수문자 통일).
 */
export function normalizeString(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[\s\-_/()[\]·•:]/g, "");
}

/**
 * 측정 단위를 표준 표기로 정규화합니다.
 * '정상', '음성', '비해당' 등 판정 단어가 단위로 잘못 들어온 경우 빈 문자열로 정제합니다.
 */
export function normalizeUnit(rawUnit?: string): string {
  if (!rawUnit) return "";
  const cleaned = rawUnit.trim();
  const lower = cleaned.toLowerCase();

  // 판정/결과 단어가 단위 컬럼에 잘못 들어온 경우 제거
  if (JUDGMENT_WORDS.has(lower) || JUDGMENT_WORDS.has(cleaned)) return "";

  if (lower === "mg/dl" || lower === "mg/dL" || lower === "mg/100ml") return "mg/dL";
  if (lower === "u/l" || lower === "iu/l" || lower === "iu/L") return "U/L";
  if (lower === "mmhg" || lower === "mmHg") return "mmHg";
  if (lower === "ml/min" || lower === "ml/min/1.73m2" || lower === "ml/min/1.73㎡") return "mL/min/1.73m²";
  if (lower === "g/dl" || lower === "g/dL") return "g/dL";
  if (lower === "%") return "%";
  if (lower === "kg/m2" || lower === "kg/m²") return "kg/m²";
  if (lower === "cm") return "cm";
  if (lower === "kg") return "kg";
  if (lower === "bpm" || lower === "회/분" || lower === "회/min") return "bpm";

  return cleaned;
}

/**
 * 두 단위가 같은 시계열 차트에서 비교 가능한지 검사합니다.
 * 서로 다른 단위(예: mg/dL vs %, mg/dL vs mmol/L)는 같은 차트에 섞이지 않도록 방어합니다.
 */
export function isUnitCompatible(standardUnit: string, itemUnit: string): boolean {
  if (!standardUnit && !itemUnit) return true;
  if (!standardUnit || !itemUnit) return true; // 단위가 생략된 경우 기본 단위 허용

  const u1 = normalizeUnit(standardUnit);
  const u2 = normalizeUnit(itemUnit);

  // 대소문자 무관 동일 단위인지 검사
  return u1.toLowerCase() === u2.toLowerCase();
}

/**
 * 임의의 원본 검사명을 표준 검사항목으로 정규화 매핑합니다.
 * 매핑되지 않는 항목은 절대 삭제하지 않고, "기타 검사(원문 보존)" 형태로 매핑 메타데이터와 함께 보존합니다.
 */
export function normalizeExamItem(rawName: string, rawUnit?: string): NormalizedExamItem {
  const trimmedRaw = rawName.trim();
  const normalizedRaw = normalizeString(trimmedRaw);
  const normalizedRawUnit = normalizeUnit(rawUnit);

  // 1. 완전 일치 (Exact Match)
  for (const def of CANONICAL_EXAM_DEFINITIONS) {
    if (trimmedRaw === def.canonicalName || normalizeString(def.canonicalName) === normalizedRaw) {
      return {
        rawName: trimmedRaw,
        canonicalName: def.canonicalName,
        category: def.category,
        standardUnit: def.standardUnit,
        unit: normalizedRawUnit || def.standardUnit,
        matchType: "exact",
      };
    }
  }

  // 2. 동의어/별칭 일치 (Alias Match)
  for (const def of CANONICAL_EXAM_DEFINITIONS) {
    for (const alias of def.aliases) {
      if (normalizeString(alias) === normalizedRaw) {
        return {
          rawName: trimmedRaw,
          canonicalName: def.canonicalName,
          category: def.category,
          standardUnit: def.standardUnit,
          unit: normalizedRawUnit || def.standardUnit,
          matchType: "alias",
        };
      }
    }
  }

  // 3. 퍼지/키워드 포함 일치 (Fuzzy Match with Forbidden Guard)
  for (const def of CANONICAL_EXAM_DEFINITIONS) {
    // 금지어 검사 (예: 식후혈당 키워드가 공복혈당에 들어가는 것 방지)
    if (def.forbiddenKeywords) {
      const hasForbidden = def.forbiddenKeywords.some((forbidden) =>
        normalizedRaw.includes(normalizeString(forbidden))
      );
      if (hasForbidden) continue;
    }

    if (def.fuzzyKeywords) {
      const matchedFuzzy = def.fuzzyKeywords.some((kw) =>
        normalizedRaw.includes(normalizeString(kw))
      );
      if (matchedFuzzy) {
        return {
          rawName: trimmedRaw,
          canonicalName: def.canonicalName,
          category: def.category,
          standardUnit: def.standardUnit,
          unit: normalizedRawUnit || def.standardUnit,
          matchType: "fuzzy",
        };
      }
    }
  }

  // 4. 매핑되지 않은 경우: 원본 검사명을 그대로 보존하고 "unrecognized"로 처리
  return {
    rawName: trimmedRaw,
    canonicalName: trimmedRaw,
    category: "other",
    standardUnit: normalizedRawUnit,
    unit: normalizedRawUnit,
    matchType: "unrecognized",
  };
}
