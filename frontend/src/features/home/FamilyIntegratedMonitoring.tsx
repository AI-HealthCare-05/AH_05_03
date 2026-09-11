import { useEffect, useMemo, useState } from "react";
import type { FamilyProfile, HealthRecord } from "../../shared/local/domainContracts";
import {
  type HealthEvent,
  type MonitoringViewTab,
  PROVENANCE_BADGES,
} from "./familyMonitoringContracts";

export interface FamilyIntegratedMonitoringProps {
  profiles: FamilyProfile[];
  selectedProfileId?: string;
  onSelectProfile: (profileId: string) => void;
  records: HealthRecord[];
  onSelectOrgan?: (organKey: string, label: string) => void;
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
    keywords: ["신장암", "신부전", "사구체", "콩팥", "신장", "kidney"],
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
      const isMatched = kw.length === 1
        ? new RegExp(`(?:^|[^가-힣a-z0-9])${kw}(?:가|이|는|은|에|도|를|을|의|로|으로|와|과|만|뿐)?(?=[^가-힣a-z0-9]|$)`, "i").test(sanitized)
        : sanitized.includes(kw);

      if (isMatched) {
        if (!bestMatch || kw.length > bestMatch.keywordLength) {
          bestMatch = { organ, keywordLength: kw.length };
        }
      }
    }
  }
  return bestMatch?.organ;
}

const CANCER_SERIOUS_KEYWORDS = [
  "암", "전이", "악성", "종양", "판정", "진단", "확진", "말기", "cancer", "carcinoma", "metastasis", "tumor",
];

function isSeriousCondition(text: string): boolean {
  const lower = text.toLowerCase();
  return CANCER_SERIOUS_KEYWORDS.some((kw) => lower.includes(kw));
}

/**
 * 건강기록 목록으로부터 출처와 시점이 보존된 HealthEvent 목록을 추출합니다.
 */
