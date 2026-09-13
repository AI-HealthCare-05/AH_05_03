import { useEffect, useMemo, useState } from "react";
import type { FamilyProfile, HealthRecord } from "../../shared/local/domainContracts";
import {
  type HealthEvent,
  type MonitoringViewTab,
  PROVENANCE_BADGES,
} from "./familyMonitoringContracts";
import {
  getIntensityColor,
  getIntensityTextColor,
  getIntensityLabel,
} from "./holographicAnatomyStyle";

export interface FamilyIntegratedMonitoringProps {
  profiles: FamilyProfile[];
  selectedProfileId?: string;
  onSelectProfile: (profileId: string) => void;
  records: HealthRecord[];
  onSelectOrgan?: (
    organKey: string,
    label: string,
    intensity?: number,
    organIntensities?: Record<string, number>,
    focusedOrganKey?: string,
  ) => void;
}

interface OrganDefinition {
  key: string;
  label: string;
  system: string;
  defaultMeshName: string;
  keywords: string[];
}

const SUPPORTED_ORGANS: OrganDefinition[] = [
  {
    key: "lung",
    label: "폐",
    system: "respiratory",
    defaultMeshName: "VH_O_lung",
    keywords: ["폐암", "폐렴", "기관지", "흉막", "가슴 속", "lung", "폐"],
  },
  {
    key: "liver",
    label: "간",
    system: "digestive",
    defaultMeshName: "VH_O_liver",
    keywords: ["간암", "간경변", "간기능", "간염", "간장", "liver", "간"],
  },
  {
    key: "stomach",
    label: "위",
    system: "digestive",
    defaultMeshName: "VH_O_stomach",
    keywords: ["위암", "위궤양", "위염", "위장", "위식도", "위 통증", "위통", "위경련", "위산", "위벽", "위내시경", "속쓰림", "stomach", "위"],
  },
  {
    key: "colon",
    label: "대장",
    system: "digestive",
    defaultMeshName: "VH_O_colon",
    keywords: ["대장암", "대장염", "대장", "결장", "직장", "colon", "bowel"],
  },
  {
    key: "heart",
    label: "심장",
    system: "circulatory",
    defaultMeshName: "VH_O_heart",
    keywords: ["심근경색", "심혈관", "관상동맥", "부정맥", "심근", "심장", "heart"],
  },
  {
    key: "kidney",
    label: "신장",
    system: "urinary",
    defaultMeshName: "VH_O_kidney",
    keywords: ["신우염", "콩팥깔대기", "신우", "신장암", "신부전", "사구체", "콩팥", "신장", "renal pelvis", "kidney", "renal"],
  },
  {
    key: "pancreas",
    label: "췌장",
    system: "digestive",
    defaultMeshName: "VH_O_pancreas",
    keywords: ["췌장암", "췌장염", "췌장", "pancreas"],
  },
  {
    key: "gallbladder",
    label: "담낭",
    system: "digestive",
    defaultMeshName: "VH_O_gallbladder",
    keywords: ["담낭암", "담석", "쓸개", "담낭", "gallbladder"],
  },
  {
    key: "brain",
    label: "뇌",
    system: "nervous",
    defaultMeshName: "VH_O_brain",
    keywords: ["뇌경색", "뇌출혈", "뇌졸중", "뇌종양", "뇌암", "brain", "뇌"],
  },
  {
    key: "cervical_spine",
    label: "경추(목뼈)",
    system: "skeletal",
    defaultMeshName: "skeleton-cervical-vertebra",
    keywords: ["목디스크", "경추 디스크", "경추", "목뼈", "cervical"],
  },
  {
    key: "nervous",
    label: "신경계",
    system: "nervous",
    defaultMeshName: "nervous-system",
    keywords: ["신경계", "말초신경", "신경근", "척수신경", "nervous"],
  },
  {
    key: "knee",
    label: "무릎",
    system: "joints",
    defaultMeshName: "patella",
    keywords: ["무릎", "슬관절", "patella", "knee", "십자인대", "반월상"],
  },
  {
    key: "shoulder",
    label: "어깨",
    system: "joints",
    defaultMeshName: "clavicle",
    keywords: ["어깨", "견갑골", "오십견", "회전근개", "shoulder", "clavicle", "scapula"],
  },
  {
    key: "spine",
    label: "척추·허리",
    system: "skeletal",
    defaultMeshName: "skeleton-lumbar-vertebra",
    keywords: ["허리", "요추", "척추", "디스크", "요통", "spine", "lumbar", "vertebra", "등"],
  },
  {
    key: "scalp",
    label: "두개골·두피",
    system: "skeletal",
    defaultMeshName: "skeleton-cranium",
    keywords: ["두피", "두개골", "정수리", "머리", "두통", "scalp", "cranium", "head"],
  },
  {
    key: "jaw",
    label: "턱·악관절",
    system: "skeletal",
    defaultMeshName: "skeleton-mandible",
    keywords: ["턱", "악관절", "하악", "턱관절", "jaw", "mandible"],
  },
  {
    key: "hand",
    label: "손·손목",
    system: "skeletal",
    defaultMeshName: "skeleton-hand",
    keywords: ["손가락", "손목", "손바닥", "손", "hand", "wrist", "finger"],
  },
  {
    key: "foot",
    label: "발·발목",
    system: "skeletal",
    defaultMeshName: "skeleton-foot",
    keywords: ["발가락", "발목", "발바닥", "발", "foot", "ankle", "toe"],
  },
  {
    key: "pelvis",
    label: "골반·고관절",
    system: "skeletal",
    defaultMeshName: "skeleton-pelvis",
    keywords: ["골반", "고관절", "엉치", "엉덩이", "pelvis", "hip"],
  },
  {
    key: "thigh",
    label: "허벅지·대퇴",
    system: "skeletal",
    defaultMeshName: "femur",
    keywords: ["대퇴", "대퇴골", "허벅지", "thigh", "femur"],
  },
  {
    key: "nose",
    label: "코·비강",
    system: "skeletal",
    defaultMeshName: "nasal",
    keywords: ["코", "비골", "비강", "nasal", "nose", "septal"],
  },
];

