/**
 * 자연어 건강기록 의도 분류 및 엔티티 추출기
 *
 * 사용자가 입력한 자연어 문장을 분석하여:
 * 1) 기록 검색/질의 (Query Intent)
 * 2) 수치 기록 의도 (Metric Entry Intent) - 확인 후 작성
 * 3) 통증 기록 의도 (Pain Entry Intent) - 확인 후 작성
 * 4) 검진 서류 업로드 의도 (OCR Intent) - 확인 후 전환
 * 5) 일반 안내 (General)
 * 로 분류합니다.
 */

export type AssistantIntentType =
  | "query_metric"
  | "query_pain"
  | "query_screening"
  | "query_general"
  | "record_blood_glucose"
  | "record_blood_pressure"
  | "record_body_measurement"
  | "record_pain"
  | "record_ocr"
  | "general_help";

export interface ParsedMetricData {
  type: "blood_glucose" | "blood_pressure" | "body_measurement" | "composite";
  glucose?: number;
  timing?: "fasting" | "before_meal" | "after_meal" | "random";
  timingAmbiguous?: boolean;
  selectedDate?: string; // YYYY-MM-DD (e.g. 2026-08-25)
  dateLabel?: string; // "어제 (8/25)"
  suggestedDates?: { date: string; label: string }[];
  timeSlot?: "morning" | "afternoon" | "evening" | "night" | "general";
  suggestedHours?: string[];
  selectedHour?: string;
  systolic?: number;
  diastolic?: number;
  weightKg?: number;
  heightCm?: number;
  hasMultipleMetrics?: boolean;
  rawText: string;
}

export interface ParsedPainData {
  bodyArea: string;
  sensation?: string;
  intensity?: number;
  onsetKeyword?: string;
  rawText: string;
}

export interface ParsedIntentResult {
  intent: AssistantIntentType;
  confidence: number;
  originalText: string;
  metricData?: ParsedMetricData;
  painData?: ParsedPainData;
  confirmationMessage?: string;
}

export function parseDateFromKorean(text: string): {
  selectedDate: string;
  dateLabel: string;
  suggestedDates: { date: string; label: string }[];
  isFuture?: boolean;
} {
  const now = new Date();

  const formatDateStr = (d: Date) => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const getRelativeDate = (offsetDays: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() + offsetDays);
    return d;
  };

  const today = getRelativeDate(0);
  const yesterday = getRelativeDate(-1);
  const twoDaysAgo = getRelativeDate(-2);

  const todayStr = formatDateStr(today);
  const yesterdayStr = formatDateStr(yesterday);
  const twoDaysAgoStr = formatDateStr(twoDaysAgo);

  const suggestedDates = [
    { date: twoDaysAgoStr, label: `그저께 (${twoDaysAgo.getMonth() + 1}/${twoDaysAgo.getDate()})` },
    { date: yesterdayStr, label: `어제 (${yesterday.getMonth() + 1}/${yesterday.getDate()})` },
    { date: todayStr, label: `오늘 (${today.getMonth() + 1}/${today.getDate()})` },
  ];

  // 0. 미래 날짜 감지 (내일, 모레, 글피, 다음주, N일 뒤/후 등)
  if (/(내일|낼|모레|글피|다음\s*주|다음\s*달|이따|나중|[0-9]{1,2}\s*일\s*(?:뒤|후))/.test(text)) {
    return {
      selectedDate: todayStr,
      dateLabel: "미래",
      suggestedDates,
      isFuture: true,
    };
  }

  // 1. 어제
  if (/(어제|어젯밤|어저께)/.test(text)) {
    return {
      selectedDate: yesterdayStr,
      dateLabel: `어제 (${yesterday.getMonth() + 1}/${yesterday.getDate()})`,
      suggestedDates,
    };
  }

  // 2. 그저께, 그제, 2일 전
  if (/(그저께|그제|이틀\s*전|2일\s*전)/.test(text)) {
    return {
      selectedDate: twoDaysAgoStr,
      dateLabel: `그저께 (${twoDaysAgo.getMonth() + 1}/${twoDaysAgo.getDate()})`,
      suggestedDates,
    };
  }

  // 3. N일 전
  const daysAgoMatch = text.match(/([0-9]{1,2})\s*일\s*전/);
  if (daysAgoMatch) {
    const days = parseInt(daysAgoMatch[1], 10);
    const target = getRelativeDate(-days);
    const targetStr = formatDateStr(target);
    return {
      selectedDate: targetStr,
      dateLabel: `${days}일 전 (${target.getMonth() + 1}/${target.getDate()})`,
      suggestedDates,
    };
  }

  // 4. M월 D일 또는 M/D
  const monthDayMatch =
    text.match(/([0-9]{1,2})\s*월\s*([0-9]{1,2})\s*일/) ||
    text.match(/([0-9]{1,2})\s*\/\s*([0-9]{1,2})/);
  if (monthDayMatch) {
    const month = parseInt(monthDayMatch[1], 10);
    const day = parseInt(monthDayMatch[2], 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const year = now.getFullYear();
      const target = new Date(year, month - 1, day);
      const targetStr = formatDateStr(target);
      const isFuture = targetStr > todayStr;
      return {
        selectedDate: isFuture ? todayStr : targetStr,
        dateLabel: `${month}/${day}`,
        suggestedDates,
        isFuture,
      };
    }
  }

  return {
    selectedDate: todayStr,
    dateLabel: `오늘 (${today.getMonth() + 1}/${today.getDate()})`,
    suggestedDates,
  };
}

