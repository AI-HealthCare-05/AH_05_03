/**
 * 건강 비서가 쓰는 순수 계산 — 날짜 해석·자동저장 판단·기록 필터·지표 추출.
 *
 * **컴포넌트와 파일을 가른다.** 한 파일에서 컴포넌트와 함수를 같이 내보내면 fast
 * refresh 가 꺼진다(리액트 플러그인 규칙). 이 함수들은 화면 없이 단위로 검증되는
 * 쪽이기도 해서, 갈라 두면 테스트가 3,000줄짜리 컴포넌트를 import 하지 않아도 된다.
 *
 * PR #27 원본에서는 `HealthAssistantDrawer.tsx` 안에 있었다.
 */

import type { ChatMessage, HealthAssistantResponse } from "./healthAssistantClient";
import type { ChatMessageData } from "../../shared/api/contracts";
import type { GeminiOcrResult } from "../../shared/api/geminiOcrAdapter";
import type { HealthRecord, HealthRecordType } from "../../shared/local/domainContracts";

export type RawOcrTable = GeminiOcrResult["tables"][number];

export interface MetricDataPoint {
  date: string; // YYYY-MM-DD
  value: number;
  secondaryValue?: number; // 혈압의 경우 diastolic, 간수치의 경우 ALT
  note?: string;
}

export interface MetricSeries {
  key: string;
  name: string;
  unit: string;
  color: string;
  secondaryColor?: string;
  secondaryName?: string;
  normalRange?: { min?: number; max?: number; label: string };
  points: MetricDataPoint[];
}

export interface ExtendedChatMessage extends ChatMessage {
  id: string;
  responseDraft?: HealthAssistantResponse;
  saved?: boolean;
  imageBlobUrl?: string;
  imageFile?: File;
  attachedDocuments?: Array<{ id: string; fileName?: string }>;
  queriedRecords?: HealthRecord[];
  queriedRecordsTitle?: string;
  showTrendChart?: boolean;
  trendMetrics?: MetricSeries[];
  trendInitialKey?: string;
}

export interface OcrReviewItem {
  testName: string;
  value: string;
  unit: string;
  judgment: string;
}

export const PRIMARY_HOUSEHOLD_ID = "household-local-primary";

function toLocalMinuteString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

/**
 * 사용자가 복용 시각을 말하지 않은 단순 과거형("한 알 먹었어")은
 * LLM이 임의 시각을 만들지 못하도록 요청을 받은 현재 시각을 후보로 사용한다.
 */
export function resolveMedicationTakenAt(
  userMessage: string,
  extractedTakenAt?: string | null,
  now = new Date(),
): string {
  const hasExplicitClockOrPeriod =
    /(?:아침|점심|저녁|밤|새벽|오전|오후|식전|식후|취침|기상|\d{1,2}\s*(?:시|:)|\d+\s*분\s*전)/.test(
      userMessage,
    );
  if (hasExplicitClockOrPeriod && extractedTakenAt) return extractedTakenAt;

  if (/(?:어제|그제)/.test(userMessage) && extractedTakenAt) {
    return extractedTakenAt.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? extractedTakenAt;
  }

  return toLocalMinuteString(now);
}

/**
 * 완료한 건강기록의 시각이 생략됐거나 오늘 날짜만 추출된 경우에는
 * UTC 자정(한국 시각 09:00)으로 저장하지 않고 실제 입력 시각을 사용한다.
 */
export function resolveHealthRecordDateTime(
  userMessage: string,
  extractedDateTime?: string | null,
  now = new Date(),
): string {
  const localNow = toLocalMinuteString(now);
  if (!extractedDateTime) return localNow;

  const value = extractedDateTime.trim();
  const dateOnly = value.match(/^(\d{4}-\d{2}-\d{2})$/)?.[1];
  if (dateOnly === localNow.slice(0, 10)) return localNow;

  const hasExplicitClock =
    /(?:아침|점심|저녁|밤|새벽|오전|오후|정오|자정|\d{1,2}\s*(?:시|:)|\d+\s*분\s*전)/.test(
      userMessage,
    );
  const refersToPastDate = /(?:어제|그제|지난|\d+\s*일\s*전|\d{4}\s*년|\d{1,2}\s*월\s*\d{1,2}\s*일)/.test(
    userMessage,
  );

  if (!hasExplicitClock && !refersToPastDate) return localNow;
  return value;
}