function detectOrganFromText(text: string): OrganDefinition | undefined {
  const lower = text.toLowerCase();

  // 1글자 단어의 비장기적 접미/파생어 오탐 방지 (예: '간헐적 복통'의 '간', '어깨 부위'의 '위' 오탐 방지)
  const sanitized = lower
    .replace(/간헐[적|히]?/g, "")
    .replace(/(시간|기간|순간|공간|중간|야간|주간|월간|년간|인간|간격|사이)/g, "")
    .replace(/(부위[에|의|별|를|가|도]?|통증부위|환부|위험|위해|위치|위약|범위|지위|단위|상위|하위|포위|주위|분위기|가위|위쪽|위아래)/g, "")
    .replace(/(폐기|폐쇄|폐지)/g, "");

  // 더 길고 구체적인 키워드 우선 매칭
  let bestMatch: { organ: OrganDefinition; keywordLength: number } | undefined;

  for (const organ of SUPPORTED_ORGANS) {
    for (const kw of organ.keywords) {
      let isMatched = kw.length === 1
        ? new RegExp(`(?:^|[^가-힣a-z0-9])${kw}(?:가|이|는|은|에|도|를|을|의|로|으로|와|과|만|뿐)?(?=[^가-힣a-z0-9]|$)`, "i").test(sanitized)
        : sanitized.includes(kw);

      if (isMatched && kw === "pelvis" && sanitized.includes("renal")) {
        isMatched = false;
      }

      if (isMatched) {
        if (!bestMatch || kw.length > bestMatch.keywordLength) {
          bestMatch = { organ, keywordLength: kw.length };
        }
      }
    }
  }
  return bestMatch?.organ;
}

export function detectLateralityFromText(text: string): "left" | "right" | "both" | "unknown" {
  const lower = text.toLowerCase();
  const hasLeft = lower.includes("왼쪽") || lower.includes("좌측") || lower.includes("(좌)") || lower.includes("left");
  const hasRight = lower.includes("오른쪽") || lower.includes("우측") || lower.includes("(우)") || lower.includes("right");
  const hasBoth = lower.includes("양쪽") || lower.includes("양측") || lower.includes("(양)") || lower.includes("both") || lower.includes("bilateral");
  if (hasBoth || (hasLeft && hasRight)) return "both";
  if (hasLeft) return "left";
  if (hasRight) return "right";
  return "unknown";
}

export function detectAllOrgansFromText(text: string): OrganDefinition[] {
  const lower = text.toLowerCase();
  const sanitized = lower
    .replace(/간헐[적|히]?/g, "")
    .replace(/(시간|기간|순간|공간|중간|야간|주간|월간|년간|인간|간격|사이)/g, "")
    .replace(/(부위[에|의|별|를|가|도]?|통증부위|환부|위험|위해|위치|위약|범위|지위|단위|상위|하위|포위|주위|분위기|가위|위쪽|위아래)/g, "")
    .replace(/(폐기|폐쇄|폐지)/g, "");

  const matchedOrgans: OrganDefinition[] = [];
  for (const organ of SUPPORTED_ORGANS) {
    for (const kw of organ.keywords) {
      let isMatched = kw.length === 1
        ? new RegExp(`(?:^|[^가-힣a-z0-9])${kw}(?:가|이|는|은|에|도|를|을|의|로|으로|와|과|만|뿐)?(?=[^가-힣a-z0-9]|$)`, "i").test(sanitized)
        : sanitized.includes(kw);

      if (isMatched && kw === "pelvis" && sanitized.includes("renal")) {
        isMatched = false;
      }

      if (isMatched) {
        if (!matchedOrgans.some((o) => o.key === organ.key)) {
          matchedOrgans.push(organ);
        }
        break;
      }
    }
  }
  return matchedOrgans;
}

export interface ClauseFinding {
  organ: OrganDefinition;
  side: "left" | "right" | "midline" | "both" | "unknown";
  isNegated: boolean;
  clause: string;
}

export function extractClauseFindings(text: string): ClauseFinding[] {
  if (!text) return [];
  // 문장/절 분해 (마침표, 쉼표, 세미콜론, 줄바꿈, '그리고', '및')
  const clauses = text
    .split(/[,.;\n/+]|\s+및\s+|\s+그리고\s+/)
    .map((c) => c.trim())
    .filter(Boolean);

  const findings: ClauseFinding[] = [];
  const negationPattern = /(없음|아님|아니|배제|정상|안\s*아픔|이상\s*없음|통증\s*없음|저림\s*없음|음성)/;

  for (const clause of clauses) {
    const isNegated = negationPattern.test(clause);
    const side = detectLateralityFromText(clause);
    const organs = detectAllOrgansFromText(clause);

    for (const organ of organs) {
      findings.push({
        organ,
        side,
        isNegated,
        clause,
      });
    }
  }

  return findings;
}

const CANCER_SERIOUS_KEYWORDS = [
  "암", "전이", "악성종양", "악성 종양", "악성신생물", "말기암", "대장암", "간암", "폐암", "위암", "유방암", "췌장암", "신장암", "cancer", "carcinoma", "metastasis", "malignan",
];