export function parseTimeSlotAndSuggestions(text: string): {
  timeSlot: "morning" | "afternoon" | "evening" | "night" | "general";
  suggestedHours: string[];
  defaultHour: string;
} {
  const specificHourMatch = text.match(/([0-9]{1,2})\s*시/);
  const hourNum = specificHourMatch ? parseInt(specificHourMatch[1], 10) : undefined;

  if (/(오전|아침|새벽)/.test(text)) {
    const hours = ["07:00", "08:00", "09:00", "10:00", "11:00"];
    const def = hourNum && hourNum <= 12 ? `${String(hourNum).padStart(2, "0")}:00` : "08:00";
    return {
      timeSlot: "morning",
      suggestedHours: hours,
      defaultHour: hours.includes(def) ? def : "08:00",
    };
  }

  if (/(오후|낮|점심)/.test(text)) {
    const hours = ["12:00", "13:00", "14:00", "15:00", "16:00", "17:00"];
    const normHour = hourNum ? (hourNum < 12 ? hourNum + 12 : hourNum) : 13;
    const def = `${String(normHour).padStart(2, "0")}:00`;
    return {
      timeSlot: "afternoon",
      suggestedHours: hours,
      defaultHour: hours.includes(def) ? def : "13:00",
    };
  }

  if (/(저녁|밤|취침)/.test(text)) {
    const hours = ["18:00", "19:00", "20:00", "21:00", "22:00"];
    const normHour = hourNum ? (hourNum < 12 ? hourNum + 12 : hourNum) : 19;
    const def = `${String(normHour).padStart(2, "0")}:00`;
    return {
      timeSlot: "evening",
      suggestedHours: hours,
      defaultHour: hours.includes(def) ? def : "19:00",
    };
  }

  const now = new Date();
  const currentHour = `${String(now.getHours()).padStart(2, "0")}:00`;
  const defaultHours = ["07:00", "08:00", "09:00", "12:00", "18:00", "21:00"];
  if (!defaultHours.includes(currentHour)) {
    defaultHours.push(currentHour);
    defaultHours.sort();
  }

  return {
    timeSlot: "general",
    suggestedHours: defaultHours,
    defaultHour: currentHour,
  };
}