export function containsNewMedicationRecord(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  const isHypothetical = /(?:먹어도|복용해도|먹을까|복용할까|먹으면|복용하면)/.test(normalized);
  if (isHypothetical) return false;

  const statesCompletedIntake = /(?:먹었|복용했|복용함|먹음|투약했|삼켰)/.test(normalized);
  const hasDoseWithoutQuestion = /\d+(?:\.\d+)?\s*(?:알|정|캡슐|포|mg|ml|밀리그램|밀리리터)/i.test(normalized) &&
    !/(?:\?|？|돼|괜찮|가능)/.test(normalized);
  return statesCompletedIntake || hasDoseWithoutQuestion;
}

export function removeMedicationSavePrompt(message: string): string {
  return message
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => !/(?:약|복약|복용).*(?:기록|저장).*(?:저장|할까요|하시겠)/.test(sentence))
    .join(" ")
    .trim();
}

export function shouldAutoSaveHealthRecord(response: HealthAssistantResponse, userMessage: string): boolean {
  if (response.emergency_notice || response.missing_fields.length > 0) return false;
  if (!["record_exercise", "record_blood_pressure", "record_blood_glucose", "record_medication", "record_pain"].includes(response.intent)) return false;
  if (response.auto_save === true) return true;

  const normalized = userMessage.trim().toLowerCase();
  if (/(?:할\s*거|할게|하려고|예정|먹을\s*거|복용할\s*거|측정할\s*거)/.test(normalized)) return false;
  return /(?:했어|했어요|했다|했습니다|완료|먹었|복용했|나왔|측정했|쟀|뛰었|달렸|걸었|마셨|잤어|잤어요)/.test(normalized);
}

export function buildAutoSaveAssistantMessage(response: HealthAssistantResponse): string {
  let confirmation = "건강 기록에 저장했습니다.";
  if (response.intent === "record_exercise" && response.exercise_draft) {
    const draft = response.exercise_draft;
    const details = [
      draft.distance_km ? `${draft.distance_km}km` : "",
      draft.duration_minutes ? `${draft.duration_minutes}분` : "",
      draft.weight_kg ? `${draft.weight_kg}kg` : "",
      draft.reps ? `${draft.reps}회` : "",
      draft.sets ? `${draft.sets}세트` : "",
    ].filter(Boolean).join(" · ");
    confirmation = `${draft.exercise_name}${details ? ` ${details}` : ""} 운동을 기록했습니다.`;
  } else if (response.intent === "record_blood_pressure" && response.blood_pressure_draft) {
    confirmation = `혈압 ${response.blood_pressure_draft.systolic}/${response.blood_pressure_draft.diastolic}mmHg를 기록했습니다.`;
  } else if (response.intent === "record_blood_glucose" && response.blood_glucose_draft) {
    confirmation = `혈당 ${response.blood_glucose_draft.value}mg/dL를 기록했습니다.`;
  } else if (response.intent === "record_medication" && response.medication_draft) {
    confirmation = `${response.medication_draft.medication_name}${response.medication_draft.dosage ? ` ${response.medication_draft.dosage}` : ""} 복용 기록을 저장했습니다.`;
  } else if (response.intent === "record_pain" && response.pain_draft) {
    confirmation = `${response.pain_draft.body_area} 통증 강도 ${response.pain_draft.intensity}/10을 기록했습니다.`;
  }

  if (/(?:저장했습니다|기록했습니다)/.test(response.assistant_message)) return response.assistant_message;
  const remaining = response.assistant_message
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => !/(?:기록|저장).*(?:확인|할까요|하시겠|저장)/.test(sentence))
    .join(" ")
    .trim();
  return remaining ? `${confirmation}\n\n${remaining}` : confirmation;
}

