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
    keywords: ["폐", "lung", "기관지", "흉막", "가슴 속"],
  },
  {
    key: "liver",
    label: "간",
    system: "digestive",
    defaultMeshName: "VH_O_liver",
    keywords: ["간", "liver", "간장", "간경변", "간기능"],
  },
  {
    key: "stomach",
    label: "위",
    system: "digestive",
    defaultMeshName: "VH_O_stomach",
    keywords: ["위", "stomach", "위염", "위궤양", "위식도"],
  },
  {
    key: "colon",
    label: "대장",
    system: "digestive",
    defaultMeshName: "VH_O_colon",
    keywords: ["대장", "colon", "결장", "직장", "대장염", "bowel"],
  },
  {
    key: "heart",
    label: "심장",
    system: "circulatory",
    defaultMeshName: "VH_O_heart",
    keywords: ["심장", "heart", "심근", "심혈관", "관상동맥", "부정맥"],
  },
  {
    key: "kidney",
    label: "신장",
    system: "urinary",
    defaultMeshName: "VH_O_kidney",
    keywords: ["신장", "콩팥", "kidney", "사구체", "신부전"],
  },
  {
    key: "pancreas",
    label: "췌장",
    system: "digestive",
    defaultMeshName: "VH_O_pancreas",
    keywords: ["췌장", "pancreas", "췌장염"],
  },
  {
    key: "gallbladder",
    label: "담낭",
    system: "digestive",
    defaultMeshName: "VH_O_gallbladder",
    keywords: ["담낭", "쓸개", "gallbladder", "담석"],
  },
  {
    key: "brain",
    label: "뇌",
    system: "nervous",
    defaultMeshName: "VH_O_brain",
    keywords: ["뇌", "brain", "뇌경색", "뇌출혈", "뇌졸중"],
  },
];

function detectOrganFromText(text: string): OrganDefinition | undefined {
  const lower = text.toLowerCase();
  for (const organ of SUPPORTED_ORGANS) {
    if (organ.keywords.some((kw) => lower.includes(kw))) {
      return organ;
    }
  }
  return undefined;
}

const CANCER_SERIOUS_KEYWORDS = [
  "암", "전이", "악성", "종양", "판정", "진단", "말기", "cancer", "carcinoma", "metastasis", "tumor",
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

  // 날짜 범위: 최근 7일 타임라인 블록
  const timelineDates = useMemo(() => {
    const dates: string[] = [];
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      dates.push(d.toISOString().slice(0, 10));
    }
    return dates;
  }, []);

  const allEvents = useMemo(() => extractHealthEvents(records), [records]);

  // 선택된 특정 이벤트
  const selectedEvent = useMemo(() => {
    if (!selectedEventId) {
      // 기본적으로 가장 최근 진단 또는 기록 선택
      return allEvents.find((e) => e.category === "diagnosis") || allEvents[0];
    }
    return allEvents.find((e) => e.id === selectedEventId);
  }, [allEvents, selectedEventId]);

  // 선택된 이벤트의 장기를 3D 뷰어로 통보
  useEffect(() => {
    if (selectedEvent?.organKey && onSelectOrgan) {
      onSelectOrgan(selectedEvent.organKey, selectedEvent.organLabel || "");
    }
  }, [selectedEvent?.organKey, selectedEvent?.organLabel, onSelectOrgan]);

  return (
    <section className="family-monitoring-workspace" aria-labelledby="family-monitoring-heading">
      <div className="family-monitoring-header">
        <div>
          <span className="monitoring-tag">XAIOps 기반 모니터링</span>
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
            📋 기록 기반 상태
            <span className="tab-badge">{allEvents.length}건</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "predictions"}
            className={`monitoring-tab-btn ${activeTab === "predictions" ? "active-tab-predictions" : ""}`}
            onClick={() => setActiveTab("predictions")}
          >
            🔮 예측·분석 뷰
            <span className="tab-badge prediction-badge">새 분석</span>
          </button>
        </div>
      </div>

      {/* 2. 가족별 타임블록라인 (Family TimeBlockLine) */}
      <div className="family-timeline-container">
        <div className="timeline-legend">
          <span className="legend-item"><span className="legend-dot dot-diagnosis" /> 진단 기록 (빨강: 중요 진단 연결 장기)</span>
          <span className="legend-item"><span className="legend-dot dot-pain" /> 통증/증상 보고</span>
          <span className="legend-item"><span className="legend-dot dot-test" /> 검사/수치</span>
          <span className="legend-item"><span className="legend-dot dot-empty" /> 기록 없음 (정상 아님)</span>
        </div>

        <div className="timeline-grid">
          <div className="timeline-grid-header">
            <div className="timeline-member-col">가족 구성원</div>
            <div className="timeline-dates-row">
              {timelineDates.map((date) => (
                <div key={date} className="timeline-date-cell">
                  {date.slice(5)}
                </div>
              ))}
            </div>
          </div>

          {profiles.map((profile) => {
            const memberEvents = allEvents.filter((e) => e.profileId === profile.id);
            const isSelected = profile.id === selectedProfileId;

            return (
              <div
                key={profile.id}
                className={`timeline-member-row ${isSelected ? "selected-member-row" : ""}`}
                onClick={() => onSelectProfile(profile.id)}
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

                    return (
                      <div
                        key={date}
                        className={`timeline-block ${blockClass}`}
                        title={
                          dayEvents.length > 0
                            ? dayEvents.map((e) => `[${PROVENANCE_BADGES[e.provenance].label}] ${e.title}`).join("\n")
                            : `${date}: 기록 없음 (정상 아님)`
                        }
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectProfile(profile.id);
                          if (dayEvents.length > 0) {
                            setSelectedEventId(dayEvents[0].id);
                            if (dayEvents[0].organKey && onSelectOrgan) {
                              onSelectOrgan(dayEvents[0].organKey, dayEvents[0].organLabel || "");
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
                <span className="organ-pin">📍</span>
                연결 장기: <strong>{selectedEvent.organLabel}</strong>
                <small>(빨간색 표시: 중요 진단 기록이 연결된 장기이며, 손상률이나 응급도가 아닙니다)</small>
              </div>
            ) : null}
          </div>

          <div className="detail-panel-body">
            <div className="detail-time-grid">
              <div className="time-item">
                <span className="time-label">실제 관찰·진료 시점</span>
                <strong className="time-val">{selectedEvent.observedAt.slice(0, 10)}</strong>
              </div>
              <div className="time-item">
                <span className="time-label">시스템 입력·확인 시점</span>
                <strong className="time-val">{selectedEvent.recordedAt.slice(0, 10)}</strong>
                {selectedEvent.observedAt !== selectedEvent.recordedAt ? (
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
                  <span className="doc-provenance-link">📄 출처 서류: {selectedEvent.sourceDocumentName}</span>
                ) : null}
              </div>
            ) : null}

            {selectedEvent.detailNote ? (
              <div className="monitoring-clinical-note">
                ℹ️ <strong>해석 안내:</strong> {selectedEvent.detailNote}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