function isSeriousCondition(text: string): boolean {
  const lower = text.toLowerCase();
  const hasCancer = CANCER_SERIOUS_KEYWORDS.some((kw) => lower.includes(kw));
  if (!hasCancer) return false;

  // 1. 원발암 자체가 확진/진단/치료/소견인 경우 긍정 판정 우선 확인
  const hasConfirmedCancer =
    /(?:간암|위암|대장암|폐암|유방암|췌장암|신장암|악성\s*종양|악성\s*신생물|말기암|cancer|carcinoma)\s*(?:확진|진단|판정|치료|수술|발견|소견|환자|투병)/.test(
      lower
    );

  // 2. 암 자체에 대한 명시적 부정문 검사 ('간암 아님', '암 배제', '종양 없음', '악성 아님', '암 정상', '음성')
  // 주의: [^\\w\\n]은 JS에서 한글 음절까지 매칭하므로 [\\s,.:;~-] 구두점/공백을 사용해야 단어 경계가 보존됨
  // 주의: '전이 없음'은 전이 여부의 부정일 뿐 원발암 진단을 취소하지 않음 (Astra 2차 반례 2)
  const isCancerNegated =
    /(?:암|악성|종양|신생물|cancer)[\s,.:;~-]{0,6}(?:아님|아니|배제|정상|없음|완치|음성)/.test(lower) ||
    /(?:아님|아니|배제|음성|정상|없음)[\s,.:;~-]{0,6}(?:암|악성|종양|신생물|cancer)/.test(lower) ||
    /(?:의심\s*배제|악성\s*아님)/.test(lower);

  if (hasConfirmedCancer && !isCancerNegated) {
    return true;
  }

  if (isCancerNegated) return false;

  // 3. 전이 단독 언급 시 전이 부정 여부 판별
  if (lower.includes("전이") || lower.includes("metastasis")) {
    const isMetastasisNegated = /(?:전이)[\s,.:;~-]{0,6}(?:아님|아니|배제|정상|없음|음성)/.test(lower);
    if (isMetastasisNegated) {
      // 전이는 없으나 일반 암 키워드가 있는 경우
      return hasConfirmedCancer;
    }
    return true;
  }

  return true;
}

export function matchesTimelineDate(observedAt: string, recordedAt: string, targetDate: string): boolean {
  if (observedAt.startsWith(targetDate) || recordedAt.startsWith(targetDate)) return true;
  const toLocalKey = (str: string) => {
    if (!str) return "";
    const d = new Date(str);
    if (Number.isNaN(d.getTime())) return str.slice(0, 10);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };
  return toLocalKey(observedAt) === targetDate || toLocalKey(recordedAt) === targetDate;
}

/**
 * 건강기록 목록으로부터 출처와 시점이 보존된 HealthEvent 목록을 추출합니다.
 */
