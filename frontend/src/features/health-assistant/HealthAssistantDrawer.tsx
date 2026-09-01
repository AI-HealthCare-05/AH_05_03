import { useState, useRef, useEffect, type FormEvent, type ChangeEvent } from "react";
import type { FamilyProfile, HealthRecord, HealthRecordType } from "../../shared/local/domainContracts";
import type { LocalDomainRuntime } from "../../shared/local/localDomainRuntime";
import { DevServerOcrAdapter } from "../../ocr/ocr-adapter";
import {
  sendHealthAssistantMessage,
  type ChatMessage,
  type HealthAssistantResponse,
  type ExerciseDraft,
  type BloodPressureDraft,
  type MedicationDraft,
  type PainDraft,
  type LabResultDraft,
} from "./healthAssistantClient";
import { selectContextRecordTypes } from "./healthAssistantContext";
import "./healthAssistantDrawer.css";

interface HealthAssistantDrawerProps {
  profile?: FamilyProfile;
  runtime?: LocalDomainRuntime;
  isOpen: boolean;
  onClose: () => void;
  onRecordSaved?: () => Promise<void> | void;
  onNavigateToRecords?: () => void;
}

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

interface ExtendedChatMessage extends ChatMessage {
  id: string;
  responseDraft?: HealthAssistantResponse;
  saved?: boolean;
  imageBlobUrl?: string;
  imageFile?: File;
  attachedDocuments?: Array<{ id: string; fileName?: string }>;
  showTrendChart?: boolean;
  trendMetrics?: MetricSeries[];
  trendInitialKey?: string;
}