const BODY_AREAS = [
  "머리", "두통", "목", "어깨", "허리", "등", "가슴", "복부", "배", "골반",
  "손목", "손가락", "손", "팔꿈치", "팔", "무릎", "발목", "발가락", "발", "다리",
  "엉덩이", "치아", "턱", "눈", "귀", "옆구리",
];

const DIRECTION_PREFIXES = ["오른쪽", "왼쪽", "양쪽", "우측", "좌측"];

const PAIN_SENSATIONS = [
  "욱신", "찌릿", "뻐근", "콕콕", "시큰", "결림", "당김", "화끈", "저림", "묵직", "쥐", "쓰림",
];

const QUESTION_KEYWORDS = [
  "얼마", "언제", "있어", "있나요", "어때", "보여줘", "알려줘", "조회", "찾아", "기록된", "이전", "지난번", "마지막", "최근", "확인", "기록있", "내역",
];

const QUESTION_PATTERNS = [
  /\?$/,
  /얼[마ㄹ]/,
  /언제/,
  /(있|없)(어|나|니|습니까|었어|었나요)/,
  /(보여|알려|가르쳐)\s*(줘|주세요|줄래)/,
  /(확인|조회|검색)\s*(해줘|해주세요|부탁)/,
];

export function parseHealthIntent(input: string): ParsedIntentResult {
  const text = input.trim();

  // 1. OCR 서류 업로드 의도 감지
  if (
    /(검진표|검진\s*결과|결과지|건강검진\s*서류|진단서|처방전|pdf|이미지|사진|서류).*(올리|올릴|올려|등록|업로드|찍|첨부|추가|가져오|스캔)/.test(text) ||
    /^(서류\s*올리기|검진\s*서류|ocr|문서\s*등록|서류\s*등록)$/.test(text)
  ) {
    return {
      intent: "record_ocr",
      confidence: 0.9,
      originalText: text,
      confirmationMessage: "검진 결과지 문서를 등록하고 기록할까요?",
    };
  }

  // 2. 수치 기록 감지 (혈압, 혈당, 체중 등 복합 수치 지원)
  const timeInfo = parseTimeSlotAndSuggestions(text);
  const dateInfo = parseDateFromKorean(text);

  // 미래 일자 기록 입력 시도 시 거부 안내
  if (dateInfo.isFuture) {
    return {
      intent: "general_help",
      confidence: 1.0,
      originalText: text,
      confirmationMessage: "미래 일자의 건강 수치는 기록할 수 없습니다. 오늘 또는 과거에 측정한 기록을 입력해 주세요.",
    };
  }

  // 2-1) 혈압 추출 (예: "혈압 120에 80", "혈압은 125에 82였어", "125/82 쟀어", "90/120")
  let sbp: number | undefined;
  let dbp: number | undefined;
  const bpMatch =
    text.match(/혈압\s*(?:수치|값|검사|측정)?\s*(?:은|는|이|가|도|을|를|의)?\s*(?:했|했는|했는데|였|이었|으로|에)?\s*,?\s*([0-9]{2,3})\s*(?:에|\/|~|\s+)\s*([0-9]{2,3})/) ||
    text.match(/([0-9]{2,3})\s*\/\s*([0-9]{2,3})/);
  if (bpMatch && !text.includes("?")) {
    const num1 = parseInt(bpMatch[1], 10);
    const num2 = parseInt(bpMatch[2], 10);
    const maxVal = Math.max(num1, num2);
    const minVal = Math.min(num1, num2);
    if (maxVal >= 60 && maxVal <= 260 && minVal >= 40 && minVal <= 160 && maxVal > minVal) {
      sbp = maxVal;
      dbp = minVal;
    }
  }

  // 2-2) 혈당 추출 (예: "오늘 아침 혈당은 90", "혈당은 115였어", "공복혈당 98 나왔어")
  let glucoseVal: number | undefined;
  let timing: ParsedMetricData["timing"] = "random";
  let timingAmbiguous = true;
  let timingLabel = "혈당";

  const glucoseMatch =
    text.match(/(?:공복|식후|식전|아침|오전|저녁|점심|낮|새벽)?\s*혈당\s*(?:수치|값|검사|측정)?\s*(?:은|는|이|가|도|을|를|의)?\s*(?:했|했는|했는데|였|이었|으로|에)?\s*,?\s*([0-9]{2,3})/) ||
    text.match(/혈당\s*(?:검사|측정)?\s*(?:했|는|도|가|결과|은|이)?\s*(?:했는데)?\s*,?\s*(?:수치)?\s*([0-9]{2,3})/) ||
    ((text.includes("혈당") || text.includes("당수치") || text.includes("공복") || text.includes("식후") || /mg/i.test(text))
      ? text.match(/([0-9]{2,3})\s*(?:mg\/dl|mg|점)?\s*(?:나왔|측정|쟀|나옴|찍힘|이었|였|임|이야|입니다|였음)/i)
      : null);

  if (glucoseMatch && !text.includes("?")) {
    const val = parseInt(glucoseMatch[1], 10);
    if (val >= 40 && val <= 500) {
      glucoseVal = val;
      if (text.includes("공복")) {
        timing = "fasting";
        timingLabel = "공복혈당";
        timingAmbiguous = false;
      } else if (text.includes("식후")) {
        timing = "after_meal";
        timingLabel = "식후혈당";
        timingAmbiguous = false;
      } else if (text.includes("식전")) {
        timing = "before_meal";
        timingLabel = "식전혈당";
        timingAmbiguous = false;
      } else if (text.includes("공복") || text.includes("아침") || text.includes("오전")) {
        timing = "fasting";
        timingLabel = "공복혈당";
        timingAmbiguous = true;
      } else if (text.includes("점심") || text.includes("저녁")) {
        timing = "after_meal";
        timingLabel = "식후혈당";
        timingAmbiguous = true;
      }
    }
  }

  // 2-3) 체중 추출 (예: "몸무게는 72.4kg야", "체중은 68이었어")
  let weightVal: number | undefined;
  const weightMatch =
    text.match(/(?:몸무게|체중)\s*(?:수치|값|검사|측정)?\s*(?:은|는|이|가|도|을|를|의)?\s*(?:했|했는|했는데|였|이었|으로|에)?\s*,?\s*([0-9]{2,3}(?:\.[0-9])?)\s*(?:kg|킬로)?/) ||
    text.match(/([0-9]{2,3}(?:\.[0-9])?)\s*kg/i);
  if (weightMatch && !text.includes("?")) {
    const wt = parseFloat(weightMatch[1]);
    if (wt >= 20 && wt <= 250) {
      weightVal = wt;
    }
  }

  // 수치 감지 개수 확인 (복수/단일)
  const detectedCount =
    (sbp !== undefined ? 1 : 0) +
    (glucoseVal !== undefined ? 1 : 0) +
    (weightVal !== undefined ? 1 : 0);

  if (detectedCount > 0) {
    const parts: string[] = [];
    if (glucoseVal !== undefined) parts.push(`${timingLabel} ${glucoseVal} mg/dL`);
    if (sbp !== undefined && dbp !== undefined) parts.push(`수축기 ${sbp} / 이완기 ${dbp} mmHg 혈압`);
    if (weightVal !== undefined) parts.push(`체중 ${weightVal} kg`);

    const confirmMsg =
      detectedCount > 1
        ? `${parts.join(", ")} 수치를 함께 기록할까요?`
        : `${parts[0]} 수치를 기록할까요?`;

    const primaryType: ParsedMetricData["type"] =
      detectedCount > 1
        ? "composite"
        : glucoseVal !== undefined
        ? "blood_glucose"
        : sbp !== undefined
        ? "blood_pressure"
        : "body_measurement";

    const intentType: AssistantIntentType =
      primaryType === "blood_pressure"
        ? "record_blood_pressure"
        : primaryType === "body_measurement"
        ? "record_body_measurement"
        : "record_blood_glucose";

    return {
      intent: intentType,
      confidence: 0.95,
      originalText: text,
      metricData: {
        type: primaryType,
        glucose: glucoseVal,
        timing,
        timingAmbiguous,
        systolic: sbp,
        diastolic: dbp,
        weightKg: weightVal,
        hasMultipleMetrics: detectedCount > 1,
        selectedDate: dateInfo.selectedDate,
        dateLabel: dateInfo.dateLabel,
        suggestedDates: dateInfo.suggestedDates,
        timeSlot: timeInfo.timeSlot,
        suggestedHours: timeInfo.suggestedHours,
        selectedHour: timeInfo.defaultHour,
        rawText: text,
      },
      confirmationMessage: confirmMsg,
    };
  }

  // 3. 검색/질의 의도 감지 (Query Intent)
  const isQuestion =
    QUESTION_KEYWORDS.some((kw) => text.includes(kw)) ||
    QUESTION_PATTERNS.some((p) => p.test(text));

  if (isQuestion) {
    // 혈당 검색
    if (/(혈당|당수치|공복혈당|식후혈당|glucose)/.test(text)) {
      return {
        intent: "query_metric",
        confidence: 0.9,
        originalText: text,
      };
    }
    // 혈압 검색
    if (/(혈압|수축기|이완기|최고혈압|최저혈압|bp)/.test(text)) {
      return {
        intent: "query_metric",
        confidence: 0.9,
        originalText: text,
      };
    }
    // 체중/체격 검색
    if (/(몸무게|체중|키|신장|bmi|비만)/.test(text)) {
      return {
        intent: "query_metric",
        confidence: 0.9,
        originalText: text,
      };
    }
    // 통증 기록 검색
    if (/(통증|아픈|아팠|무릎|허리|어깨|손목|발목|머리|두통|목|등|팔|다리)/.test(text)) {
      return {
        intent: "query_pain",
        confidence: 0.9,
        originalText: text,
      };
    }
    // 검진 이력 검색
    if (/(검진|병원|검사|결과지|서류)/.test(text)) {
      return {
        intent: "query_screening",
        confidence: 0.9,
        originalText: text,
      };
    }
    // 일반 조회
    return {
      intent: "query_general",
      confidence: 0.75,
      originalText: text,
    };
  }

  // 4. 통증 기록 의도 감지 (신체 부위 또는 통증 양상 서술)
  let matchedArea: string | undefined;
  for (const area of BODY_AREAS) {
    if (text.includes(area)) {
      matchedArea = area;
      for (const dir of DIRECTION_PREFIXES) {
        if (text.includes(`${dir} ${area}`) || text.includes(`${dir}${area}`)) {
          matchedArea = `${dir} ${area}`;
          break;
        }
      }
      break;
    }
  }

  let matchedSensation: string | undefined;
  for (const s of PAIN_SENSATIONS) {
    if (text.includes(s)) {
      matchedSensation = s;
      break;
    }
  }

  if (matchedArea || matchedSensation || text.includes("통증") || text.includes("아파") || text.includes("아픔")) {
    const finalArea = matchedArea ?? "통증 부위";
    return {
      intent: "record_pain",
      confidence: 0.85,
      originalText: text,
      painData: {
        bodyArea: finalArea,
        sensation: matchedSensation,
        rawText: text,
      },
      confirmationMessage: `${finalArea} 통증 기록을 작성할까요?`,
    };
  }

  // 7. 기본 도움말
  return {
    intent: "general_help",
    confidence: 0.5,
    originalText: text,
    confirmationMessage: "봄이에게 기록 검색이나 수치·통증 기록을 말씀해 주세요.",
  };
}