export function extractHealthEvents(records: HealthRecord[]): HealthEvent[] {
  const events: HealthEvent[] = [];

  for (const r of records) {
    const payload = (r.payload || {}) as Record<string, unknown>;
    const recordedAt = r.recordedAt;
    const observedAt =
      (payload.observedAt as string) ||
      (payload.dateStr as string) ||
      (payload.onsetAt as string) ||
      recordedAt;

    // 1. 암/만성질환 등 진단 및 검진 기록 추출
    if (r.recordType === "health_screening" || r.recordType === "assessment" || r.recordType === "note") {
      const note = String(payload.note || (r as unknown as { note?: string }).note || "");
      const diagnosis = String(payload.diagnosis || "");
      const fullText = `${note} ${diagnosis}`.trim();

      const organ = detectOrganFromText(fullText);
      const isCancer = isSeriousCondition(fullText);

      if (organ || isCancer) {
        const isFamily = fullText.includes("아버지") || fullText.includes("가족") || fullText.includes("부모");
        const isSuspected = fullText.includes("의심") || fullText.includes("추정");
        const isNegated = fullText.includes("아님") || fullText.includes("정상") || fullText.includes("배제") || fullText.includes("음성");
        const isPast = fullText.includes("완치") || fullText.includes("과거") || fullText.includes("이전");

        const provenance = isFamily
          ? "family_history"
          : isNegated
          ? "negated"
          : isSuspected
          ? "suspected"
          : isPast
          ? "past_history"
          : r.sourceDocumentId
          ? "document_confirmed"
          : "user_report";

        const organLabel = organ?.label || (isCancer ? "신체 장기" : "임상 소견");
        const title = isFamily
          ? `가족력: ${organLabel}${isCancer ? "암" : " 질환"}`
          : isNegated
          ? `${organLabel} 질환 배제/음성 소견`
          : isCancer && fullText.includes("간암")
          ? "간암 진단 기록"
          : isCancer
          ? `${organLabel} 암/전이 판정 기록`
          : `${organLabel} 진단/검진 소견`;

        events.push({
          id: `diag-${organ?.key ?? "general"}-${r.id}`,
          profileId: r.profileId,
          category: "diagnosis",
          title,
          organKey: isFamily ? undefined : organ?.key,
          organLabel: isFamily ? undefined : organLabel,
          meshName: isFamily ? undefined : organ?.defaultMeshName,
          observedAt,
          recordedAt,
          provenance,
          sourceDocumentId: r.sourceDocumentId ?? undefined,
          sourceDocumentName: r.sourceDocumentId ? (payload.documentTitle as string) || "정밀 검진 결과지" : undefined,
          sourceSentence: note || (payload.summary as string) || fullText || "진단 기록",
          severityTone: isNegated ? "neutral" : isCancer ? "diagnosis_alert" : "warning",
          detailNote: isFamily
            ? "가족(직계) 병력으로 확인된 기록입니다. 본인의 장기 손상률과는 무관합니다."
            : isNegated
            ? "검진 서류 또는 소견상 해당 중증 질환이 배제되었거나 음성으로 확인된 기록입니다."
            : isCancer
            ? "중요 진단(암/전이) 기록이 연결된 장기입니다. 손상률이나 현재 응급도를 뜻하지 않습니다."
            : "검진 서류에 기재된 임상 소견입니다.",
        });
      } else if (r.recordType === "health_screening" || r.recordType === "assessment") {
        const title = r.recordType === "health_screening"
          ? String(payload.screeningName || "건강검진 종합 소견")
          : "건강 위험도 판정 결과";
        events.push({
          id: `exam-${r.id}`,
          profileId: r.profileId,
          category: "test",
          title,
          observedAt,
          recordedAt,
          provenance: r.sourceDocumentId ? "document_confirmed" : "user_report",
          sourceDocumentId: r.sourceDocumentId ?? undefined,
          sourceDocumentName: r.sourceDocumentId ? "건강검진 결과지" : undefined,
          sourceSentence: note || (payload.summary as string) || fullText || "검진 기록",
          severityTone: "neutral",
          detailNote: "건강검진 및 위험도 종합 평가 기록입니다.",
        });
      }
    }

    // 2. 통증 다이어리 및 해부학 이벤트 추출
    if (r.recordType === "pain") {
      const anatomy = payload.anatomyEvent as Record<string, unknown> | undefined;
      const concept = (anatomy?.concept || {}) as Record<string, unknown>;
      // 원본 사실(Fact)은 사용자가 입력한 bodyArea를 우선하고, AI 해석 라벨과 엄격 분리 (Astra 반례 4)
      const userBodyArea = (payload.bodyArea as string) || (concept.label as string) || "통증 부위";
      const inferredLabel = (concept.label as string) || "신경 및 근골격계";
      const sensation = (payload.sensation as string) || "";
      const noteStr = String(payload.note || "");

      // 필드 경계 오염 방지: 각 필드를 마침표와 개행으로 명확히 구분하여 절 분석 (Astra 반례 3)
      const textParts = [userBodyArea, sensation, noteStr].map((s) => s.trim()).filter(Boolean);
      const fullText = textParts.join(".\n");

      const anatomySide = (concept.side as string) || "";
      const detectedSide =
        anatomySide === "left" || anatomySide === "right" || anatomySide === "both"
          ? (anatomySide as "left" | "right" | "both")
          : detectLateralityFromText(fullText);

      const isSerious = isSeriousCondition(fullText);
      const recordIntensity = typeof payload.intensity === "number" ? payload.intensity : undefined;

      // AI Agent 임상 추론 (연관통 및 원인 해부학 구조 분석 결과)
      const isAiInferred =
        anatomy?.provenance === "clinical_ai_inferred" ||
        Boolean(payload.clinicalReasoning) ||
        (Array.isArray(payload.suspectedAnatomyIds) && (payload.suspectedAnatomyIds as string[]).length > 0);

      if (isAiInferred) {
        const suspectedIds = (payload.suspectedAnatomyIds as string[]) || (concept.canonicalConceptId ? [String(concept.canonicalConceptId)] : []);
        const reasoningText = String(payload.clinicalReasoning || anatomy?.uncertainty || anatomy?.clinicalReasoning || "");

        // 부위 ID가 실제로 있을 때만 연관통 추정 이벤트 생성 (경추 기본값 강제 주입 제거: concept.sourceMeshId 없으면 undefined)
        if (suspectedIds.length > 0) {
          const suspectedKey = suspectedIds.join(",");
          const eventTitle = `연관통 추정: ${inferredLabel} (${userBodyArea} 분석)`;

          events.push({
            id: `pain-inferred-${r.id}`,
            profileId: r.profileId,
            category: "symptom",
            title: eventTitle,
            organKey: suspectedKey,
            organLabel: inferredLabel,
            meshName: concept.sourceMeshId ? String(concept.sourceMeshId) : undefined,
            observedAt,
            recordedAt,
            provenance: "clinical_ai_inferred",
            sourceSentence: noteStr || sensation,
            severityTone: "warning",
            detailNote: reasoningText || "임상 AI Agent가 복합 증상을 분석하여 연관통으로 추론한 부위입니다.",
            intensity: recordIntensity,
          });
          // 주의: 사용자 원본 증상(Fact)도 묵살되지 않고 함께 유지되어야 하므로 continue 하지 않음 (Astra 반례 4)
        }
      }

      // 절(clause) 단위 다중 부위 및 부정문 추출
      const clauseFindings = extractClauseFindings(fullText);
      const negatedFindings = clauseFindings.filter((f) => f.isNegated);

      // 부정 대상을 장기 전체(shoulder)로 뭉뚱그리지 않고, 개별 관찰의 부위·측면성(laterality)에 맞추어 판별 (Astra 2차 반례 1)
      const isFindingNegated = (f: ClauseFinding) =>
        negatedFindings.some((nf) => {
          if (nf.organ.key !== f.organ.key) return false;
          // 부정문의 측면성이 불명이거나 양쪽인 경우 해당 장기 전체 부정
          if (nf.side === "unknown" || nf.side === "both") return true;
          // 구체적 측면성이 명시된 경우 동일한 측면성만 부정 ('오른쪽 어깨 없음'은 '왼쪽 어깨'를 부정하지 않음)
          return nf.side === f.side;
        });

      const activeFindings = clauseFindings.filter((f) => !f.isNegated && !isFindingNegated(f));

      // 장기 전체가 부정된 경우에만 matchedOrgans fallback에서 제외
      const wholeOrganNegatedKeys = new Set(
        negatedFindings
          .filter((nf) => nf.side === "unknown" || nf.side === "both")
          .map((nf) => nf.organ.key)
      );
      const matchedOrgans = detectAllOrgansFromText(fullText).filter((o) => !wholeOrganNegatedKeys.has(o.key));
      const organ = activeFindings[0]?.organ || matchedOrgans[0];

      const rawOrganKeys: string[] = [];

      // 3D 신체 상호작용 또는 3D 스프레이로 기록된 원본 메쉬 ID/개념 보존
      if (concept.sourceMeshId) {
        rawOrganKeys.push(String(concept.sourceMeshId));
      }
      if (concept.canonicalConceptId) {
        const baseKey = String(concept.canonicalConceptId);
        if (detectedSide === "left") rawOrganKeys.push(`left_${baseKey}`);
        else if (detectedSide === "right") rawOrganKeys.push(`right_${baseKey}`);
        else rawOrganKeys.push(baseKey);
      }

      if (activeFindings.length > 0) {
        activeFindings.forEach((f) => {
          if (f.side === "left") rawOrganKeys.push(`left_${f.organ.key}`);
          else if (f.side === "right") rawOrganKeys.push(`right_${f.organ.key}`);
          else rawOrganKeys.push(f.organ.key);
        });
      } else if (clauseFindings.length === 0 && wholeOrganNegatedKeys.size === 0) {
        // 부정문이 없고 절 분석도 감지되지 않은 순수 단문인 경우에만 fallback 허용
        if (matchedOrgans.length > 0) {
          matchedOrgans.forEach((o) => {
            if (detectedSide === "left") rawOrganKeys.push(`left_${o.key}`);
            else if (detectedSide === "right") rawOrganKeys.push(`right_${o.key}`);
            else rawOrganKeys.push(o.key);
          });
        } else if (concept.canonicalConceptId) {
          const baseKey = String(concept.canonicalConceptId);
          if (detectedSide === "left") rawOrganKeys.push(`left_${baseKey}`);
          else if (detectedSide === "right") rawOrganKeys.push(`right_${baseKey}`);
          else rawOrganKeys.push(baseKey);
        } else if (userBodyArea && userBodyArea !== "통증 부위") {
          if (detectedSide === "left") rawOrganKeys.push(`left_${userBodyArea}`);
          else if (detectedSide === "right") rawOrganKeys.push(`right_${userBodyArea}`);
          else rawOrganKeys.push(userBodyArea);
        }
      }

      // 구체적 측면성 키(left_X, right_X)가 존재할 때 모호한 비측면성 키(X) 억제 (Astra 반례 3)
      const hasLateralFor = (baseKey: string) =>
        rawOrganKeys.some((k) => k === `left_${baseKey}` || k === `right_${baseKey}`);

      const organKeys = rawOrganKeys.filter((k) => {
        if (k === "left" || k === "right") return false;
        const isBase = !k.startsWith("left_") && !k.startsWith("right_");
        if (isBase && hasLateralFor(k)) return false;
        return true;
      });

      if (organKeys.length === 0 && activeFindings.length === 0 && negatedFindings.length === 0) {
        if (detectedSide === "left") organKeys.push("left");
        else if (detectedSide === "right") organKeys.push("right");
      }

      // AI 추론 가설이 별도로 생성되더라도 사용자 원본 증상(Fact)의 organKey는 3D 연결을 위해 온전히 유지 (Astra 2차 반례 3)
      const organKey = organKeys.length > 0
        ? Array.from(new Set(organKeys)).join(",")
        : undefined;

      const isNegated = negatedFindings.length > 0 && activeFindings.length === 0;

      const organLabel = isSerious && organ && !isNegated
        ? `${organ.label} (${organ.label} 암/전이 판정)`
        : userBodyArea;

      const title = isSerious && organ && !isNegated
        ? `${organ.label} 암/전이 판정 기록`
        : isNegated
        ? `${organ ? organ.label : userBodyArea} 이상/통증 없음 소견`
        : organ && userBodyArea === organ.label
        ? `통증: ${organ.label}`
        : `통증: ${userBodyArea}`;

      const negatedNote = negatedFindings.length > 0
        ? ` (음성 확인: ${negatedFindings.map((nf) => nf.clause).join(", ")})`
        : "";

      events.push({
        id: `pain-${r.id}`,
        profileId: r.profileId,
        category: isSerious && !isNegated ? "diagnosis" : "symptom",
        title,
        organKey,
        organLabel,
        meshName: organ?.defaultMeshName || (concept.sourceMeshId as string | undefined),
        observedAt,
        recordedAt,
        provenance: "user_report",
        sourceSentence: noteStr || sensation,
        severityTone: isSerious && !isNegated ? "diagnosis_alert" : isNegated ? "neutral" : "warning",
        detailNote: isSerious && !isNegated
          ? `건강 다이어리에 기록된 중요 진단(암/전이) 연결 장기입니다. 손상률이나 현재 응급도를 뜻하지 않습니다.${negatedNote}`
          : isNegated
          ? `기록상 통증이나 이상 소견이 배제되었거나 없다고 확인된 부위입니다.${negatedNote}`
          : `사용자가 일일 건강기록(통증 다이어리)에 직접 기록한 부위와 증상입니다.${negatedNote}`,
        intensity: recordIntensity,
      });
    }

    // 3. 혈압/혈당/수치 측정
    if (r.recordType === "blood_pressure" || r.recordType === "blood_glucose") {
      const val = payload.systolic
        ? `${payload.systolic}/${payload.diastolic} mmHg`
        : payload.glucose
        ? `${payload.glucose} mg/dL`
        : "측정치";
      events.push({
        id: `test-${r.id}`,
        profileId: r.profileId,
        category: "test",
        title: r.recordType === "blood_pressure" ? `혈압: ${val}` : `혈당: ${val}`,
        observedAt,
        recordedAt,
        provenance: "user_report",
        sourceSentence: `측정 수치: ${val}`,
        severityTone: "neutral",
        detailNote: "일일 건강 지표 측정치입니다.",
      });
    }
  }

  return events.sort((a, b) => new Date(b.observedAt).getTime() - new Date(a.observedAt).getTime());
}