const PRIMARY_HOUSEHOLD_ID = "household-local-primary";

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
  const todayStr = now.toISOString().slice(0, 10);

  // 최근 (가장 최근 등록된 일자의 기록)
  if (tr === "recent" || tr === "최근" || tr === "latest" || tr === "마지막") {
    if (records.length === 0) return [];
    const sorted = [...records].sort(
      (a, b) => new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime(),
    );
    const latestDate = sorted[0].recordedAt.slice(0, 10);
    return sorted.filter((r) => r.recordedAt.startsWith(latestDate));
  }

  // 오늘
  if (tr === "today" || tr === "오늘") {
    return records.filter((r) => r.recordedAt.startsWith(todayStr));
  }

  // 어제
  if (tr === "yesterday" || tr === "어제") {
    const yDate = new Date(now);
    yDate.setDate(yDate.getDate() - 1);
    const yesterdayStr = yDate.toISOString().slice(0, 10);
    return records.filter((r) => r.recordedAt.startsWith(yesterdayStr));
  }

  // 올해
  if (tr === "this_year" || tr === "올해" || tr === "금년" || tr === String(currentYear)) {
    return records.filter((r) => r.recordedAt.startsWith(String(currentYear)));
  }

  // 작년
  if (tr === "last_year" || tr === "작년" || tr === "지난해" || tr === String(currentYear - 1)) {
    return records.filter((r) => r.recordedAt.startsWith(String(currentYear - 1)));
  }

  // 재작년
  if (tr === "year_before_last" || tr === "재작년" || tr === String(currentYear - 2)) {
    return records.filter((r) => r.recordedAt.startsWith(String(currentYear - 2)));
  }

  // 특정 4자리 연도 (예: "2022", "2024", "2022년")
  const yearMatch = tr.match(/\b(19\d{2}|20\d{2})\b/);
  if (yearMatch && !tr.includes("-") && !tr.includes("/") && !tr.includes("월")) {
    return records.filter((r) => r.recordedAt.startsWith(yearMatch[1]));
  }

  // 특정 YYYY-MM-DD 전체 일자
  const fullDateParsed = parseExamDateFromText(tr);
  if (fullDateParsed) {
    return records.filter((r) => r.recordedAt.startsWith(fullDateParsed));
  }

  // 특정 월/일 (예: "8/28", "5/30", "08-28")
  const parts = tr.split(/[\/\-.]/);
  if (parts.length === 2) {
    const m = parts[0].padStart(2, "0");
    const d = parts[1].padStart(2, "0");
    return records.filter((r) => r.recordedAt.includes(`-${m}-${d}`));
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
      const bpMatch = fullText.match(/(?:혈압|고혈압)[^0-9]*(\d{2,3})\s*[\/|\~]\s*(\d{2,3})/);
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

export function HealthAssistantDrawer({
  profile,
  runtime,
  isOpen,
  onClose,
  onRecordSaved,
  onNavigateToRecords,
}: HealthAssistantDrawerProps) {
  const [messages, setMessages] = useState<ExtendedChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [queriedRecords, setQueriedRecords] = useState<HealthRecord[] | null>(null);
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [sourcePreviewModal, setSourcePreviewModal] = useState<{ url: string; name: string } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 원본 서류 크게 보기 모달 상태
  const [previewDocumentId, setPreviewDocumentId] = useState<string | null>(null);

  // 서류 OCR 상세 검토 및 저장 모달 상태
  const [ocrModalOpen, setOcrModalOpen] = useState(false);
  const [ocrModalWorking, setOcrModalWorking] = useState(false);
  const [ocrReviewDraft, setOcrReviewDraft] = useState<LabResultDraft | null>(null);
  const [ocrImageFile, setOcrImageFile] = useState<File | null>(null);
  const [ocrImagePreviewUrl, setOcrImagePreviewUrl] = useState<string | null>(null);

  // 질문에 직접 필요한 종류의 최근 기록만 AI 컨텍스트로 구성한다.
  async function fetchRecentRecordsSummary(recordTypes: HealthRecordType[]): Promise<string | undefined> {
    if (!runtime || !profile || recordTypes.length === 0) return undefined;
    try {
      const qRes = await runtime.healthRecords.query({
        profileId: profile.id,
        recordTypes,
        includeDeleted: false,
      });
      if (!qRes.ok || qRes.value.length === 0) return undefined;

      const recent = [...qRes.value]
        .sort((a, b) => new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime())
        .slice(0, 5);

      const summaryList = recent.map((r) => {
        const p = r.payload as Record<string, unknown>;
        const dateStr = r.recordedAt.slice(0, 10);
        if (r.recordType === "medication" || p.medicationName) {
          return `[${dateStr} 복약] ${p.medicationName} ${p.dosage ?? ""} (${p.takenAt ?? ""})`;
        }
        if (r.recordType === "blood_pressure" || p.systolicMmHg) {
          return `[${dateStr} 혈압] ${p.systolicMmHg}/${p.diastolicMmHg} mmHg (맥박 ${p.pulseBpm ?? "-"})`;
        }
        if (r.recordType === "exercise" || p.exerciseName) {
          return `[${dateStr} 운동] ${p.exerciseName} ${p.weightKg ? `${p.weightKg}kg ` : ""}${p.reps ? `${p.reps}회 ` : ""}${p.sets ? `${p.sets}세트` : ""}`;
        }
        if (r.recordType === "pain" || p.bodyArea) {
          return `[${dateStr} 통증] ${p.bodyArea} 강도 ${p.intensity}/10`;
        }
        if (r.recordType === "health_screening" || r.recordType === "lab_result") {
          return `[${dateStr} 검진/검사] ${p.screeningName ?? p.testName ?? ""} ${p.note ?? p.summary ?? ""}`.slice(0, 100);
        }
        return `[${dateStr} ${r.recordType}] ${p.note ?? ""}`;
      });

      return summaryList.join("; ");
    } catch {
      return undefined;
    }
  }

  // 프로필이 바뀔 때 기본 인사말 초기화
  useEffect(() => {
    if (profile) {
      setMessages([
        {
          id: "welcome",
          role: "assistant",
          content: `안녕하세요! ${profile.displayName}님의 건강 비서 '봄이'입니다.\n\n평소 운동, 혈압, 복약 정보를 편하게 말씀해 주시거나, 하단 + 버튼으로 검진표/서류 사진을 올리시면 기록과 조회를 도와드릴게요!`,
        },
      ]);
      setQueriedRecords(null);
      setSelectedImage(null);
      setImagePreview(null);
    }
  }, [profile?.id, profile?.displayName]);

  useEffect(() => {
    if (isOpen) {
      scrollToBottom();
    }
  }, [messages, loading, isOpen]);

  // 이미지 미리보기 메모리 정리
  useEffect(() => {
    return () => {
      if (imagePreview) URL.revokeObjectURL(imagePreview);
      if (sourcePreviewModal) URL.revokeObjectURL(sourcePreviewModal.url);
    };
  }, [imagePreview, sourcePreviewModal]);

  const scrollToBottom = () => {
    if (typeof messagesEndRef.current?.scrollIntoView === "function") {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  };

  if (!isOpen || !profile) return null;

  // 이미지 파일 선택 핸들러 (+ 버튼 클릭 시 OCR 모달 즉시 실행)
  async function handleImageSelect(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setError("이미지 파일(JPG, PNG, WEBP)만 업로드할 수 있습니다.");
      return;
    }

    if (imagePreview) URL.revokeObjectURL(imagePreview);
    const previewUrl = URL.createObjectURL(file);
    setSelectedImage(file);
    setImagePreview(previewUrl);
    setError(undefined);

    // 모달을 열고 OCR 시작
    setOcrImageFile(file);
    setOcrImagePreviewUrl(previewUrl);
    setOcrModalOpen(true);
    setOcrModalWorking(true);

    try {
      const ocrAdapter = new DevServerOcrAdapter();
      const ocrResult = await ocrAdapter.recognize(file);
      const extractedDate = parseExamDateFromText(ocrResult.text) || new Date().toISOString().slice(0, 10);

      const draft: LabResultDraft = {
        screening_name: "건강검진",
        recorded_at: extractedDate,
        summary: ocrResult.text.slice(0, 300),
        items_summary: ocrResult.text,
      };
      setOcrReviewDraft(draft);
    } catch (ocrErr) {
      console.warn("OCR 실행 오류:", ocrErr);
      setError(ocrErr instanceof Error ? ocrErr.message : "서류 분석에 실패했습니다.");
    } finally {
      setOcrModalWorking(false);
    }
  }

  function clearSelectedImage() {
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setSelectedImage(null);
    setImagePreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  // 모달에서 서류 확정 저장 핸들러
  async function handleConfirmOcrModalSave(draft: LabResultDraft) {
    if (!runtime || !profile || !ocrImageFile) return;
    setOcrModalWorking(true);
    try {
      let primaryDocumentId: string | undefined;
      if (runtime.documents) {
        const savedDoc = await runtime.documents.save({
          householdId: PRIMARY_HOUSEHOLD_ID,
          profileId: profile.id,
          file: ocrImageFile,
          fileName: ocrImageFile.name,
        });
        if (!savedDoc.ok) throw new Error(savedDoc.error.message);
        primaryDocumentId = savedDoc.value.id;
      }

      const finalNote = [
        draft.summary ? `[검진 요약]\n${draft.summary}` : "",
        draft.items_summary ? `[검사 항목 및 결과]\n${draft.items_summary}` : "",
      ]
        .filter(Boolean)
        .join("\n\n");

      const recResult = await runtime.healthRecords.create({
        householdId: PRIMARY_HOUSEHOLD_ID,
        profileId: profile.id,
        recordType: "health_screening",
        recordedAt: draft.recorded_at ? new Date(draft.recorded_at).toISOString() : new Date().toISOString(),
        source: "ocr",
        sourceDocumentId: primaryDocumentId,
        payload: {
          type: "health_screening",
          screeningName: draft.screening_name || "건강검진",
          institution: draft.institution ?? undefined,
          summary: draft.summary ?? "",
          itemsSummary: draft.items_summary ?? "",
          note: finalNote || draft.summary || "건강검진 결과",
        },
      });

      if (!recResult.ok) throw new Error(recResult.error.message);

      // 대화창에 사용자 메시지와 어시스턴트 완료 메시지 추가
      const userMsg: ExtendedChatMessage = {
        id: `user-${Date.now()}`,
        role: "user",
        content: `검사 서류(${ocrImageFile.name})를 업로드하여 기록했습니다.`,
        imageBlobUrl: ocrImagePreviewUrl ?? undefined,
        imageFile: ocrImageFile,
      };

      const assistantMsg: ExtendedChatMessage = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: `${draft.recorded_at}에 실시된 ${draft.screening_name || "건강검진"} 결과가 나의 건강기록에 안전하게 저장되었습니다. 원본 서류는 언제든 확인하실 수 있습니다.`,
        attachedDocuments: primaryDocumentId ? [{
          id: primaryDocumentId,
          fileName: ocrImageFile.name,
        }] : undefined,
      };

      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setOcrModalOpen(false);
      clearSelectedImage();

      if (onRecordSaved) await onRecordSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "건강기록 저장에 실패했습니다.");
    } finally {
      setOcrModalWorking(false);
    }
  }

  async function handleSend(contentToSend?: string) {
    const textToSend = (contentToSend ?? input).trim();
    const currentImage = selectedImage;
    const currentImagePreview = imagePreview;

    if ((!textToSend && !currentImage) || loading || !profile) return;

    clearSelectedImage();

    let userContent = textToSend;
    let ocrAttachedText = "";
    let extractedExamDate: string | undefined;

    // 이미지가 첨부된 경우 OCR 실행 및 날짜 추출
    if (currentImage) {
      setLoading(true);
      setError(undefined);
      try {
        const ocrAdapter = new DevServerOcrAdapter();
        const ocrResult = await ocrAdapter.recognize(currentImage);
        ocrAttachedText = ocrResult.text;
        extractedExamDate = parseExamDateFromText(ocrResult.text);

        if (!userContent) {
          userContent = "건강검진표/검사결과지 서류 이미지를 업로드했습니다. 내용을 확인하고 기록해 주세요.";
        }
      } catch (ocrErr) {
        console.warn("OCR 실행 오류:", ocrErr);
        if (!userContent) {
          userContent = "서류 이미지를 업로드했습니다.";
        }
      }
    }

    const userMsg: ExtendedChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: userContent,
      imageBlobUrl: currentImagePreview ?? undefined,
      imageFile: currentImage ?? undefined,
    };

    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);
    setError(undefined);
    setQueriedRecords(null);

    try {
      // 일반 대화/기록 입력에는 과거 건강정보를 보내지 않는다.
      // 개인 기록이 실제로 필요한 건강 질문에 한해 관련 종류만 선별한다.
      const contextRecordTypes = selectContextRecordTypes(textToSend);
      const recentSummary = await fetchRecentRecordsSummary(contextRecordTypes);

      // AI 전송용 메시지 배열 구성 (OCR 텍스트가 있으면 함께 포함)
      const promptMessages = nextMessages.map((m, idx) => {
        if (idx === nextMessages.length - 1 && ocrAttachedText) {
          return {
            role: m.role,
            content: `${m.content}\n\n[업로드된 검사 서류 OCR 추출 내용]\n${ocrAttachedText}`,
          };
        }
        return { role: m.role, content: m.content };
      });

      // 대화 API 호출
      const res = await sendHealthAssistantMessage(
        promptMessages,
        {
          profile_name: profile.displayName,
          relationship: profile.relationship,
          birth_year: profile.birthDate ? parseInt(profile.birthDate.slice(0, 4), 10) : undefined,
          recent_records_summary: recentSummary,
        },
      );

      // OCR에서 추출된 날짜가 있고 AI가 날짜를 채우지 않았거나 오늘로 채운 경우 보정
      if (res.lab_result_draft && extractedExamDate && (!res.lab_result_draft.recorded_at || res.lab_result_draft.recorded_at === new Date().toISOString().slice(0, 10))) {
        res.lab_result_draft.recorded_at = extractedExamDate;
      }

      const assistantMsgId = `assistant-${Date.now()}`;
      const assistantMsg: ExtendedChatMessage = {
        id: assistantMsgId,
        role: "assistant",
        content: res.assistant_message,
        responseDraft: res,
        imageFile: currentImage ?? undefined,
      };

      setMessages((prev) => [...prev, assistantMsg]);

      // 조회 질의이거나 질문인 경우 IndexedDB에서 데이터 조회 수행
      if ((res.intent === "query_records" || /(?:원본|서류|사진|스캔|문서|이미지|보여줘|그래프|변화|추이|트렌드|수치)/.test(textToSend)) && runtime) {
        await executeLocalQuery(
          res.query_draft?.record_type,
          res.query_draft?.time_range,
          res.query_draft?.keyword,
          textToSend,
          assistantMsgId,
        );
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "응답을 받지 못했습니다. 다시 시도해 주세요.");
    } finally {
      setLoading(false);
    }
  }

  async function executeLocalQuery(
    recordType?: string | null,
    timeRange?: string | null,
    keyword?: string | null,
    rawQueryText?: string,
    assistantMsgId?: string,
  ) {
    if (!runtime || !profile) return;
    try {
      const isTrendQuery =
        recordType === "trend" ||
        keyword === "trend" ||
        (keyword && (keyword.includes("그래프") || keyword.includes("변화") || keyword.includes("추이") || keyword.includes("수치"))) ||
        Boolean(rawQueryText && (rawQueryText.includes("그래프") || rawQueryText.includes("변화") || rawQueryText.includes("추이") || rawQueryText.includes("트렌드") || rawQueryText.includes("수치")));

      // 사용자가 "원본", "서류", "사진", "스캔", "문서", "이미지" 등을 명시적으로 요구했을 때만 원본 이미지 노출
      const isExplicitOriginalDocRequest =
        Boolean(rawQueryText && /(?:원본|서류|사진|스캔|문서|이미지)/.test(rawQueryText)) ||
        keyword === "원본";

      // 사용자가 "모든 서류", "여태 올린 서류 전부", "전체 문서"처럼 전체 목록을 명시적으로 요구했는지 여부
      const isExplicitAllDocsRequest =
        isExplicitOriginalDocRequest &&
        Boolean(rawQueryText && /(?:전체|모든|여태|전부|모두|다\s*보여)/.test(rawQueryText));

      const targetTypes = normalizeRecordTypes(recordType);

      const qRes = await runtime.healthRecords.query({
        profileId: profile.id,
        recordTypes: targetTypes,
        includeDeleted: false,
      });

      if (qRes.ok) {
        let list = filterRecordsByTimeRange(qRes.value, timeRange);
        const isAllQuery = !timeRange || timeRange === "all" || timeRange === "모든" || timeRange === "전체" || timeRange === "여태" || timeRange === "all_time";
        const validKeyword = isValidContentKeyword(keyword);

        if (validKeyword) {
          list = list.filter((r) => JSON.stringify(r.payload).includes(validKeyword));
        }

        // 1) 트렌드 질의이거나, 2) 명시적 원본 서류 요청인 경우에는 하단 OCR 텍스트 테이블을 숨김
        if (isTrendQuery || isExplicitOriginalDocRequest) {
          setQueriedRecords(null);
        } else {
          setQueriedRecords(list);
        }

        // 시계열 그래프용 지표 추출 (전체 기록 또는 조회 기록 대상)
        const metrics = extractMetricsFromRecords(qRes.value);
        const trendInitialKey = rawQueryText ? detectMetricKeyFromQuery(rawQueryText) : "bp";

        // 사용자가 명시적으로 원본 서류를 요청한 경우에만 attachedDocs 수집
        const attachedDocs: Array<{ id: string; fileName?: string }> = [];
        if (isExplicitOriginalDocRequest) {
          const docIds = new Set<string>();

          // timeRange가 적용된 list를 기준으로 서류 ID가 있는 기록들을 검진일자(recordedAt) 최신순으로 정렬
          const allScreeningsWithDoc = [...list]
            .filter((r) => r.sourceDocumentId)
            .sort((a, b) => new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime());

          if (isExplicitAllDocsRequest) {
            // "모든/전체 서류"를 요청한 경우: 전체 검진 서류를 수집
            for (const r of allScreeningsWithDoc) {
              if (r.sourceDocumentId && !docIds.has(r.sourceDocumentId)) {
                docIds.add(r.sourceDocumentId);
                const p = r.payload as Record<string, unknown>;
                attachedDocs.push({
                  id: r.sourceDocumentId,
                  fileName: (p.screeningName as string) || (p.testName as string) || undefined,
                });
              }
            }
            // 서류함 전체도 필요하다면 조회
            if (attachedDocs.length === 0 && runtime.documents) {
              const docListRes = await runtime.documents.list(profile.id);
              if (docListRes.ok) {
                for (const doc of docListRes.value) {
                  if (!docIds.has(doc.id)) {
                    docIds.add(doc.id);
                    attachedDocs.push({ id: doc.id, fileName: doc.fileName });
                  }
                }
              }
            }
          } else {
            // "최근 건강검진 결과 원본 보여줘" 등 단수/최신 서류 요청인 경우:
            // 가장 최신 검진 레코드 1건(또는 동일한 최근 검진 일자의 서류들)만 타겟팅!
            if (allScreeningsWithDoc.length > 0) {
              const latestScreening = allScreeningsWithDoc[0];
              const targetRecordedAtDay = latestScreening.recordedAt.slice(0, 10);
              // 같은 검진 이벤트(동일 날짜)에 속한 서류 페이지만 수집 (단일 장 또는 여러 페이지)
              for (const r of allScreeningsWithDoc) {
                if (
                  r.sourceDocumentId &&
                  r.recordedAt.startsWith(targetRecordedAtDay) &&
                  !docIds.has(r.sourceDocumentId)
                ) {
                  docIds.add(r.sourceDocumentId);
                  const p = r.payload as Record<string, unknown>;
                  attachedDocs.push({
                    id: r.sourceDocumentId,
                    fileName: (p.screeningName as string) || (p.testName as string) || undefined,
                  });
                }
              }
            } else if (runtime.documents) {
              // 레코드 연결이 없더라도 서류함의 가장 최신 서류 1건만 반환
              const docListRes = await runtime.documents.list(profile.id);
              if (docListRes.ok && docListRes.value.length > 0) {
                const latestDoc = docListRes.value[0];
                attachedDocs.push({ id: latestDoc.id, fileName: latestDoc.fileName });
              }
            }
          }
        }

        if (assistantMsgId) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId
                ? {
                    ...m,
                    attachedDocuments: attachedDocs.length > 0 ? attachedDocs : undefined,
                    showTrendChart: Boolean(isTrendQuery && metrics.length > 0),
                    trendMetrics: metrics.length > 0 ? metrics : undefined,
                    trendInitialKey: isTrendQuery ? trendInitialKey : undefined,
                  }
                : m,
            ),
          );
        }
      }
    } catch (e) {
      console.error("Failed to query local records:", e);
    }
  }

  // 원본 서류 이미지 열람 핸들러
  async function openSourceDocument(documentId: string) {
    if (!runtime || !runtime.documents) return;
    try {
      const docRes = await runtime.documents.readById(documentId);
      if (!docRes.ok) throw new Error(docRes.error.message);
      const url = URL.createObjectURL(docRes.value.file);
      setSourcePreviewModal({ url, name: docRes.value.fileName });
    } catch (err) {
      setError(err instanceof Error ? err.message : "원본 서류를 열람하지 못했습니다.");
    }
  }

  // 운동 초안 로컬 저장
  async function saveExercise(draft: ExerciseDraft, msgId: string) {
    if (!runtime || !profile) return;
    setLoading(true);
    try {
      const details: string[] = [];
      if (draft.distance_km) details.push(`${draft.distance_km}km`);
      if (draft.duration_minutes) details.push(`${draft.duration_minutes}분`);
      if (draft.weight_kg) details.push(`${draft.weight_kg}kg`);
      if (draft.reps) details.push(`${draft.reps}회`);
      if (draft.sets) details.push(`${draft.sets}세트`);
      const summaryText = `${draft.exercise_name}${details.length > 0 ? ` (${details.join(" · ")})` : ""}`.trim();

      const result = await runtime.healthRecords.create({
        householdId: PRIMARY_HOUSEHOLD_ID,
        profileId: profile.id,
        recordType: "exercise",
        recordedAt: draft.date_str ? new Date(draft.date_str).toISOString() : new Date().toISOString(),
        source: "local_ai",
        payload: {
          type: "exercise",
          exerciseName: draft.exercise_name,
          distanceKm: draft.distance_km ?? undefined,
          weightKg: draft.weight_kg ?? undefined,
          reps: draft.reps ?? undefined,
          sets: draft.sets ?? undefined,
          durationMinutes: draft.duration_minutes ?? undefined,
          note: draft.note || summaryText,
        },
      });

      if (!result.ok) throw new Error(result.error.message);

      setMessages((prev) =>
        prev.map((m) => (m.id === msgId ? { ...m, saved: true } : m)),
      );
      if (onRecordSaved) await onRecordSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "운동 기록 저장에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }

  // 혈압 초안 로컬 저장
  async function saveBloodPressure(draft: BloodPressureDraft, msgId: string) {
    if (!runtime || !profile || !draft.systolic || !draft.diastolic) return;
    setLoading(true);
    try {
      const summaryText = `혈압 ${draft.systolic}/${draft.diastolic} mmHg${draft.pulse ? ` (맥박 ${draft.pulse})` : ""}`;
      const result = await runtime.healthRecords.create({
        householdId: PRIMARY_HOUSEHOLD_ID,
        profileId: profile.id,
        recordType: "blood_pressure",
        recordedAt: draft.measured_at ? new Date(draft.measured_at).toISOString() : new Date().toISOString(),
        source: "local_ai",
        payload: {
          type: "blood_pressure",
          systolicMmHg: draft.systolic,
          diastolicMmHg: draft.diastolic,
          pulseBpm: draft.pulse ?? undefined,
          note: draft.note || summaryText,
        },
      });

      if (!result.ok) throw new Error(result.error.message);

      setMessages((prev) =>
        prev.map((m) => (m.id === msgId ? { ...m, saved: true } : m)),
      );
      if (onRecordSaved) await onRecordSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "혈압 기록 저장에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }

  // 복약 초안 로컬 저장
  async function saveMedication(draft: MedicationDraft, msgId: string) {
    if (!runtime || !profile || !draft.medication_name) return;
    setLoading(true);
    try {
      const summaryText = `복약: ${draft.medication_name}${draft.dosage ? ` ${draft.dosage}` : ""}${draft.taken_at ? ` (${draft.taken_at})` : ""}`;
      const result = await runtime.healthRecords.create({
        householdId: PRIMARY_HOUSEHOLD_ID,
        profileId: profile.id,
        recordType: "medication",
        recordedAt: new Date().toISOString(),
        source: "local_ai",
        payload: {
          type: "medication",
          medicationName: draft.medication_name,
          dosage: draft.dosage ?? undefined,
          takenAt: draft.taken_at ?? undefined,
          note: draft.note || summaryText,
        },
      });

      if (!result.ok) throw new Error(result.error.message);

      setMessages((prev) =>
        prev.map((m) => (m.id === msgId ? { ...m, saved: true } : m)),
      );
      if (onRecordSaved) await onRecordSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "복약 기록 저장에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }

  // 통증 초안 로컬 저장
  async function savePain(draft: PainDraft, msgId: string) {
    if (!runtime || !profile || !draft.body_area) return;
    setLoading(true);
    try {
      const summaryText = `통증: ${draft.body_area} (강도 ${draft.intensity}/10)${draft.sensation ? ` - ${draft.sensation}` : ""}`;
      const result = await runtime.healthRecords.create({
        householdId: PRIMARY_HOUSEHOLD_ID,
        profileId: profile.id,
        recordType: "pain",
        recordedAt: draft.onset_at ? new Date(draft.onset_at).toISOString() : new Date().toISOString(),
        source: "local_ai",
        payload: {
          type: "pain",
          bodyArea: draft.body_area,
          intensity: draft.intensity,
          sensation: draft.sensation ?? undefined,
          onsetAt: draft.onset_at ?? undefined,
          note: draft.note || summaryText,
        },
      });

      if (!result.ok) throw new Error(result.error.message);

      setMessages((prev) =>
        prev.map((m) => (m.id === msgId ? { ...m, saved: true } : m)),
      );
      if (onRecordSaved) await onRecordSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "통증 기록 저장에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }

  // 검진/검사 서류 결과 로컬 저장 (원본 이미지 문서 보관 연계)
  async function saveLabResult(draft: LabResultDraft, msgId: string, imageFile?: File) {
    if (!runtime || !profile) return;
    setLoading(true);
    try {
      let primaryDocumentId: string | undefined;
      // 첨부된 원본 이미지가 있다면 로컬 암호화 서류 저장소에 보관
      if (runtime.documents && imageFile) {
        const savedDoc = await runtime.documents.save({
          householdId: PRIMARY_HOUSEHOLD_ID,
          profileId: profile.id,
          file: imageFile,
          fileName: imageFile.name,
        });
        if (!savedDoc.ok) throw new Error(savedDoc.error.message);
        primaryDocumentId = savedDoc.value.id;
      }

      const finalNote = [
        draft.summary ? `[검진 요약]\n${draft.summary}` : "",
        draft.items_summary ? `[검사 항목 및 결과]\n${draft.items_summary}` : "",
      ]
        .filter(Boolean)
        .join("\n\n");

      const result = await runtime.healthRecords.create({
        householdId: PRIMARY_HOUSEHOLD_ID,
        profileId: profile.id,
        recordType: "health_screening",
        recordedAt: draft.recorded_at ? new Date(draft.recorded_at).toISOString() : new Date().toISOString(),
        source: imageFile ? "ocr" : "local_ai",
        sourceDocumentId: primaryDocumentId,
        payload: {
          type: "health_screening",
          screeningName: draft.screening_name || "건강검진",
          institution: draft.institution ?? undefined,
          summary: draft.summary ?? "",
          itemsSummary: draft.items_summary ?? "",
          note: finalNote || draft.summary || "건강검진 결과",
        },
      });

      if (!result.ok) throw new Error(result.error.message);

      setMessages((prev) =>
        prev.map((m) => (m.id === msgId ? { ...m, saved: true } : m)),
      );
      if (onRecordSaved) await onRecordSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "검진 결과 저장에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }

  const quickPrompts = [
    "검진 수치 변화 그래프",
    "최근 건강검진 결과 원본 보여줘",
    "혈압 120에 80",
    "랫풀다운 20kg 10개 3세트",
    "저녁 8시에 타이레놀 1알 복용",
  ];

  return (
    <div className="health-assistant-backdrop" role="presentation" onMouseDown={(e) => {
      if (e.target === e.currentTarget) onClose();
    }}>
      <aside className="health-assistant-drawer" role="dialog" aria-label="AI 건강 비서 봄이">
        {/* 헤더 */}
        <header className="assistant-header">
          <div className="assistant-header-title">
            <span className="assistant-avatar" aria-hidden="true">봄</span>
            <div>
              <h3>봄이 · 건강 비서</h3>
              <p>
                {profile ? (
                  <span className="target-profile-pill">{profile.displayName} ({profile.relationship})</span>
                ) : (
                  <span>프로필을 선택해 주세요</span>
                )}
                <span className="privacy-pill">기록은 기기에 암호화 보관</span>
              </p>
            </div>
          </div>
          <button className="assistant-close-btn" type="button" onClick={onClose} aria-label="닫기">
            ×
          </button>
        </header>

        {/* 메시지 리스트 */}
        <div className="assistant-messages-container">
          {messages.map((msg) => (
            <div key={msg.id} className={`assistant-message-row ${msg.role}`}>
              {msg.role === "assistant" && (
                <span className="msg-avatar" aria-hidden="true">봄</span>
              )}
              <div className="msg-bubble-wrap">
                {/* 첨부 이미지 썸네일 (사용자가 이미지를 전송한 경우) */}
                {msg.imageBlobUrl && (
                  <div className="msg-attached-image">
                    <img src={msg.imageBlobUrl} alt="업로드된 건강 서류" />
                  </div>
                )}

                <div className="msg-bubble">
                  {msg.content.split("\n\n").map((para, i) => (
                    <p key={i}>{para}</p>
                  ))}

                  {/* 응급 주의사항 배너 */}
                  {msg.responseDraft?.emergency_notice && (
                    <div className="emergency-notice-banner" role="alert">
                      <strong>응급 주의 안내</strong>
                      <p>{msg.responseDraft.emergency_notice}</p>
                    </div>
                  )}

                  {/* 비진단 안전 안내문 */}
                  {msg.responseDraft?.safety_disclaimer && (
                    <p className="safety-disclaimer-text">
                      ※ {msg.responseDraft.safety_disclaimer}
                    </p>
                  )}
                </div>

                {/* 대화 내 인라인 원본 서류 이미지 미리보기 목록 (단일/다중 모두 지원) */}
                {msg.attachedDocuments && msg.attachedDocuments.length > 0 && runtime && (
                  <div className="attached-docs-container">
                    {msg.attachedDocuments.map((doc) => (
                      <InlineDocumentPreview
                        key={doc.id}
                        documentId={doc.id}
                        runtime={runtime}
                        onOpen={() => openSourceDocument(doc.id)}
                      />
                    ))}
                  </div>
                )}

                {/* 운동 초안 확인 카드 */}
                {msg.responseDraft?.exercise_draft &&
                  msg.responseDraft.needs_confirmation &&
                  msg.responseDraft.missing_fields.length === 0 &&
                  msg.role === "assistant" && (
                  <ExerciseConfirmationCard
                    draft={msg.responseDraft.exercise_draft}
                    saved={Boolean(msg.saved)}
                    onSave={(updated) => saveExercise(updated, msg.id)}
                  />
                )}

                {/* 혈압 초안 확인 카드 */}
                {msg.responseDraft?.blood_pressure_draft &&
                  msg.responseDraft.needs_confirmation &&
                  msg.responseDraft.missing_fields.length === 0 &&
                  msg.role === "assistant" && (
                    <BloodPressureConfirmationCard
                      draft={msg.responseDraft.blood_pressure_draft}
                      saved={Boolean(msg.saved)}
                      onSave={(updated) => saveBloodPressure(updated, msg.id)}
                    />
                  )}

                {/* 복약 초안 확인 카드 */}
                {msg.responseDraft?.medication_draft &&
                  msg.responseDraft.needs_confirmation &&
                  msg.responseDraft.missing_fields.length === 0 &&
                  msg.role === "assistant" && (
                  <MedicationConfirmationCard
                    draft={msg.responseDraft.medication_draft}
                    saved={Boolean(msg.saved)}
                    onSave={(updated) => saveMedication(updated, msg.id)}
                  />
                )}

                {/* 통증 초안 확인 카드 */}
                {msg.responseDraft?.pain_draft &&
                  msg.responseDraft.needs_confirmation &&
                  msg.responseDraft.missing_fields.length === 0 &&
                  msg.role === "assistant" && (
                  <PainConfirmationCard
                    draft={msg.responseDraft.pain_draft}
                    saved={Boolean(msg.saved)}
                    onSave={(updated) => savePain(updated, msg.id)}
                  />
                )}

                {/* 검진/검사 서류 초안 확인 카드 */}
                {msg.responseDraft?.lab_result_draft &&
                  msg.responseDraft.needs_confirmation &&
                  msg.responseDraft.missing_fields.length === 0 &&
                  msg.role === "assistant" && (
                  <LabResultConfirmationCard
                    draft={msg.responseDraft.lab_result_draft}
                    saved={Boolean(msg.saved)}
                    onSave={(updated) => saveLabResult(updated, msg.id, msg.imageFile)}
                  />
                )}

                {/* 시계열 검진/측정 수치 변화 추이 차트 카드 */}
                {msg.showTrendChart && msg.trendMetrics && msg.trendMetrics.length > 0 && (
                  <HealthMetricsTrendCard seriesList={msg.trendMetrics} initialKey={msg.trendInitialKey} />
                )}

                {/* AI 추천 퀵 리플라이 칩 */}
                {msg.responseDraft?.suggested_quick_replies &&
                  msg.responseDraft.suggested_quick_replies.length > 0 &&
                  !msg.saved && (
                    <div className="quick-reply-chips">
                      {msg.responseDraft.suggested_quick_replies.map((reply, idx) => (
                        <button
                          key={idx}
                          type="button"
                          className="chip-btn"
                          onClick={() => void handleSend(reply)}
                        >
                          {reply}
                        </button>
                      ))}
                    </div>
                  )}
              </div>
            </div>
          ))}

          {/* 로컬 조회 결과 렌더링 카드 (원본 서류 보기 지원) */}
          {queriedRecords && (
            <QueriedRecordsView
              records={queriedRecords}
              onNavigate={onNavigateToRecords}
              onOpenDocument={openSourceDocument}
            />
          )}

          {loading && (
            <div className="assistant-message-row assistant">
              <span className="msg-avatar" aria-hidden="true">봄</span>
              <div className="msg-bubble loading-dots">
                <span>.</span><span>.</span><span>.</span>
              </div>
            </div>
          )}

          {error && <div className="assistant-error-alert">{error}</div>}
          <div ref={messagesEndRef} />
        </div>

        {/* 하단 입력창 및 퀵 프롬프트 */}
        <footer className="assistant-footer">
          <div className="quick-prompts-bar">
            {quickPrompts.map((prompt, idx) => (
              <button
                key={idx}
                type="button"
                className="prompt-chip"
                onClick={() => void handleSend(prompt)}
              >
                {prompt}
              </button>
            ))}
          </div>

          {/* 선택된 이미지 미리보기 바 */}
          {imagePreview && selectedImage && (
            <div className="assistant-selected-image-bar">
              <img src={imagePreview} alt="선택된 이미지 미리보기" className="image-thumb" />
              <div className="image-info">
                <strong>{selectedImage.name}</strong>
                <small>{(selectedImage.size / 1024 / 1024).toFixed(2)} MB</small>
              </div>
              <button
                type="button"
                className="clear-image-btn"
                onClick={clearSelectedImage}
                aria-label="선택 취소"
              >
                ×
              </button>
            </div>
          )}

          <p className="assistant-data-notice">
            AI 답변 생성을 위해 입력 내용과 질문에 필요한 최근 기록 일부가 외부 AI로 전송될 수 있습니다.
          </p>
          <form
            className="assistant-input-form"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              void handleSend();
            }}
          >
            {/* 숨겨진 이미지 파일 인풋 */}
            <input
              type="file"
              ref={fileInputRef}
              accept="image/jpeg,image/png,image/webp"
              style={{ display: "none" }}
              onChange={handleImageSelect}
            />
            {/* + 버튼 (이미지 파일 업로드) */}
            <button
              type="button"
              className="assistant-attach-btn"
              onClick={() => fileInputRef.current?.click()}
              aria-label="검진표/서류 이미지 업로드"
              title="검진표/서류 이미지 업로드"
              disabled={loading || !profile}
            >
              +
            </button>

            <input
              type="text"
              placeholder={selectedImage ? "서류에 대해 추가할 메모나 질문을 적어주세요..." : "건강정보를 입력하거나 질문하세요..."}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={loading || !profile}
            />
            <button
              type="submit"
              className="assistant-send-btn"
              disabled={(!input.trim() && !selectedImage) || loading || !profile}
            >
              전송
            </button>
          </form>
        </footer>
      </aside>

      {/* 원본 서류 이미지 크게 보기 모달 */}
      {sourcePreviewModal && (
        <div className="modal-backdrop source-preview-backdrop" role="presentation" onMouseDown={() => setSourcePreviewModal(null)}>
          <section className="source-preview-modal" role="dialog" aria-modal="true" aria-label="연결된 원본 서류" onMouseDown={(e) => e.stopPropagation()}>
            <header>
              <strong>{sourcePreviewModal.name}</strong>
              <button type="button" aria-label="닫기" onClick={() => setSourcePreviewModal(null)}>×</button>
            </header>
            <div className="source-image-wrap">
              <img src={sourcePreviewModal.url} alt="건강기록에 연결된 원본 서류 이미지" />
            </div>
          </section>
        </div>
      )}

      {/* 서류 OCR 상세 검토 및 건강기록 확정 저장 모달 */}
      {ocrModalOpen && ocrImagePreviewUrl && (
        <OcrReviewModal
          profileName={profile.displayName}
          imageUrl={ocrImagePreviewUrl}
          fileName={ocrImageFile?.name ?? "검진 서류"}
          draft={ocrReviewDraft}
          working={ocrModalWorking}
          onClose={() => {
            setOcrModalOpen(false);
            clearSelectedImage();
          }}
          onConfirm={(updatedDraft) => void handleConfirmOcrModalSave(updatedDraft)}
        />
      )}
    </div>
  );
}

// -------------------------------------------------------------
// 서류 OCR 상세 검토 및 저장 모달 (2분할 분할 뷰)
// -------------------------------------------------------------
function OcrReviewModal({
  profileName,
  imageUrl,
  fileName,
  draft,
  working,
  onClose,
  onConfirm,
}: {
  profileName: string;
  imageUrl: string;
  fileName: string;
  draft: LabResultDraft | null;
  working: boolean;
  onClose: () => void;
  onConfirm: (draft: LabResultDraft) => void;
}) {
  const [recordedAt, setRecordedAt] = useState(draft?.recorded_at ?? new Date().toISOString().slice(0, 10));
  const [screeningName, setScreeningName] = useState(draft?.screening_name ?? "국가건강검진");
  const [institution, setInstitution] = useState(draft?.institution ?? "");
  const [itemsSummary, setItemsSummary] = useState(draft?.items_summary ?? "");
  const [summary, setSummary] = useState(draft?.summary ?? "");

  // draft가 비동기로 로드되었을 때 상태 동기화
  useEffect(() => {
    if (draft) {
      if (draft.recorded_at) setRecordedAt(draft.recorded_at);
      if (draft.screening_name) setScreeningName(draft.screening_name);
      if (draft.institution) setInstitution(draft.institution);
      if (draft.items_summary) setItemsSummary(draft.items_summary);
      if (draft.summary) setSummary(draft.summary);
    }
  }, [draft]);

  return (
    <div className="modal-backdrop ocr-split-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="modal-panel ocr-split-modal" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-heading">
          <div>
            <p className="section-kicker">서류 OCR 상세 검토</p>
            <h2>{profileName}님의 {fileName} 분석 결과</h2>
          </div>
          <button className="modal-close" type="button" onClick={onClose} aria-label="닫기">×</button>
        </div>

        <p className="form-notice">
          ※ 원본 서류와 AI 추출 내용을 꼼꼼히 대조해 주세요. 실제 검사일자와 수치를 수정한 후 저장할 수 있습니다.
        </p>

        <div className="ocr-split-body">
          {/* 왼쪽: 원본 서류 이미지 미리보기 */}
          <div className="ocr-split-left">
            <div className="ocr-preview-header">
              <strong>원본 서류 ({fileName})</strong>
            </div>
            <div className="ocr-preview-image-scroll">
              <img src={imageUrl} alt={fileName} />
            </div>
          </div>

          {/* 오른쪽: OCR 추출 내용 및 편집 폼 */}
          <div className="ocr-split-right">
            {working && !draft ? (
              <div className="ocr-modal-loading">
                <div className="loading-dots">
                  <span>●</span><span>●</span><span>●</span>
                </div>
                <p>AI가 서류의 검사 항목과 판정일자를 정밀 분석하고 있습니다…</p>
              </div>
            ) : (
              <div className="ocr-edit-fields">
                <div className="compact-row">
                  <label>
                    실제 검사/판정 일자
                    <input
                      type="date"
                      value={recordedAt}
                      onChange={(e) => setRecordedAt(e.target.value)}
                      required
                    />
                  </label>
                  <label>
                    검진·서류명
                    <input
                      value={screeningName}
                      onChange={(e) => setScreeningName(e.target.value)}
                      placeholder="국가건강검진 등"
                    />
                  </label>
                </div>

                <label>
                  검진 기관
                  <input
                    value={institution}
                    onChange={(e) => setInstitution(e.target.value)}
                    placeholder="병원/검진기관명"
                  />
                </label>

                <label>
                  전체 검사 항목 및 수치 (혈액, 계측, 요검사, 노인기능평가 등)
                  <textarea
                    rows={6}
                    value={itemsSummary}
                    onChange={(e) => setItemsSummary(e.target.value)}
                    placeholder="검사 수치 및 판정 내용"
                  />
                </label>

                <label>
                  검진 핵심 요약
                  <textarea
                    rows={2}
                    value={summary}
                    onChange={(e) => setSummary(e.target.value)}
                    placeholder="종합 소견 및 요약"
                  />
                </label>
              </div>
            )}
          </div>
        </div>

        <div className="form-actions">
          <button className="secondary-button" type="button" onClick={onClose}>
            취소
          </button>
          <button
            className="primary-button"
            type="button"
            disabled={working || !recordedAt}
            onClick={() => onConfirm({
              screening_name: screeningName,
              recorded_at: recordedAt,
              institution,
              items_summary: itemsSummary,
              summary,
            })}
          >
            {working ? "저장 중…" : "수정 내용 확정 · 건강기록 저장"}
          </button>
        </div>
      </section>
    </div>
  );
}

// -------------------------------------------------------------
// 하위 확인 카드 컴포넌트들
// -------------------------------------------------------------

function ExerciseConfirmationCard({
  draft,
  saved,
  onSave,
}: {
  draft: ExerciseDraft;
  saved: boolean;
  onSave: (updated: ExerciseDraft) => void;
}) {
  const [exerciseName, setExerciseName] = useState(draft.exercise_name);
  const [distanceKm, setDistanceKm] = useState<number | undefined>(draft.distance_km ?? undefined);
  const [durationMinutes, setDurationMinutes] = useState<number | undefined>(draft.duration_minutes ?? undefined);
  const [weightKg, setWeightKg] = useState<number | undefined>(draft.weight_kg ?? undefined);
  const [reps, setReps] = useState<number | undefined>(draft.reps ?? undefined);
  const [sets, setSets] = useState<number | undefined>(draft.sets ?? undefined);
  const [showWeightFields, setShowWeightFields] = useState<boolean>(
    Boolean(draft.weight_kg || draft.reps || draft.sets),
  );
  const [dateStr, setDateStr] = useState<string>(
    draft.date_str || new Date().toISOString().slice(0, 16),
  );

  const isCardio =
    Boolean(draft.distance_km) ||
    /(?:달리기|러닝|조깅|자전거|사이클|라이딩|걷기|산책|마라톤|트레킹|하이킹|유산소|run|cycle|bike|walk)/i.test(
      exerciseName,
    );

  if (saved) {
    return (
      <div className="draft-confirm-card is-saved">
        <span className="saved-badge">안전하게 저장되었습니다.</span>
        <p>
          <strong>{exerciseName}</strong>: {distanceKm ? `거리 ${distanceKm}km · ` : ""}{durationMinutes ? `시간 ${durationMinutes}분 · ` : ""}{weightKg ? `${weightKg}kg ` : ""}{reps ? `${reps}회 ` : ""}{sets ? `${sets}세트` : ""}
          <small style={{ display: "block", color: "#64748b", marginTop: "2px" }}>
            {formatTargetDateTime(dateStr)}
          </small>
        </p>
      </div>
    );
  }

  return (
    <div className="draft-confirm-card">
      <div className="card-header">
        <strong>운동 기록 확인</strong>
        <small>{isCardio ? "운동 거리, 시간 및 일시를 확인하고 저장할 수 있습니다" : "운동 종목, 시간 및 일시를 확인하고 저장할 수 있습니다"}</small>
      </div>
      <div className="card-inputs">
        <div className="input-row">
          <label style={{ flex: 1.2 }}>
            종목
            <input
              value={exerciseName}
              onChange={(e) => setExerciseName(e.target.value)}
              placeholder="예: 러닝, 자전거, 랫풀다운"
            />
          </label>
          {isCardio ? (
            <>
              <label style={{ flex: 0.9 }}>
                거리 (km)
                <input
                  type="number"
                  step="0.1"
                  value={distanceKm ?? ""}
                  onChange={(e) => setDistanceKm(e.target.value ? parseFloat(e.target.value) : undefined)}
                  placeholder="예: 5.0 (km)"
                />
              </label>
              <label style={{ flex: 0.9 }}>
                시간 (분)
                <input
                  type="number"
                  value={durationMinutes ?? ""}
                  onChange={(e) => setDurationMinutes(e.target.value ? parseInt(e.target.value, 10) : undefined)}
                  placeholder="예: 30 (분)"
                />
              </label>
            </>
          ) : (
            <label style={{ flex: 1 }}>
              운동 시간 (분)
              <input
                type="number"
                value={durationMinutes ?? ""}
                onChange={(e) => setDurationMinutes(e.target.value ? parseInt(e.target.value, 10) : undefined)}
                placeholder="예: 30 (분)"
              />
            </label>
          )}
        </div>

        {/* 유산소가 아니거나, 근력 필드를 보려는 경우 */}
        {(!isCardio || showWeightFields) && (
          <div className="input-row">
            {!isCardio && (
              <label>
                거리 (km)
                <input
                  type="number"
                  step="0.1"
                  value={distanceKm ?? ""}
                  onChange={(e) => setDistanceKm(e.target.value ? parseFloat(e.target.value) : undefined)}
                  placeholder="km (옵션)"
                />
              </label>
            )}
            <label>
              무게 (kg)
              <input
                type="number"
                value={weightKg ?? ""}
                onChange={(e) => setWeightKg(e.target.value ? parseFloat(e.target.value) : undefined)}
                placeholder="kg"
              />
            </label>
            <label>
              횟수 (회)
              <input
                type="number"
                value={reps ?? ""}
                onChange={(e) => setReps(e.target.value ? parseInt(e.target.value, 10) : undefined)}
                placeholder="회"
              />
            </label>
            <label>
              세트
              <input
                type="number"
                value={sets ?? ""}
                onChange={(e) => setSets(e.target.value ? parseInt(e.target.value, 10) : undefined)}
                placeholder="세트"
              />
            </label>
          </div>
        )}

        {isCardio && !showWeightFields && (
          <button
            type="button"
            className="secondary-toggle-btn"
            style={{ fontSize: "0.78rem", color: "#64748b", background: "none", border: "none", textAlign: "left", cursor: "pointer", padding: "2px 0", marginBottom: "4px" }}
            onClick={() => setShowWeightFields(true)}
          >
            + 중량/세트 추가 입력하기
          </button>
        )}

        <label>
          운동 일시
          <input
            type="datetime-local"
            value={dateStr}
            onChange={(e) => setDateStr(e.target.value)}
          />
        </label>
      </div>
      <button
        type="button"
        className="confirm-save-btn"
        disabled={!exerciseName}
        onClick={() =>
          onSave({
            ...draft,
            exercise_name: exerciseName,
            distance_km: distanceKm,
            duration_minutes: durationMinutes,
            weight_kg: weightKg,
            reps,
            sets,
            date_str: dateStr,
          })
        }
      >
        운동 기록에 저장하기
      </button>
    </div>
  );
}

function BloodPressureConfirmationCard({
  draft,
  saved,
  onSave,
}: {
  draft: BloodPressureDraft;
  saved: boolean;
  onSave: (updated: BloodPressureDraft) => void;
}) {
  const [systolic, setSystolic] = useState<number | undefined>(draft.systolic ?? undefined);
  const [diastolic, setDiastolic] = useState<number | undefined>(draft.diastolic ?? undefined);
  const [pulse, setPulse] = useState<number | undefined>(draft.pulse ?? undefined);

  if (saved) {
    return (
      <div className="draft-confirm-card is-saved">
        <span className="saved-badge">안전하게 저장되었습니다.</span>
        <p><strong>혈압</strong>: {systolic}/{diastolic} mmHg {pulse ? `(맥박 ${pulse}bpm)` : ""}</p>
      </div>
    );
  }

  return (
    <div className="draft-confirm-card">
      <div className="card-header">
        <strong>혈압 측정치 확인</strong>
        <small>수정 후 저장할 수 있습니다</small>
      </div>
      <div className="card-inputs">
        <div className="input-row">
          <label>
            수축기(높은 수치)
            <input
              type="number"
              value={systolic ?? ""}
              onChange={(e) => setSystolic(e.target.value ? parseInt(e.target.value, 10) : undefined)}
              placeholder="120"
            />
          </label>
          <label>
            이완기(낮은 수치)
            <input
              type="number"
              value={diastolic ?? ""}
              onChange={(e) => setDiastolic(e.target.value ? parseInt(e.target.value, 10) : undefined)}
              placeholder="80"
            />
          </label>
          <label>
            맥박(선택)
            <input
              type="number"
              value={pulse ?? ""}
              onChange={(e) => setPulse(e.target.value ? parseInt(e.target.value, 10) : undefined)}
              placeholder="72"
            />
          </label>
        </div>
      </div>
      <button
        type="button"
        className="confirm-save-btn"
        disabled={!systolic || !diastolic}
        onClick={() => onSave({ ...draft, systolic, diastolic, pulse })}
      >
        혈압 기록에 저장하기
      </button>
    </div>
  );
}

function MedicationConfirmationCard({
  draft,
  saved,
  onSave,
}: {
  draft: MedicationDraft;
  saved: boolean;
  onSave: (updated: MedicationDraft) => void;
}) {
  const [medicationName, setMedicationName] = useState(draft.medication_name);
  const [dosage, setDosage] = useState(draft.dosage ?? "");
  const [takenAt, setTakenAt] = useState(draft.taken_at ?? "");

  if (saved) {
    return (
      <div className="draft-confirm-card is-saved">
        <span className="saved-badge">안전하게 저장되었습니다.</span>
        <p><strong>{medicationName}</strong>: {dosage} {takenAt ? `(${takenAt})` : ""}</p>
      </div>
    );
  }

  return (
    <div className="draft-confirm-card">
      <div className="card-header">
        <strong>복약 기록 확인</strong>
        <small>수정 후 저장할 수 있습니다</small>
      </div>
      <div className="card-inputs">
        <label>
          약물 이름
          <input
            value={medicationName}
            onChange={(e) => setMedicationName(e.target.value)}
            placeholder="타이레놀 등"
          />
        </label>
        <div className="input-row">
          <label>
            용량/수량
            <input
              value={dosage}
              onChange={(e) => setDosage(e.target.value)}
              placeholder="1알, 500mg 등"
            />
          </label>
          <label>
            복용 시각
            <input
              value={takenAt}
              onChange={(e) => setTakenAt(e.target.value)}
              placeholder="저녁 8시 등"
            />
          </label>
        </div>
      </div>
      <button
        type="button"
        className="confirm-save-btn"
        disabled={!medicationName}
        onClick={() => onSave({ ...draft, medication_name: medicationName, dosage, taken_at: takenAt })}
      >
        복약 기록에 저장하기
      </button>
    </div>
  );
}

function PainConfirmationCard({
  draft,
  saved,
  onSave,
}: {
  draft: PainDraft;
  saved: boolean;
  onSave: (updated: PainDraft) => void;
}) {
  const [bodyArea, setBodyArea] = useState(draft.body_area);
  const [intensity, setIntensity] = useState(draft.intensity ?? 5);
  const [sensation, setSensation] = useState(draft.sensation ?? "");
  const [note, setNote] = useState(draft.note ?? "");

  if (saved) {
    return (
      <div className="draft-confirm-card is-saved">
        <span className="saved-badge">안전하게 저장되었습니다.</span>
        <p><strong>{bodyArea}</strong>: 강도 {intensity}/10 {sensation ? `(${sensation})` : ""}</p>
      </div>
    );
  }

  return (
    <div className="draft-confirm-card">
      <div className="card-header">
        <strong>통증 기록 확인</strong>
        <small>부위와 강도를 확인하고 저장해 주세요</small>
      </div>
      <div className="card-inputs">
        <label>
          통증 부위
          <input
            value={bodyArea}
            onChange={(e) => setBodyArea(e.target.value)}
            placeholder="오른쪽 무릎, 허리, 어깨 등"
          />
        </label>
        <div className="input-row">
          <label>
            통증 강도 ({intensity}/10)
            <div className="pain-intensity-slider-wrap">
              <input
                type="range"
                min="0"
                max="10"
                value={intensity}
                onChange={(e) => setIntensity(Number(e.target.value))}
              />
              <span className="pain-intensity-val">{intensity}</span>
            </div>
          </label>
          <label>
            통증 양상
            <input
              value={sensation}
              onChange={(e) => setSensation(e.target.value)}
              placeholder="욱신거림, 찌르는 듯함 등"
            />
          </label>
        </div>
        {note && (
          <label>
            메모
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="특이사항"
            />
          </label>
        )}
      </div>
      <button
        type="button"
        className="confirm-save-btn"
        disabled={!bodyArea}
        onClick={() => onSave({ ...draft, body_area: bodyArea, intensity, sensation, note })}
      >
        통증 기록에 저장하기
      </button>
    </div>
  );
}

function InlineDocumentPreview({
  documentId,
  runtime,
  onOpen,
}: {
  documentId: string;
  runtime: LocalDomainRuntime;
  onOpen: () => void;
}) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>("원본 서류");

  useEffect(() => {
    let active = true;
    let urlToRevoke: string | null = null;

    if (runtime.documents) {
      void runtime.documents.readById(documentId).then((res) => {
        if (active && res.ok) {
          const url = URL.createObjectURL(res.value.file);
          urlToRevoke = url;
          setImageUrl(url);
          setFileName(res.value.fileName);
        }
      });
    }

    return () => {
      active = false;
      if (urlToRevoke) URL.revokeObjectURL(urlToRevoke);
    };
  }, [documentId, runtime]);

  if (!imageUrl) {
    return (
      <div className="inline-doc-card is-loading">
        <span>서류 이미지를 불러오는 중…</span>
      </div>
    );
  }

  return (
    <div className="inline-doc-card" onClick={onOpen} role="button" tabIndex={0}>
      <div className="inline-doc-header">
        <span className="doc-badge">원본 서류</span>
        <strong>{fileName}</strong>
        <span className="expand-hint">클릭하여 확대</span>
      </div>
      <div className="inline-doc-preview-wrap">
        <img src={imageUrl} alt={fileName} />
      </div>
    </div>
  );
}

function LabResultConfirmationCard({
  draft,
  saved,
  onSave,
}: {
  draft: LabResultDraft;
  saved: boolean;
  onSave: (updated: LabResultDraft) => void;
}) {
  const [screeningName, setScreeningName] = useState(draft.screening_name ?? "건강검진");
  const [recordedAt, setRecordedAt] = useState(draft.recorded_at ?? new Date().toISOString().slice(0, 10));
  const [summary, setSummary] = useState(draft.summary ?? "");
  const [itemsSummary, setItemsSummary] = useState(draft.items_summary ?? "");

  if (saved) {
    return (
      <div className="draft-confirm-card is-saved">
        <span className="saved-badge">안전하게 저장되었습니다.</span>
        <p><strong>{screeningName}</strong> ({recordedAt}): {summary || "검진 결과가 안전하게 저장되었습니다."}</p>
      </div>
    );
  }

  return (
    <div className="draft-confirm-card">
      <div className="card-header">
        <strong>검진/검사 결과 확인</strong>
        <small>실제 검사일자를 확인하고 수정할 수 있습니다</small>
      </div>
      <div className="card-inputs">
        <div className="input-row">
          <label>
            실제 검사 일자
            <input
              type="date"
              value={recordedAt}
              onChange={(e) => setRecordedAt(e.target.value)}
            />
          </label>
          <label>
            검진·서류명
            <input
              value={screeningName}
              onChange={(e) => setScreeningName(e.target.value)}
              placeholder="국가건강검진, 혈액종합검사 등"
            />
          </label>
        </div>
        {itemsSummary && (
          <label>
            주요 검사 항목
            <textarea
              rows={4}
              value={itemsSummary}
              onChange={(e) => setItemsSummary(e.target.value)}
            />
          </label>
        )}
        <label>
          검진 요약
          <textarea
            rows={3}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="검사 결과 핵심 요약"
          />
        </label>
      </div>
      <button
        type="button"
        className="confirm-save-btn"
        onClick={() => onSave({ ...draft, screening_name: screeningName, recorded_at: recordedAt, summary, items_summary: itemsSummary })}
      >
        건강검진 기록으로 저장하기
      </button>
    </div>
  );
}

function QueriedRecordsView({
  records,
  onNavigate,
  onOpenDocument,
}: {
  records: HealthRecord[];
  onNavigate?: () => void;
  onOpenDocument?: (documentId: string) => void;
}) {
  const [showTrend, setShowTrend] = useState(false);
  const trendMetrics = extractMetricsFromRecords(records);

  const RECORD_TYPE_LABELS: Record<string, string> = {
    exercise: "운동",
    blood_pressure: "혈압",
    blood_glucose: "혈당",
    medication: "복약",
    pain: "통증",
    health_screening: "검진",
    lab_result: "검사",
    body_measurement: "체성분",
    walking: "걷기",
    vaccination: "접종",
    note: "메모",
  };

  return (
    <div className="queried-records-card">
      <div className="query-header">
        <strong>조회된 건강 기록 ({records.length}건)</strong>
        <div className="query-header-actions">
          {trendMetrics.length > 0 && (
            <button
              type="button"
              className="trend-toggle-header-btn"
              onClick={() => setShowTrend((prev) => !prev)}
            >
              {showTrend ? "목록 표 보기" : "수치 그래프"}
            </button>
          )}
          {onNavigate && (
            <button type="button" className="view-all-link" onClick={onNavigate}>
              전체 보기
            </button>
          )}
        </div>
      </div>

      {showTrend && trendMetrics.length > 0 ? (
        <HealthMetricsTrendCard seriesList={trendMetrics} />
      ) : records.length === 0 ? (
        <p className="query-empty">해당 조건의 저장된 기록이 없습니다.</p>
      ) : (
        <div className="queried-table-wrapper">
          <table className="queried-records-table">
            <thead>
              <tr>
                <th scope="col" style={{ width: "28%" }}>기록 일시</th>
                <th scope="col" style={{ width: "16%" }}>종류</th>
                <th scope="col">상세 내용 및 수치</th>
                <th scope="col" style={{ width: "20%" }}>서류/관리</th>
              </tr>
            </thead>
            <tbody>
              {records.slice(0, 10).map((rec) => {
                const p = rec.payload as Record<string, unknown>;
                const typeLabel = RECORD_TYPE_LABELS[rec.recordType] || rec.recordType;

                let contentText = "";
                if (rec.recordType === "exercise" || p.exerciseName) {
                  const details: string[] = [];
                  if (p.distanceKm) details.push(`${p.distanceKm}km`);
                  if (p.durationMinutes) details.push(`${p.durationMinutes}분`);
                  if (p.weightKg) details.push(`${p.weightKg}kg`);
                  if (p.reps) details.push(`${p.reps}회`);
                  if (p.sets) details.push(`${p.sets}세트`);
                  contentText = `${p.exerciseName ?? "운동"}${details.length > 0 ? ` (${details.join(" · ")})` : ""}`;
                } else if (rec.recordType === "blood_pressure" || p.systolicMmHg) {
                  contentText = `${p.systolicMmHg}/${p.diastolicMmHg} mmHg${p.pulseBpm ? ` (맥박 ${p.pulseBpm})` : ""}`;
                } else if (rec.recordType === "blood_glucose" || p.valueMgDl) {
                  contentText = `${p.valueMgDl} mg/dL${p.timing ? ` (${p.timing})` : ""}`;
                } else if (rec.recordType === "medication" || p.medicationName) {
                  contentText = `${p.medicationName}${p.dosage ? ` ${p.dosage}` : ""}${p.takenAt ? ` (${p.takenAt})` : ""}`;
                } else if (rec.recordType === "pain" || p.bodyArea) {
                  contentText = `${p.bodyArea} · 강도 ${p.intensity}/10${p.sensation ? ` (${p.sensation})` : ""}`;
                } else if (rec.recordType === "health_screening" || p.screeningName) {
                  contentText = `${p.screeningName ?? "검진"}${p.summary ? ` · ${p.summary}` : ""}`;
                } else {
                  contentText = String(p.note ?? p.summary ?? p.text ?? "-");
                }

                return (
                  <tr key={rec.id} className="queried-row">
                    <td className="cell-datetime">
                      <span className="datetime-badge">{formatTargetDateTime(rec.recordedAt)}</span>
                    </td>
                    <td className="cell-type">
                      <span className={`type-tag tag-${rec.recordType}`}>{typeLabel}</span>
                    </td>
                    <td className="cell-content">
                      <span className="content-main">{contentText}</span>
                      {typeof p.note === "string" && p.note !== contentText && !p.note.startsWith(contentText) && (
                        <small className="content-subnote">{p.note.slice(0, 50)}</small>
                      )}
                    </td>
                    <td className="cell-action">
                      {rec.sourceDocumentId && onOpenDocument ? (
                        <button
                          type="button"
                          className="table-view-source-btn"
                          onClick={() => onOpenDocument(rec.sourceDocumentId!)}
                        >
                          원본 서류
                        </button>
                      ) : (
                        <span className="no-doc-dash">-</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// -------------------------------------------------------------
// 건강검진/측정 시계열 수치 변화 그래프 카드 (인터랙티브 차트)
// -------------------------------------------------------------
export function HealthMetricsTrendCard({
  seriesList,
  initialKey,
}: {
  seriesList: MetricSeries[];
  initialKey?: string;
}) {
  const [activeKey, setActiveKey] = useState(
    initialKey && seriesList.some((s) => s.key === initialKey)
      ? initialKey
      : (seriesList[0]?.key ?? "bp"),
  );
  const currentSeries = seriesList.find((s) => s.key === activeKey) || seriesList[0];

  if (!currentSeries || currentSeries.points.length === 0) {
    return (
      <div className="trend-chart-card empty">
        <p>표시할 수치 기록이 없습니다.</p>
      </div>
    );
  }

  const points = currentSeries.points;
  const latest = points[points.length - 1];
  const prev = points.length > 1 ? points[points.length - 2] : null;
  const diff = prev ? latest.value - prev.value : 0;
  const diffSec = prev && latest.secondaryValue && prev.secondaryValue ? latest.secondaryValue - prev.secondaryValue : 0;

  // SVG 좌표 스케일링 계산
  const allValues = [
    ...points.map((p) => p.value),
    ...points.map((p) => p.secondaryValue).filter((v): v is number => typeof v === "number"),
  ];
  const minVal = Math.min(...allValues);
  const maxVal = Math.max(...allValues);
  const valRange = (maxVal - minVal) || 10;
  const yPad = Math.max(2, valRange * 0.15);
  const yMin = Math.max(0, Math.floor(minVal - yPad));
  const yMax = Math.ceil(maxVal + yPad);
  const yRange = (yMax - yMin) || 1;

  const width = 360;
  const height = 180;
  const padLeft = 36;
  const padRight = 24;
  const padTop = 24;
  const padBottom = 30;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const getX = (index: number) => {
    if (points.length === 1) return padLeft + plotW / 2;
    return padLeft + (index / (points.length - 1)) * plotW;
  };

  const getY = (val: number) => {
    return padTop + plotH - ((val - yMin) / yRange) * plotH;
  };

  // 주요 선 polyline 점들
  const linePoints = points.map((p, i) => `${getX(i)},${getY(p.value)}`).join(" ");
  const areaPoints = points.length > 1
    ? `${getX(0)},${padTop + plotH} ${linePoints} ${getX(points.length - 1)},${padTop + plotH}`
    : "";

  // 보조선 polyline 점들 (혈압 이완기, ALT 등)
  const hasSecondary = points.some((p) => typeof p.secondaryValue === "number");
  const secLinePoints = hasSecondary
    ? points.filter((p) => typeof p.secondaryValue === "number").map((p, i) => `${getX(i)},${getY(p.secondaryValue!)}`).join(" ")
    : "";

  return (
    <div className="trend-chart-card">
      <div className="trend-chart-header">
        <div>
          <span className="trend-chart-kicker">수치 변화 그래프</span>
          <h4 className="trend-chart-title">{currentSeries.name}</h4>
        </div>
        <div className="trend-latest-stat">
          <span className="trend-latest-val">
            {latest.value}{latest.secondaryValue ? ` / ${latest.secondaryValue}` : ""}
            <small> {currentSeries.unit}</small>
          </span>
          {prev && (
            <span className={`trend-diff-badge ${diff > 0 ? "is-up" : diff < 0 ? "is-down" : "is-same"}`}>
              {diff > 0 ? `▲ +${diff}` : diff < 0 ? `▼ ${diff}` : "변동 없음"}
              {diffSec !== 0 ? ` (${diffSec > 0 ? `+${diffSec}` : diffSec})` : ""}
            </span>
          )}
        </div>
      </div>

      {/* 지표 탭 바 */}
      {seriesList.length > 1 && (
        <div className="trend-tabs-bar">
          {seriesList.map((s) => (
            <button
              key={s.key}
              type="button"
              className={`trend-tab-btn ${s.key === activeKey ? "active" : ""}`}
              onClick={() => setActiveKey(s.key)}
            >
              {s.name.split(" ")[0]}
            </button>
          ))}
        </div>
      )}

      {/* SVG 그래프 영역 */}
      <div className="trend-svg-container">
        <svg viewBox={`0 0 ${width} ${height}`} className="trend-svg">
          <defs>
            <linearGradient id={`grad-${currentSeries.key}`} x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor={currentSeries.color} stopOpacity="0.25" />
              <stop offset="100%" stopColor={currentSeries.color} stopOpacity="0.0" />
            </linearGradient>
          </defs>

          {/* 배경 눈금선 (Y축) */}
          <line x1={padLeft} y1={padTop} x2={width - padRight} y2={padTop} stroke="#e2e8f0" strokeDasharray="3 3" />
          <line x1={padLeft} y1={padTop + plotH / 2} x2={width - padRight} y2={padTop + plotH / 2} stroke="#e2e8f0" strokeDasharray="3 3" />
          <line x1={padLeft} y1={padTop + plotH} x2={width - padRight} y2={padTop + plotH} stroke="#cbd5e1" strokeWidth="1" />

          {/* Y축 레이블 */}
          <text x={padLeft - 6} y={padTop + 4} textAnchor="end" fontSize="10" fill="#94a3b8">{yMax}</text>
          <text x={padLeft - 6} y={padTop + plotH / 2 + 3} textAnchor="end" fontSize="10" fill="#94a3b8">{Math.round((yMax + yMin) / 2)}</text>
          <text x={padLeft - 6} y={padTop + plotH} textAnchor="end" fontSize="10" fill="#94a3b8">{yMin}</text>

          {/* 면적 채우기 (Area) */}
          {areaPoints && (
            <polygon points={areaPoints} fill={`url(#grad-${currentSeries.key})`} />
          )}

          {/* 주요 선 (Polyline) */}
          {points.length > 1 && (
            <polyline
              points={linePoints}
              fill="none"
              stroke={currentSeries.color}
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* 보조 선 (Secondary Polyline) */}
          {hasSecondary && secLinePoints && (
            <polyline
              points={secLinePoints}
              fill="none"
              stroke={currentSeries.secondaryColor || "#3b82f6"}
              strokeWidth="2"
              strokeDasharray="4 2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* 데이터 포인트 (원 + 수치 라벨 + X축 일자) */}
          {points.map((p, i) => {
            const cx = getX(i);
            const cy = getY(p.value);
            return (
              <g key={i}>
                {/* 데이터 점 */}
                <circle cx={cx} cy={cy} r="4" fill="#ffffff" stroke={currentSeries.color} strokeWidth="2.5" />
                {/* 수치 라벨 */}
                <text x={cx} y={cy - 7} textAnchor="middle" fontSize="10" fontWeight="bold" fill={currentSeries.color}>
                  {p.value}
                </text>

                {/* 보조 데이터 점 */}
                {typeof p.secondaryValue === "number" && (
                  <>
                    <circle cx={cx} cy={getY(p.secondaryValue)} r="3.5" fill="#ffffff" stroke={currentSeries.secondaryColor || "#3b82f6"} strokeWidth="2" />
                    <text x={cx} y={getY(p.secondaryValue) + 12} textAnchor="middle" fontSize="9" fontWeight="bold" fill={currentSeries.secondaryColor || "#3b82f6"}>
                      {p.secondaryValue}
                    </text>
                  </>
                )}

                {/* X축 일자 */}
                <text x={cx} y={height - 8} textAnchor="middle" fontSize="9" fill="#64748b">
                  {p.date.slice(2)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* 범례 및 정상 참고치 안내 */}
      <div className="trend-footer-legend">
        <div className="trend-legend-items">
          <span className="legend-item">
            <span className="legend-dot" style={{ backgroundColor: currentSeries.color }} />
            {currentSeries.name.split(" ")[0]}
          </span>
          {hasSecondary && (
            <span className="legend-item">
              <span className="legend-dot" style={{ backgroundColor: currentSeries.secondaryColor || "#3b82f6" }} />
              {currentSeries.secondaryName || "보조 수치"}
            </span>
          )}
        </div>
        {currentSeries.normalRange && (
          <span className="trend-normal-hint">
            {currentSeries.normalRange.label}
          </span>
        )}
      </div>

      {/* 검사 기록 히스토리 테이블 */}
      <div className="trend-history-table">
        <table>
          <thead>
            <tr>
              <th>검사/측정 일자</th>
              <th>수치 ({currentSeries.unit})</th>
            </tr>
          </thead>
          <tbody>
            {[...points].reverse().map((p, idx) => (
              <tr key={idx}>
                <td>{p.date}</td>
                <td>
                  <strong>{p.value}</strong>
                  {p.secondaryValue ? ` / ${p.secondaryValue}` : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