function extractHealthEvents(records: HealthRecord[]): HealthEvent[] {
  const events: HealthEvent[] = [];

  for (const r of records) {
    const payload = (r.payload || {}) as Record<string, unknown>;
    const recordedAt = r.recordedAt;
    const observedAt = (payload.observedAt as string) || (payload.dateStr as string) || recordedAt;

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
        const isNegated = fullText.includes("아님") || fullText.includes("정상") || fullText.includes("배제");
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

        const organLabel = organ?.label || "신체 장기";
        const title = isFamily
          ? `가족력: ${organLabel}${isCancer ? "암" : " 질환"}`
          : fullText.includes("간암")
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
          sourceDocumentName: r.sourceDocumentId ? `${organLabel} 정밀 검진 소견서` : undefined,
          sourceSentence: note || (payload.summary as string) || fullText || "진단 기록",
          severityTone: isNegated ? "neutral" : isCancer ? "diagnosis_alert" : "warning",
          detailNote: isFamily
            ? "가족(직계) 병력으로 확인된 기록입니다. 본인의 장기 손상률과는 무관합니다."
            : isCancer
            ? "중요 진단(암/전이) 기록이 연결된 장기입니다. 손상률이나 현재 응급도를 뜻하지 않습니다."
            : "검진 서류에 기재된 임상 소견입니다.",
        });
      }
    }

    // 2. 통증 다이어리 및 해부학 이벤트 추출
    if (r.recordType === "pain") {
      const anatomy = payload.anatomyEvent as Record<string, unknown> | undefined;
      const concept = (anatomy?.concept || {}) as Record<string, unknown>;
      const rawLabel = (concept.label as string) || (payload.bodyArea as string) || "통증 부위";
      const sensation = (payload.sensation as string) || (payload.note as string) || "통증";
      const noteStr = String(payload.note || "");
      const fullText = `${rawLabel} ${sensation} ${noteStr}`.trim();

      const organ = detectOrganFromText(fullText);
      const isSerious = isSeriousCondition(fullText);

      // AI Agent 임상 추론 (연관통 및 원인 해부학 구조 분석 결과) 우선 채택
      const isAiInferred =
        anatomy?.provenance === "clinical_ai_inferred" ||
        Boolean(payload.clinicalReasoning) ||
        (Array.isArray(payload.suspectedAnatomyIds) && (payload.suspectedAnatomyIds as string[]).length > 0);

      if (isAiInferred) {
        const suspectedIds = (payload.suspectedAnatomyIds as string[]) || (concept.canonicalConceptId ? [String(concept.canonicalConceptId)] : []);
        const suspectedKey = suspectedIds.length > 0 ? suspectedIds.join(",") : "cervical_spine,nervous";
        const reasoningText = String(payload.clinicalReasoning || anatomy?.uncertainty || anatomy?.clinicalReasoning || "");
        const eventTitle = `연관통 추정: ${concept.label || "경추 및 신경계"} (${rawLabel} 분석)`;

        events.push({
          id: `pain-inferred-${r.id}`,
          profileId: r.profileId,
          category: "symptom",
          title: eventTitle,
          organKey: suspectedKey,
          organLabel: String(concept.label || "경추 및 신경계"),
          meshName: String(concept.sourceMeshId || "skeleton-cervical-vertebra"),
          observedAt,
          recordedAt,
          provenance: "clinical_ai_inferred",
          sourceSentence: noteStr || sensation,
          severityTone: "warning",
          detailNote: reasoningText || "임상 AI Agent가 복합 증상(상지 저림·악력 저하·하지 위약감)을 분석하여 경추 신경근 연관통으로 추론한 부위입니다.",
        });
        continue;
      }

      const organKey = organ?.key;
      const organLabel = organ
        ? isSerious
          ? `${organ.label} (${organ.label} 암/전이 판정)`
          : `${organ.label} (통증)`
        : rawLabel;
      const meshName = organ?.defaultMeshName || (concept.sourceMeshId as string | undefined);

      events.push({
        id: `pain-${r.id}`,
        profileId: r.profileId,
        category: isSerious ? "diagnosis" : "symptom",
        title: isSerious
          ? `${organ?.label ?? "부위"} 암/전이 판정 기록`
          : organ
          ? `통증: ${organ.label} (${rawLabel})`
          : `통증: ${rawLabel}`,
        organKey,
        organLabel,
        meshName,
        observedAt,
        recordedAt,
        provenance: "user_report",
        sourceSentence: noteStr || sensation,
        severityTone: isSerious ? "diagnosis_alert" : "warning",
        detailNote: isSerious
          ? "건강 다이어리에 기록된 중요 진단(암/전이) 연결 장기입니다. 손상률이나 현재 응급도를 뜻하지 않습니다."
          : "사용자가 일일 건강기록(통증 다이어리)에 직접 기록한 부위와 증상입니다.",
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
        (e.observedAt.startsWith(selectedDate) || e.recordedAt.startsWith(selectedDate)),
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

  // 선택된 날짜의 모든 위험 장기를 3D 뷰어로 통보 (단일 이벤트 선택 시 해당 장기, 기본은 해당 날짜의 모든 위험 장기 동시 발광)
  useEffect(() => {
    if (!onSelectOrgan) return;
    const dateOrgans = currentMemberDateEvents.filter((ev) => ev.organKey);
    if (dateOrgans.length > 0) {
      if (selectedEventId) {
        const specificEvent = dateOrgans.find((e) => e.id === selectedEventId);
        if (specificEvent?.organKey) {
          onSelectOrgan(specificEvent.organKey, specificEvent.organLabel || "");
          return;
        }
      }
      const uniqueKeys = Array.from(new Set(dateOrgans.map((ev) => ev.organKey!)));
      const uniqueLabels = Array.from(new Set(dateOrgans.map((ev) => ev.organLabel!)));
      onSelectOrgan(uniqueKeys.join(","), uniqueLabels.join(", "));
    } else {
      onSelectOrgan("", "");
    }
  }, [currentMemberDateEvents, selectedEventId, onSelectOrgan]);

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
                  onSelectProfile(profile.id);
                }}
              >
                <div className="timeline-member-info">
                  <strong>{profile.displayName}</strong>
                  <span className="member-rel">({profile.relationship})</span>
                </div>

                <div className="timeline-blocks-row">
                  {timelineDates.map((date) => {
                    const dayEvents = memberEvents.filter((e) => e.observedAt.startsWith(date) || e.recordedAt.startsWith(date));
                    const hasDiag = dayEvents.some((e) => e.category === "diagnosis");
                    const hasPain = dayEvents.some((e) => e.category === "symptom");
                    const hasTest = dayEvents.some((e) => e.category === "test");

                    let blockClass = "timeline-block-empty";
                    if (hasDiag) blockClass = "timeline-block-diag";
                    else if (hasPain) blockClass = "timeline-block-pain";
                    else if (hasTest) blockClass = "timeline-block-test";

                    const isSelectedDate = isSelectedMember && date === selectedDate;

                    return (
                      <div
                        key={date}
                        className={`timeline-block ${blockClass} ${isSelectedDate ? "is-selected-block" : ""}`}
                        title={
                          dayEvents.length > 0
                            ? `[${date}] ${profile.displayName}\n` +
                              dayEvents.map((e) => `• [${PROVENANCE_BADGES[e.provenance].label}] ${e.title}`).join("\n")
                            : `${date}: 기록 없음 (정상 아님)`
                        }
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectProfile(profile.id);
                          setSelectedDate(date);
                          if (dayEvents.length > 0) {
                            if (dayEvents.length > 1) {
                              setSelectedEventId(undefined);
                              const dayOrgans = dayEvents.filter((ev) => Boolean(ev.organKey));
                              const keys = Array.from(new Set(dayOrgans.map((ev) => ev.organKey!)));
                              const labels = Array.from(new Set(dayOrgans.map((ev) => ev.organLabel!).filter(Boolean)));
                              if (keys.length > 0 && onSelectOrgan) {
                                onSelectOrgan(keys.join(","), labels.join(", "));
                              }
                            } else {
                              setSelectedEventId(dayEvents[0].id);
                              if (dayEvents[0].organKey && onSelectOrgan) {
                                onSelectOrgan(dayEvents[0].organKey, dayEvents[0].organLabel || "");
                              }
                            }
                          } else {
                            setSelectedEventId(undefined);
                            if (onSelectOrgan) {
                              onSelectOrgan("", "");
                            }
                          }
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
                <small>(빨간색 표시: 중요 진단 기록이 연결된 장기이며, 손상률이나 응급도가 아닙니다)</small>
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
                  const dateOrgans = currentMemberDateEvents.filter((ev) => ev.organKey);
                  const uniqueKeys = Array.from(new Set(dateOrgans.map((ev) => ev.organKey!)));
                  const uniqueLabels = Array.from(new Set(dateOrgans.map((ev) => ev.organLabel!).filter(Boolean)));
                  if (uniqueKeys.length > 0 && onSelectOrgan) {
                    onSelectOrgan(uniqueKeys.join(","), uniqueLabels.join(", "));
                  }
                }}
              >
                전체 위험 장기 동시 보기 (간 + 폐)
              </button>
              {currentMemberDateEvents.map((ev) => (
                <button
                  key={ev.id}
                  type="button"
                  className={`same-day-chip ${selectedEventId === ev.id ? "active-chip" : ""}`}
                  onClick={() => {
                    setSelectedEventId(ev.id);
                    if (ev.organKey && onSelectOrgan) {
                      onSelectOrgan(ev.organKey, ev.organLabel || "");
                    } else if (onSelectOrgan) {
                      onSelectOrgan("", "");
                    }
                  }}
                >
                  {ev.title}
                </button>
              ))}
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