export function FamilyIntegratedMonitoring({
  profiles,
  selectedProfileId,
  onSelectProfile,
  records,
  onSelectOrgan,
}: FamilyIntegratedMonitoringProps) {
  const [activeTab, setActiveTab] = useState<MonitoringViewTab>("records");
  const [selectedEventId, setSelectedEventId] = useState<string>();
  const [dateOffsetDays, setDateOffsetDays] = useState(0);
  const [selectedDate, setSelectedDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [selectionVersion, setSelectionVersion] = useState<number>(0);

  // 날짜 범위: dateOffsetDays 기준 7일 동적 타임라인 블록
  const timelineDates = useMemo(() => {
    const dates: string[] = [];
    const base = new Date();
    base.setDate(base.getDate() + dateOffsetDays);
    for (let i = 6; i >= 0; i--) {
      const d = new Date(base);
      d.setDate(d.getDate() - i);
      dates.push(d.toISOString().slice(0, 10));
    }
    return dates;
  }, [dateOffsetDays]);

  const allEvents = useMemo(() => extractHealthEvents(records), [records]);

  // 현재 선택된 날짜 및 선택된 가족 구성원의 이벤트 목록
  const currentMemberDateEvents = useMemo(() => {
    const targetProfileId = selectedProfileId || profiles[0]?.id;
    return allEvents.filter(
      (e) =>
        e.profileId === targetProfileId &&
        matchesTimelineDate(e.observedAt, e.recordedAt, selectedDate),
    );
  }, [allEvents, selectedProfileId, profiles, selectedDate]);

  // 선택된 특정 이벤트 (우선순위: 명시적 selectedEventId -> 현재 날짜 이벤트 중 첫 번째 -> 전체 중 첫 번째)
  const selectedEvent = useMemo(() => {
    if (selectedEventId) {
      const found = allEvents.find((e) => e.id === selectedEventId);
      if (found) return found;
    }
    if (currentMemberDateEvents.length > 0) {
      return currentMemberDateEvents[0];
    }
    return undefined;
  }, [allEvents, selectedEventId, currentMemberDateEvents]);

  // 날짜 또는 구성원 변경 시 기본으로 전체 부위 동시 보기 모드 활성화
  useEffect(() => {
    setSelectedEventId(undefined);
  }, [selectedDate, selectedProfileId]);

  // 장기별 통증 강도 맵 생성 헬퍼 (진단 경고라고 임의로 10점/4점 주입하지 않으며, 미상 intensity는 0으로 왜곡하지 않고 실제 기록된 값만 보존)
  const buildOrganIntensityMap = (events: HealthEvent[]): Record<string, number> => {
    const map: Record<string, number> = {};
    events.forEach((ev) => {
      if (ev.organKey && typeof ev.intensity === "number") {
        const intVal = ev.intensity;
        ev.organKey.split(",").forEach((k) => {
          const trimmed = k.trim();
          if (trimmed) {
            map[trimmed] = typeof map[trimmed] === "number"
              ? Math.max(map[trimmed], intVal)
              : intVal;
          }
        });
      }
    });
    return map;
  };

  // 선택된 날짜의 모든 위험 장기를 3D 뷰어로 통보 (전체 표시 부위 집합과 상세 포커스 분리: Astra 2차 요구사항 5)
  useEffect(() => {
    if (!onSelectOrgan) return;
    const dateOrgans = currentMemberDateEvents.filter((ev) => ev.organKey);
    if (dateOrgans.length > 0) {
      const uniqueKeys = Array.from(new Set(dateOrgans.map((ev) => ev.organKey!)));
      const uniqueLabels = Array.from(new Set(dateOrgans.map((ev) => ev.organLabel!)));
      const organIntensityMap = buildOrganIntensityMap(dateOrgans);
      const hasIntensity = dateOrgans.some((ev) => typeof ev.intensity === "number");
      const maxIntensity = hasIntensity
        ? dateOrgans.reduce((max, ev) => (typeof ev.intensity === "number" ? Math.max(max, ev.intensity) : max), 0)
        : undefined;

      const specificEvent = selectedEventId ? dateOrgans.find((e) => e.id === selectedEventId) : undefined;
      const focusedOrganKey = specificEvent?.organKey;

      if (focusedOrganKey) {
        onSelectOrgan(
          uniqueKeys.join(","),
          uniqueLabels.join(", "),
          maxIntensity,
          Object.keys(organIntensityMap).length > 0 ? organIntensityMap : undefined,
          focusedOrganKey,
        );
      } else if (Object.keys(organIntensityMap).length > 0) {
        onSelectOrgan(
          uniqueKeys.join(","),
          uniqueLabels.join(", "),
          maxIntensity,
          organIntensityMap,
        );
      } else if (typeof maxIntensity === "number") {
        onSelectOrgan(uniqueKeys.join(","), uniqueLabels.join(", "), maxIntensity);
      } else {
        onSelectOrgan(uniqueKeys.join(","), uniqueLabels.join(", "));
      }
    } else {
      onSelectOrgan("", "");
    }
  }, [currentMemberDateEvents, selectedEventId, onSelectOrgan, selectionVersion]);

  return (
    <section className="family-monitoring-workspace" aria-labelledby="family-monitoring-heading">
      <div className="family-monitoring-header">
        <div>
          <h2 id="family-monitoring-heading">가족 건강 통합 모니터링</h2>
          <p className="monitoring-subtext">
            가족 구성원 전체의 관찰·기록 사실과 AI 추세를 한눈에 확인하고 타임라인 시점으로 재현합니다.
          </p>
        </div>

        {/* 1. 관찰·기록 뷰 vs 예측 뷰 분리 탭 */}
        <div className="monitoring-tabs" role="tablist" aria-label="모니터링 뷰 전환">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "records"}
            className={`monitoring-tab-btn ${activeTab === "records" ? "active-tab-records" : ""}`}
            onClick={() => setActiveTab("records")}
          >
            기록 기반 상태
            <span className="tab-badge">{allEvents.length}건</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "predictions"}
            className={`monitoring-tab-btn ${activeTab === "predictions" ? "active-tab-predictions" : ""}`}
            onClick={() => setActiveTab("predictions")}
          >
            예측·분석 뷰
            <span className="tab-badge prediction-badge">새 분석</span>
          </button>
        </div>
      </div>

      {/* 2. 가족별 타임블록라인 (Family TimeBlockLine) */}
      <div className="family-timeline-container">
        <div className="timeline-top-bar">
          <div className="timeline-legend">
            <span className="legend-item"><span className="legend-dot dot-diagnosis" /> 진단 기록 (빨강: 중요 진단 장기)</span>
            <span className="legend-item"><span className="legend-dot dot-pain" /> 통증/증상</span>
            <span className="legend-item"><span className="legend-dot dot-test" /> 검사/수치</span>
            <span className="legend-item"><span className="legend-dot dot-empty" /> 기록 없음 (정상 아님)</span>
          </div>

          <div className="timeline-nav-controls" role="group" aria-label="타임라인 날짜 이동">
            <button
              type="button"
              className="timeline-nav-btn"
              onClick={() => setDateOffsetDays((prev) => prev - 7)}
              title="과거 7일 이동"
            >
              ◀ 이전 7일
            </button>
            <button
              type="button"
              className={`timeline-nav-btn ${dateOffsetDays === 0 ? "active-nav" : ""}`}
              onClick={() => setDateOffsetDays(0)}
              title="최신 7일로 복귀"
            >
              오늘
            </button>
            <button
              type="button"
              className="timeline-nav-btn"
              disabled={dateOffsetDays >= 0}
              onClick={() => setDateOffsetDays((prev) => Math.min(prev + 7, 0))}
              title="다음 7일 이동"
            >
              다음 7일 ▶
            </button>
          </div>
        </div>

        <div className="timeline-grid">
          <div className="timeline-grid-header">
            <div className="timeline-member-col">가족 구성원</div>
            <div className="timeline-dates-row">
              {timelineDates.map((date) => (
                <div
                  key={date}
                  className={`timeline-date-cell ${date === selectedDate ? "selected-date-cell" : ""}`}
                  onClick={() => setSelectedDate(date)}
                >
                  <span>{date.slice(5)}</span>
                  {date === selectedDate ? <span className="active-dot" /> : null}
                </div>
              ))}
            </div>
          </div>

          {profiles.map((profile) => {
            const memberEvents = allEvents.filter((e) => e.profileId === profile.id);
            const isSelectedMember = profile.id === (selectedProfileId || profiles[0]?.id);

            return (
              <div
                key={profile.id}
                className={`timeline-member-row ${isSelectedMember ? "selected-member-row" : ""}`}
                onClick={() => {
                  if (profile.id !== selectedProfileId) {
                    onSelectProfile(profile.id);
                  }
                  const datesWithEvents = timelineDates.filter((d) =>
                    memberEvents.some((e) => matchesTimelineDate(e.observedAt, e.recordedAt, d)),
                  );
                  if (datesWithEvents.length > 0 && !datesWithEvents.includes(selectedDate)) {
                    setSelectedDate(datesWithEvents[datesWithEvents.length - 1]);
                  }
                  setSelectedEventId(undefined);
                  setSelectionVersion((v) => v + 1);
                }}
              >
                <div className="timeline-member-info">
                  <strong>{profile.displayName}</strong>
                  <span className="member-rel">({profile.relationship})</span>
                </div>

                <div className="timeline-blocks-row">
                  {timelineDates.map((date) => {
                    const dayEvents = memberEvents.filter((e) => matchesTimelineDate(e.observedAt, e.recordedAt, date));
                    const hasDiag = dayEvents.some((e) => e.category === "diagnosis");
                    const painEvents = dayEvents.filter((e) => e.category === "symptom");
                    const hasPain = painEvents.length > 0;
                    const hasTest = dayEvents.some((e) => e.category === "test");

                    let blockClass = "timeline-block-empty";
                    let blockStyle: React.CSSProperties | undefined = { backgroundColor: "#06b6d4" };

                    if (hasDiag) {
                      blockClass = "timeline-block-diag";
                      blockStyle = undefined;
                    } else if (hasPain) {
                      const maxPainInt = painEvents.reduce(
                        (max, ev) => (typeof ev.intensity === "number" ? Math.max(max, ev.intensity) : max),
                        0,
                      );
                      if (maxPainInt <= 0) {
                        blockClass = "timeline-block-pain timeline-block-pain-normal";
                        blockStyle = { backgroundColor: "#06b6d4" };
                      } else if (maxPainInt <= 2) {
                        blockClass = "timeline-block-pain timeline-block-pain-reassuring";
                        blockStyle = { backgroundColor: "#10b981" };
                      } else if (maxPainInt <= 4) {
                        blockClass = "timeline-block-pain timeline-block-pain-mild";
                        blockStyle = { backgroundColor: "#84cc16" };
                      } else if (maxPainInt <= 6) {
                        blockClass = "timeline-block-pain timeline-block-pain-moderate";
                        blockStyle = { backgroundColor: "#eab308" };
                      } else if (maxPainInt <= 8) {
                        blockClass = "timeline-block-pain timeline-block-pain-severe";
                        blockStyle = { backgroundColor: "#f97316" };
                      } else {
                        blockClass = "timeline-block-pain timeline-block-pain-extreme";
                        blockStyle = { backgroundColor: "#ef4444" };
                      }
                    } else if (hasTest) {
                      blockClass = "timeline-block-test";
                      blockStyle = undefined;
                    }

                    const isSelectedDate = isSelectedMember && date === selectedDate;

                    return (
                      <div
                        key={date}
                        className={`timeline-block ${blockClass} ${isSelectedDate ? "is-selected-block" : ""}`}
                        style={blockStyle}
                        title={
                          dayEvents.length > 0
                            ? `[${date}] ${profile.displayName}\n` +
                              dayEvents.map((e) => `• [${PROVENANCE_BADGES[e.provenance].label}] ${e.title}`).join("\n")
                            : `${date}: 기록 없음 (정상 아님)`
                        }
                        onClick={(e) => {
                          e.stopPropagation();
                          if (profile.id !== selectedProfileId) {
                            onSelectProfile(profile.id);
                          }
                          setSelectedDate(date);
                          setSelectedEventId(undefined);
                          setSelectionVersion((v) => v + 1);
                        }}
                      >
                        {dayEvents.length > 0 ? (
                          <span className="block-count">{dayEvents.length}</span>
                        ) : (
                          <span className="block-empty-mark" aria-hidden="true">·</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 3. 선택된 시점/사건의 상세 근거 패널 (Evidence & Provenance Panel) */}
      {selectedEvent ? (
        <div className="monitoring-detail-panel">
          <div className="detail-panel-header">
            <div>
              <span className={`provenance-badge badge-${PROVENANCE_BADGES[selectedEvent.provenance].tone}`}>
                {PROVENANCE_BADGES[selectedEvent.provenance].label}
              </span>
              <h3>{selectedEvent.title}</h3>
            </div>
            {selectedEvent.organLabel ? (
              <div className="organ-alert-tag">
                연결 장기: <strong>
                  {selectedEventId === undefined && currentMemberDateEvents.length > 1
                    ? Array.from(new Set(currentMemberDateEvents.map((e) => e.organLabel).filter(Boolean))).join(", ") + " (동시 투시 모드)"
                    : selectedEvent.organLabel}
                </strong>
                {selectedEventId === undefined && currentMemberDateEvents.length > 1 ? (
                  <small style={{ marginLeft: "8px", color: "#64748b" }}>
                    (각 통증 부위의 강도 색상이 3D 외피에 각각 반영됩니다)
                  </small>
                ) : typeof selectedEvent.intensity === "number" ? (
                  <span
                    className="intensity-pill"
                    style={{
                      backgroundColor: `${getIntensityColor(selectedEvent.intensity)}22`,
                      color: getIntensityTextColor(selectedEvent.intensity),
                      marginLeft: "8px",
                      padding: "2px 8px",
                      borderRadius: "12px",
                      fontWeight: 600,
                      fontSize: "0.8rem",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "4px",
                    }}
                  >
                    <span
                      className="tab-intensity-dot"
                      style={{ backgroundColor: getIntensityColor(selectedEvent.intensity) }}
                    />
                    통증 강도 {selectedEvent.intensity}점 ({getIntensityLabel(selectedEvent.intensity)})
                  </span>
                ) : (
                  <small>(중요 진단 기록이 연결된 장기이며, 손상률이나 응급도가 아닙니다)</small>
                )}
              </div>
            ) : null}
          </div>

          {/* 해당 날짜에 여러 건의 기록이 있을 때 선택 칩 목록 */}
          {currentMemberDateEvents.length > 1 ? (
            <div className="same-day-events-bar" role="tablist" aria-label="해당 날짜 기록 목록">
              <span className="same-day-label">{selectedDate} 기록 목록 ({currentMemberDateEvents.length}건):</span>
              <button
                type="button"
                className={`same-day-chip ${selectedEventId === undefined ? "active-chip" : ""}`}
                onClick={() => {
                  setSelectedEventId(undefined);
                }}
              >
                {(() => {
                  const dateOrgans = currentMemberDateEvents.filter((ev) => ev.organKey);
                  const uniqueLabels = Array.from(new Set(dateOrgans.map((ev) => ev.organLabel!).filter(Boolean)));
                  const hasLiverAndLung = uniqueLabels.some((l) => l.includes("간")) && uniqueLabels.some((l) => l.includes("폐"));
                  if (hasLiverAndLung) {
                    return "전체 위험 장기 동시 보기 (간 + 폐)";
                  }
                  return uniqueLabels.length > 0
                    ? `전체 기록 동시 보기 (${uniqueLabels.join(" + ")})`
                    : `전체 기록 동시 보기 (${currentMemberDateEvents.length}건 전체)`;
                })()}
              </button>
              {currentMemberDateEvents.map((ev) => {
                const int = ev.intensity;
                const hasInt = typeof int === "number";
                const isActive = selectedEventId === ev.id;
                return (
                  <button
                    key={ev.id}
                    type="button"
                    className={`same-day-chip ${isActive ? "active-chip" : ""}`}
                    onClick={() => {
                      setSelectedEventId(ev.id);
                    }}
                  >
                    {hasInt ? (
                      <span
                        className="tab-intensity-dot"
                        style={{ backgroundColor: getIntensityColor(int) }}
                      />
                    ) : null}
                    <span>{ev.title}</span>
                    {hasInt ? (
                      <span
                        className="tab-intensity-pill"
                        style={{ color: isActive ? "#ffffff" : undefined, marginLeft: "4px" }}
                      >
                        {int}점
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ) : null}

          <div className="detail-panel-body">
            <div className="detail-time-grid">
              <div className="time-item">
                <span className="time-label">실제 관찰·진료 시점</span>
                <strong className="time-val">{selectedEvent.observedAt.slice(0, 10)}</strong>
              </div>
              <div className="time-item">
                <span className="time-label">시스템 입력·확인 시점</span>
                <strong className="time-val">{selectedEvent.recordedAt.slice(0, 10)}</strong>
                {selectedEvent.observedAt.slice(0, 10) !== selectedEvent.recordedAt.slice(0, 10) ? (
                  <small className="delayed-input-note">(사후 입력 기록)</small>
                ) : null}
              </div>
              <div className="time-item">
                <span className="time-label">출처 분류</span>
                <span className="provenance-desc">{PROVENANCE_BADGES[selectedEvent.provenance].description}</span>
              </div>
            </div>

            {selectedEvent.sourceSentence ? (
              <div className="source-evidence-box">
                <span className="box-title">인용 원문 및 근거 내용</span>
                <p className="evidence-sentence">"{selectedEvent.sourceSentence}"</p>
                {selectedEvent.sourceDocumentName ? (
                  <span className="doc-provenance-link">출처 서류: {selectedEvent.sourceDocumentName}</span>
                ) : null}
              </div>
            ) : null}

            {selectedEvent.detailNote ? (
              <div className="monitoring-clinical-note">
                <strong>해석 안내:</strong> {selectedEvent.detailNote}
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="monitoring-empty-panel">
          <div className="empty-panel-icon" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
          </div>
          <div className="empty-panel-content">
            <h4>{selectedDate} 관찰 기록 없음</h4>
            <p>
              선택한 시점에는 해당 가족 구성원의 관찰·검진·진단 기록이 존재하지 않습니다.
              <br />
              <small>(※ 기록이 없다는 사실은 '정상'이나 '완치'를 의미하지 않으며, 단지 기록되지 않은 상태를 뜻합니다.)</small>
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