export function normalizeBloodGlucoseTiming(value?: string | null): "fasting" | "before_meal" | "after_meal" | "bedtime" | "random" {
  if (value === "fasting" || value === "before_meal" || value === "after_meal" || value === "bedtime") return value;
  return "random";
}

// 텍스트/OCR 결과에서 실제 검사일자(YYYY-MM-DD) 추출
export function parseExamDateFromText(text: string): string | undefined {
  if (!text) return undefined;

  // 1-A. 최우선: '판정일', '검진일자' 등의 레이블 뒤에 오는 8자리 연속 숫자 (예: 판정일 20191228)
  const priority8DigitMatch = text.match(
    /(?:판정일|검진일자|수검일자|검사일자|진료일자|수검일|검진일|검사일|판정일자)\s*[:：]?\s*(19\d{2}|20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\b/i,
  );
  if (priority8DigitMatch) {
    const [, y, m, d] = priority8DigitMatch;
    return `${y}-${m}-${d}`;
  }

  // 1-B. '판정일', '검진일자' 등의 레이블 뒤에 오는 구분자 있는 날짜 (예: 검진일자: 2022-05-30, 판정일: 2019.12.28)
  const priorityDelimMatch = text.match(
    /(?:판정일|검진일자|수검일자|검사일자|진료일자|수검일|검진일|검사일|판정일자|일자)\s*[:：]?\s*(19\d{2}|20\d{2})[-.년/\s]+(0?[1-9]|1[0-2])[-.월/\s]+(3[01]|[12]\d|0?[1-9])/i,
  );
  if (priorityDelimMatch) {
    const y = priorityDelimMatch[1];
    const m = priorityDelimMatch[2].padStart(2, "0");
    const d = priorityDelimMatch[3].padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  // 2. 일반 날짜 패턴 매칭 (YYYY-MM-DD, YYYY.MM.DD, YYYY년 MM월 DD일, YYYY/MM/DD)
  const match = text.match(/\b(19\d{2}|20\d{2})[-.년/\s]+(0?[1-9]|1[0-2])[-.월/\s]+(3[01]|[12]\d|0?[1-9])/);
  if (match) {
    const y = match[1];
    const m = match[2].padStart(2, "0");
    const d = match[3].padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  // 3. 일반 8자리 연속 숫자 (예: 20191228)
  const general8DigitMatch = text.match(/\b(19\d{2}|20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\b/);
  if (general8DigitMatch) {
    const [, y, m, d] = general8DigitMatch;
    return `${y}-${m}-${d}`;
  }

  return undefined;
}

export function extractReviewItems(tables: RawOcrTable[]): OcrReviewItem[] {
  return tables.flatMap((table) => table.rows.flatMap((row: string[]) => {
    const cells = row.map((cell: string) => cell.trim());
    const testName = cells[0] ?? "";
    const value = cells[1] ?? "";
    if (!testName || !value || /검사\s*항목|항목명|결과값|검사명/.test(testName)) return [];
    return [{ testName, value, unit: cells[2] ?? "", judgment: cells.slice(3).join(" ") }];
  }));
}

export function reviewItemsToText(items: OcrReviewItem[]): string {
  return items.map((item) => [item.testName, item.value, item.unit, item.judgment].filter(Boolean).join(" | ")).join("\n");
}

// 조회 요청된 recordType을 도메인 HealthRecordType 배열로 정규화
export function normalizeRecordTypes(recordType?: string | null): HealthRecordType[] | undefined {
  if (!recordType) return undefined;
  const rt = recordType.trim().toLowerCase();
  if (rt === "all" || rt === "trend" || rt === "전체" || rt === "모든" || rt === "total") return undefined;
  if (rt === "health_screening" || rt === "screening" || rt === "검진" || rt === "건강검진" || rt === "검진이력" || rt === "검진기록") {
    return ["health_screening", "lab_result"];
  }
  if (rt === "lab_result" || rt === "검사" || rt === "혈액검사" || rt === "검사결과") {
    return ["lab_result", "health_screening"];
  }
  if (rt === "blood_pressure" || rt === "혈압") return ["blood_pressure"];
  if (rt === "blood_glucose" || rt === "혈당") return ["blood_glucose"];
  if (rt === "exercise" || rt === "운동") return ["exercise", "walking"];
  if (rt === "walking" || rt === "걸음" || rt === "걷기") return ["walking", "exercise"];
  if (rt === "medication" || rt === "복약" || rt === "약") return ["medication"];
  if (rt === "pain" || rt === "통증") return ["pain"];
  return [recordType as HealthRecordType];
}

// 메타/조회성 키워드가 아닌 실제 본문 검색용 유효 키워드만 필터링
export function isValidContentKeyword(keyword?: string | null): string | null {
  if (!keyword) return null;
  const k = keyword.trim().toLowerCase();
  const metaKeywords = new Set([
    "all", "trend", "전체", "모든", "여태", "검진", "건강검진", "이력", "기록", "조회", "내역", "목록", "원본", "보여줘", "서류", "결과", "전체 검진", "검진 이력", "검진 기록"
  ]);
  if (metaKeywords.has(k)) return null;
  if (/^(?:전체|모든)?\s*(?:검진|기록|이력|내역|목록)\s*(?:조회|보기)?$/.test(k)) return null;
  return keyword.trim();
}

// 기간(time_range) 기반 건강기록 필터링 헬퍼 함수
export function filterRecordsByTimeRange(records: HealthRecord[], timeRange?: string | null): HealthRecord[] {
  if (!timeRange) return records;
  const tr = timeRange.trim().toLowerCase();
  if (tr === "all" || tr === "모든" || tr === "전체" || tr === "여태" || tr === "all_time" || tr === "entire") {
    return records;
  }

  const now = new Date();
  const currentYear = now.getFullYear();
  const todayStr = `${currentYear}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  const getLocalDateStr = (isoStr: string) => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(isoStr)) return isoStr;
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return isoStr.slice(0, 10);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  // 최근 (가장 최근 등록된 일자의 기록)
  if (tr === "recent" || tr === "최근" || tr === "latest" || tr === "마지막") {
    if (records.length === 0) return [];
    const sorted = [...records].sort(
      (a, b) => new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime(),
    );
    const latestDate = getLocalDateStr(sorted[0].recordedAt);
    return sorted.filter((r) => getLocalDateStr(r.recordedAt) === latestDate);
  }

  // 오늘
  if (tr === "today" || tr === "오늘") {
    return records.filter((r) => getLocalDateStr(r.recordedAt) === todayStr);
  }

  // 이번 주
  if (tr === "this_week" || tr === "이번 주") {
    const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay()); // Sunday
    const endOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay() + 6); // Saturday
    const startStr = `${startOfWeek.getFullYear()}-${String(startOfWeek.getMonth() + 1).padStart(2, "0")}-${String(startOfWeek.getDate()).padStart(2, "0")}`;
    const endStr = `${endOfWeek.getFullYear()}-${String(endOfWeek.getMonth() + 1).padStart(2, "0")}-${String(endOfWeek.getDate()).padStart(2, "0")}`;
    return records.filter((r) => {
      const dStr = getLocalDateStr(r.recordedAt);
      return dStr >= startStr && dStr <= endStr;
    });
  }

  // 이번 달
  if (tr === "this_month" || tr === "이번 달") {
    const monthStr = `${currentYear}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    return records.filter((r) => getLocalDateStr(r.recordedAt).startsWith(monthStr));
  }

  // 어제
  if (tr === "yesterday" || tr === "어제") {
    const yDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    const yesterdayStr = `${yDate.getFullYear()}-${String(yDate.getMonth() + 1).padStart(2, "0")}-${String(yDate.getDate()).padStart(2, "0")}`;
    return records.filter((r) => getLocalDateStr(r.recordedAt) === yesterdayStr);
  }

  // 올해
  if (tr === "this_year" || tr === "올해" || tr === "금년" || tr === String(currentYear)) {
    return records.filter((r) => getLocalDateStr(r.recordedAt).startsWith(String(currentYear)));
  }

  // 작년
  if (tr === "last_year" || tr === "작년" || tr === "지난해" || tr === String(currentYear - 1)) {
    return records.filter((r) => getLocalDateStr(r.recordedAt).startsWith(String(currentYear - 1)));
  }

  // 재작년
  if (tr === "year_before_last" || tr === "재작년" || tr === String(currentYear - 2)) {
    return records.filter((r) => getLocalDateStr(r.recordedAt).startsWith(String(currentYear - 2)));
  }

  // 특정 4자리 연도 (예: "2022", "2024", "2022년")
  const yearMatch = tr.match(/\b(19\d{2}|20\d{2})\b/);
  if (yearMatch && !tr.includes("-") && !tr.includes("/") && !tr.includes("월")) {
    return records.filter((r) => getLocalDateStr(r.recordedAt).startsWith(yearMatch[1]));
  }

  // 특정 YYYY-MM-DD 전체 일자
  const fullDateParsed = parseExamDateFromText(tr);
  if (fullDateParsed) {
    return records.filter((r) => getLocalDateStr(r.recordedAt) === fullDateParsed);
  }

  // 특정 월/일 (예: "8/28", "5/30", "08-28")
  const parts = tr.split(/[/.-]/);
  if (parts.length === 2) {
    const m = parts[0].padStart(2, "0");
    const d = parts[1].padStart(2, "0");
    return records.filter((r) => getLocalDateStr(r.recordedAt).includes(`-${m}-${d}`));
  }

  return records;
}

// 기록 일시를 시, 분까지 친절하고 깔끔하게 포맷팅 (예: "8월 30일 21시 00분")
export function formatTargetDateTime(isoString: string): string {
  if (!isoString) return "-";
  try {
    // 날짜만 있는 YYYY-MM-DD 형식인 경우
    if (/^\d{4}-\d{2}-\d{2}$/.test(isoString)) {
      const [, m, d] = isoString.split("-");
      return `${parseInt(m, 10)}월 ${parseInt(d, 10)}일`;
    }

    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;

    const month = d.getMonth() + 1;
    const date = d.getDate();
    const hours = d.getHours();
    const minutes = d.getMinutes();
    const minStr = String(minutes).padStart(2, "0");

    return `${month}월 ${date}일 ${hours}시 ${minStr}분`;
  } catch {
    return isoString;
  }
}

// 사용자 질의 텍스트에서 포커싱할 지표 키 감지 (예: "혈당" -> "glucose", "혈압" -> "bp")
export function detectMetricKeyFromQuery(queryText: string): string {
  if (!queryText) return "bp";
  const t = queryText.toLowerCase();
  if (t.includes("혈당") || t.includes("당뇨") || t.includes("glucose")) return "glucose";
  if (t.includes("간") || t.includes("ast") || t.includes("alt") || t.includes("liver")) return "liver";
  if (t.includes("콜레스테롤") || t.includes("지질") || t.includes("chol")) return "chol";
  if (t.includes("신장") || t.includes("크레아티닌") || t.includes("gfr") || t.includes("creatinine")) return "creatinine";
  if (t.includes("빈혈") || t.includes("혈색소") || t.includes("헤모글로빈") || t.includes("hb")) return "hb";
  if (t.includes("체중") || t.includes("몸무게") || t.includes("비만") || t.includes("bmi") || t.includes("weight")) return "weight";
  return "bp";
}

// -------------------------------------------------------------
// 건강기록(검진/측정)에서 시계열 수치 추출 헬퍼 함수
// -------------------------------------------------------------
export function extractMetricsFromRecords(records: HealthRecord[]): MetricSeries[] {
  // 날짜 오름차순 정렬
  const sorted = [...records].sort(
    (a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime(),
  );

  const bpPoints: MetricDataPoint[] = [];
  const glucosePoints: MetricDataPoint[] = [];
  const astAltPoints: MetricDataPoint[] = [];
  const cholPoints: MetricDataPoint[] = [];
  const creatininePoints: MetricDataPoint[] = [];
  const hbPoints: MetricDataPoint[] = [];
  const weightPoints: MetricDataPoint[] = [];

  for (const rec of sorted) {
    const p = rec.payload as Record<string, unknown>;
    const date = rec.recordedAt.slice(0, 10);
    const fullText = `${p.note ?? ""} ${p.summary ?? ""} ${p.itemsSummary ?? ""} ${p.screeningName ?? ""} ${JSON.stringify(p)}`;

    // 1. 혈압
    if (rec.recordType === "blood_pressure" || p.systolicMmHg || p.systolic) {
      const sys = Number(p.systolicMmHg ?? p.systolic);
      const dia = Number(p.diastolicMmHg ?? p.diastolic);
      if (sys > 0) {
        bpPoints.push({ date, value: sys, secondaryValue: dia > 0 ? dia : undefined });
      }
    } else {
      const bpMatch = fullText.match(/(?:혈압|고혈압)[^0-9]*(\d{2,3})\s*[/|~]\s*(\d{2,3})/);
      if (bpMatch) {
        bpPoints.push({ date, value: Number(bpMatch[1]), secondaryValue: Number(bpMatch[2]) });
      }
    }

    // 2. 혈당
    if (rec.recordType === "blood_glucose" || p.valueMgDl || p.glucose) {
      const g = Number(p.valueMgDl ?? p.glucose ?? p.value);
      if (g > 0) glucosePoints.push({ date, value: g });
    } else {
      const gMatch = fullText.match(/(?:공복혈당|당검사|식전|혈당)[^0-9]*(\d{2,3})/i);
      if (gMatch && Number(gMatch[1]) >= 40 && Number(gMatch[1]) <= 400) {
        glucosePoints.push({ date, value: Number(gMatch[1]) });
      }
    }

    // 3. 간기능 (AST / ALT)
    const astMatch = fullText.match(/AST(?:[^\d]*)(\d{1,3})/i);
    const altMatch = fullText.match(/ALT(?:[^\d]*)(\d{1,3})/i);
    if (astMatch || altMatch) {
      const ast = astMatch ? Number(astMatch[1]) : 0;
      const alt = altMatch ? Number(altMatch[1]) : 0;
      if (ast > 0 || alt > 0) {
        astAltPoints.push({ date, value: ast, secondaryValue: alt > 0 ? alt : undefined });
      }
    }

    // 4. 총콜레스테롤
    const cholMatch = fullText.match(/(?:총콜레스테롤|콜레스테롤)(?:[^\d]*)(\d{2,3})/i);
    if (cholMatch && Number(cholMatch[1]) >= 80 && Number(cholMatch[1]) <= 500) {
      cholPoints.push({ date, value: Number(cholMatch[1]) });
    }

    // 5. 신장기능 (e-GFR / 크레아티닌)
    const egfrMatch = fullText.match(/(?:e-GFR|신사구체여과율)(?:[^\d]*)(\d{2,3})/i);
    const crMatch = fullText.match(/(?:혈청크레아티닌|크레아티닌)(?:[^\d]*)(\d(?:\.\d+)?)/i);
    if (egfrMatch || crMatch) {
      const val = egfrMatch ? Number(egfrMatch[1]) : (crMatch ? Number(crMatch[1]) : 0);
      if (val > 0) {
        creatininePoints.push({ date, value: val });
      }
    }

    // 6. 혈색소 (Hb)
    const hbMatch = fullText.match(/(?:혈색소|헤모글로빈)(?:[^\d]*)(\d{1,2}(?:\.\d+)?)/i);
    if (hbMatch && Number(hbMatch[1]) >= 5 && Number(hbMatch[1]) <= 25) {
      hbPoints.push({ date, value: Number(hbMatch[1]) });
    }

    // 7. 체중
    if (rec.recordType === "body_measurement" && p.weightKg) {
      weightPoints.push({ date, value: Number(p.weightKg) });
    }
  }

  const series: MetricSeries[] = [];

  if (bpPoints.length > 0) {
    series.push({
      key: "bp",
      name: "혈압 (수축기/이완기)",
      unit: "mmHg",
      color: "#10b981",
      secondaryColor: "#3b82f6",
      secondaryName: "이완기",
      normalRange: { max: 120, label: "정상 수축기: 120 이하" },
      points: bpPoints,
    });
  }

  if (glucosePoints.length > 0) {
    series.push({
      key: "glucose",
      name: "공복 혈당",
      unit: "mg/dL",
      color: "#8b5cf6",
      normalRange: { max: 100, label: "정상 공복: 100 미만" },
      points: glucosePoints,
    });
  }

  if (astAltPoints.length > 0) {
    series.push({
      key: "liver",
      name: "간수치 (AST / ALT)",
      unit: "U/L",
      color: "#f59e0b",
      secondaryColor: "#ef4444",
      secondaryName: "ALT",
      normalRange: { max: 40, label: "정상: 40 이하" },
      points: astAltPoints,
    });
  }

  if (cholPoints.length > 0) {
    series.push({
      key: "chol",
      name: "총콜레스테롤",
      unit: "mg/dL",
      color: "#ec4899",
      normalRange: { max: 200, label: "정상: 200 미만" },
      points: cholPoints,
    });
  }

  if (creatininePoints.length > 0) {
    series.push({
      key: "kidney",
      name: "신장기능 (e-GFR)",
      unit: "mL/min",
      color: "#06b6d4",
      normalRange: { min: 60, label: "정상: 60 이상" },
      points: creatininePoints,
    });
  }

  if (hbPoints.length > 0) {
    series.push({
      key: "hb",
      name: "혈색소 (헤모글로빈)",
      unit: "g/dL",
      color: "#e11d48",
      normalRange: { min: 13, max: 17, label: "정상(남): 13~17" },
      points: hbPoints,
    });
  }

  if (weightPoints.length > 0) {
    series.push({
      key: "weight",
      name: "체중",
      unit: "kg",
      color: "#14b8a6",
      points: weightPoints,
    });
  }

  return series;
}

/**
 * 대화 세션 로컬 보존 — 43번 설계 §6
 *
 * 서버는 무상태이므로 대화는 브라우저(sessionStorage)에 프로필 단위로 격리 보존한다.
 * 서랍을 닫거나 다른 메뉴로 이동해도 해당 구성원의 대화가 유지된다.
 */
export function chatSessionStorageKey(profileId: string): string {
  return `ieobom_chat_session_${profileId}`;
}

export function serializeChatSession(messages: ExtendedChatMessage[]): string {
  const serializable = messages.map((msg) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { imageFile, imageBlobUrl, ...rest } = msg;
    return rest;
  });
  return JSON.stringify(serializable);
}

export function deserializeChatSession(raw: string): ExtendedChatMessage[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is ExtendedChatMessage =>
        item &&
        typeof item === "object" &&
        typeof item.id === "string" &&
        (item.role === "user" || item.role === "assistant") &&
        typeof item.content === "string",
    );
  } catch {
    return [];
  }
}

export function loadChatSession(
  profileId: string,
  storage?: Storage,
): ExtendedChatMessage[] | null {
  if (!profileId) return null;
  const targetStorage = storage ?? (typeof window !== "undefined" ? window.sessionStorage : undefined);
  if (!targetStorage) return null;

  try {
    const raw = targetStorage.getItem(chatSessionStorageKey(profileId));
    if (!raw) return null;
    const messages = deserializeChatSession(raw);
    return messages.length > 0 ? messages : null;
  } catch {
    return null;
  }
}

export function saveChatSession(
  profileId: string,
  messages: ExtendedChatMessage[],
  storage?: Storage,
): void {
  if (!profileId || messages.length === 0) return;
  // 환영 메시지만 있는 초기 상태는 별도로 저장하지 않고 비운다.
  if (messages.length === 1 && messages[0].id === "welcome") {
    clearChatSession(profileId, storage);
    return;
  }
  const targetStorage = storage ?? (typeof window !== "undefined" ? window.sessionStorage : undefined);
  if (!targetStorage) return;

  try {
    const serialized = serializeChatSession(messages);
    targetStorage.setItem(chatSessionStorageKey(profileId), serialized);
  } catch (err) {
    console.warn("Failed to persist chat session:", err);
  }
}

export function clearChatSession(
  profileId: string,
  storage?: Storage,
): void {
  if (!profileId) return;
  const targetStorage = storage ?? (typeof window !== "undefined" ? window.sessionStorage : undefined);
  if (!targetStorage) return;

  try {
    targetStorage.removeItem(chatSessionStorageKey(profileId));
  } catch (err) {
    console.warn("Failed to clear chat session:", err);
  }
}

export function createWelcomeMessage(profileName: string): ExtendedChatMessage {
  return {
    id: "welcome",
    role: "assistant",
    content: `안녕하세요! ${profileName}님의 건강 비서 '봄이'입니다.

평소 운동, 혈압, 복약 정보를 편하게 말씀해 주시거나, 하단 + 버튼으로 검진표/서류 사진을 올리시면 기록과 조회를 도와드릴게요!`,
  };
}

export function dbMessageToExtendedChatMessage(dbMsg: ChatMessageData): ExtendedChatMessage {
  return {
    id: dbMsg.id,
    role: dbMsg.role,
    content: dbMsg.content,
    responseDraft: dbMsg.metadata ? (dbMsg.metadata as unknown as HealthAssistantResponse) : undefined,
  };
}

/**
 * 서버가 저장한 대화 본문·AI 응답에, 이 기기에서만 만들 수 있는 조회 카드 상태를
 * 다시 붙인다. 건강기록 원문은 로컬 보관함에 있으므로 서버 이력만으로는 표·그래프를
 * 다시 그릴 수 없다. 같은 역할·본문의 캐시 메시지에만 보조 UI 상태를 승계한다.
 */
export function mergeServerMessagesWithLocalUi(
  dbMessages: ChatMessageData[],
  cachedMessages: ExtendedChatMessage[] | null,
): ExtendedChatMessage[] {
  if (!cachedMessages || cachedMessages.length === 0) {
    return dbMessages.map(dbMessageToExtendedChatMessage);
  }

  // 1. ID로 빠른 조회가 가능하도록 맵 구성
  const cachedById = new Map<string, ExtendedChatMessage>();
  for (const m of cachedMessages) {
    if (m.id) {
      cachedById.set(m.id, m);
    }
  }

  // 2. 동일한 질문/답변이 반복되어도 순서대로 매칭될 수 있도록 role + content FIFO 큐 구성
  const signatureQueues = new Map<string, ExtendedChatMessage[]>();
  for (const m of cachedMessages) {
    const sig = `${m.role}\u0000${m.content.trim()}`;
    const queue = signatureQueues.get(sig) ?? [];
    queue.push(m);
    signatureQueues.set(sig, queue);
  }

  const usedCached = new Set<ExtendedChatMessage>();

  return dbMessages.map((dbMessage) => {
    const serverMessage = dbMessageToExtendedChatMessage(dbMessage);

    // 1) 정확한 ID 매칭
    let cached = cachedById.get(dbMessage.id);

    // 2) ID가 다르면 (로컬 임시 id vs 서버 생성 id) signature 큐에서 선입선출 매칭
    if (!cached || usedCached.has(cached)) {
      const sig = `${serverMessage.role}\u0000${serverMessage.content.trim()}`;
      const queue = signatureQueues.get(sig);
      if (queue && queue.length > 0) {
        while (queue.length > 0) {
          const candidate = queue.shift()!;
          if (!usedCached.has(candidate)) {
            cached = candidate;
            break;
          }
        }
      }
    }

    if (!cached) return serverMessage;
    usedCached.add(cached);

    return {
      ...serverMessage,
      saved: cached.saved,
      attachedDocuments: cached.attachedDocuments,
      queriedRecords: cached.queriedRecords,
      queriedRecordsTitle: cached.queriedRecordsTitle,
      showTrendChart: cached.showTrendChart,
      trendMetrics: cached.trendMetrics,
      trendInitialKey: cached.trendInitialKey,
      imageBlobUrl: cached.imageBlobUrl,
      imageFile: cached.imageFile,
    };
  });
}

