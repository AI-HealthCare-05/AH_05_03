import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { useLocalDomain } from "../../app/localDomainContext";
import type { HealthRecord } from "../../shared/local/domainContracts";
import { FamilyProfileSidebar } from "../family/FamilyProfileSidebar";
import { PRIMARY_HOUSEHOLD_ID } from "../health-assistant/healthAssistantLogic";
import { sendHealthAssistantMessage } from "../health-assistant/healthAssistantClient";

interface PainPayload {
  type?: string;
  bodyArea?: string;
  intensity?: number;
  sensation?: string;
  aggravatingFactors?: string;
  note?: string;
  onsetAt?: string;
}

function formatDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getIntensityColor(intensity: number): string {
  if (intensity <= 3) return "#10b981"; // 경미 (초록)
  if (intensity <= 6) return "#f59e0b"; // 보통 (주황)
  return "#ef4444"; // 심함 (빨강)
}

function getIntensityLabel(intensity: number): string {
  if (intensity <= 3) return "경미한 통증";
  if (intensity <= 6) return "보통 통증";
  return "심한 통증";
}

export function PainDiaryPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { runtime, profiles, loading: domainLoading } = useLocalDomain();

  const [selectedProfileId, setSelectedProfileId] = useState("");
  const selectedProfile = profiles.find((p) => p.id === selectedProfileId) ?? profiles[0];

  // 쿼리 파라미터로 date가 오면 우선 사용, 없으면 오늘 날짜
  const todayKey = useMemo(() => formatDateKey(new Date()), []);
  const initialDate = searchParams.get("date") || todayKey;
  const [selectedDate, setSelectedDate] = useState<string>(initialDate);

  // 캘린더 표시용 연/월
  const [calendarMonth, setCalendarMonth] = useState<Date>(() => {
    const d = new Date(initialDate);
    return isNaN(d.getTime()) ? new Date() : new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const [records, setRecords] = useState<HealthRecord[]>([]);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [aiRefining, setAiRefining] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState<string>();
  const [error, setError] = useState<string>();

  // 폼 입력 상태
  const [bodyArea, setBodyArea] = useState("");
  const [intensity, setIntensity] = useState<number>(5);
  const [sensation, setSensation] = useState("");
  const [aggravatingFactors, setAggravatingFactors] = useState("");
  const [note, setNote] = useState("");
  const [currentRecord, setCurrentRecord] = useState<HealthRecord | null>(null);

  // 프로필 초기 선택
  useEffect(() => {
    if (selectedProfile && selectedProfile.id !== selectedProfileId) {
      setSelectedProfileId(selectedProfile.id);
    }
  }, [selectedProfile, selectedProfileId]);

  // 기록 불러오기
  const loadRecords = useCallback(async () => {
    if (!runtime || !selectedProfile) return;
    setRecordsLoading(true);
    try {
      const result = await runtime.healthRecords.query({
        profileId: selectedProfile.id,
        recordTypes: ["pain"],
        includeDeleted: false,
      });
      if (!result.ok) throw new Error(result.error.message);
      setRecords(result.value.filter((r) => !r.deletedAt));
      setError(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "통증 다이어리 기록을 불러오지 못했습니다.");
    } finally {
      setRecordsLoading(false);
    }
  }, [runtime, selectedProfile]);

  useEffect(() => {
    void loadRecords();
  }, [loadRecords]);

  // 날짜별 통증 기록 매핑 (YYYY-MM-DD -> HealthRecord[])
  const recordsByDate = useMemo(() => {
    const map = new Map<string, HealthRecord[]>();
    for (const rec of records) {
      const key = rec.recordedAt.slice(0, 10);
      const list = map.get(key) ?? [];
      list.push(rec);
      map.set(key, list);
    }
    return map;
  }, [records]);

  // 선택된 날짜의 전체 기록 목록
  const dayRecords = useMemo(
    () => recordsByDate.get(selectedDate) ?? [],
    [recordsByDate, selectedDate],
  );

  // 현재 편집 중인 기록 ID ("__NEW__"이면 새 기록 추가 모드, null이면 기본 자동선택)
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);

  // 선택된 날짜 또는 기록 ID 변경 시 폼 상태 동기화
  useEffect(() => {
    if (selectedRecordId === "__NEW__") {
      setCurrentRecord(null);
      setBodyArea("");
      setIntensity(5);
      setSensation("");
      setAggravatingFactors("");
      setNote("");
      return;
    }

    const matched = selectedRecordId
      ? dayRecords.find((r) => r.id === selectedRecordId)
      : null;
    const targetRecord = matched ?? dayRecords[0] ?? null;

    if (targetRecord) {
      const payload = (targetRecord.payload ?? {}) as PainPayload;
      setCurrentRecord(targetRecord);
      setSelectedRecordId(targetRecord.id);
      setBodyArea(payload.bodyArea || "");
      setIntensity(typeof payload.intensity === "number" ? payload.intensity : 5);
      setSensation(payload.sensation || "");
      setAggravatingFactors(payload.aggravatingFactors || "");
      setNote(payload.note || "");
    } else {
      setCurrentRecord(null);
      setSelectedRecordId(null);
      setBodyArea("");
      setIntensity(5);
      setSensation("");
      setAggravatingFactors("");
      setNote("");
    }
  }, [selectedDate, dayRecords, selectedRecordId]);

  // 특정 기록 선택
  const handleSelectRecord = (rec: HealthRecord) => {
    setSelectedRecordId(rec.id);
    setFeedbackMessage(undefined);
    setError(undefined);
  };

  // 해당 일자에 새 기록 작성 시작
  const handleStartNewRecord = () => {
    setSelectedRecordId("__NEW__");
    setFeedbackMessage(undefined);
    setError(undefined);
  };

  // 날짜 선택 핸들러
  const handleSelectDate = (dateKey: string) => {
    setFeedbackMessage(undefined);
    setError(undefined);
    setSelectedRecordId(null);
    setSelectedDate(dateKey);
    setSearchParams({ date: dateKey });
  };

  // 캘린더 월 이동
  const handlePrevMonth = () => {
    setCalendarMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
  };
  const handleNextMonth = () => {
    setCalendarMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
  };
  const handleGoToday = () => {
    const today = new Date();
    setCalendarMonth(new Date(today.getFullYear(), today.getMonth(), 1));
    handleSelectDate(todayKey);
  };

  // AI 맞춤법 교정 및 문장 정제 툴 호출
  const handleAiRefine = async () => {
    if (!note && !bodyArea) {
      setError("AI 정제를 위해 먼저 통증 내용이나 메모를 간략히 입력해 주세요.");
      return;
    }
    setAiRefining(true);
    setError(undefined);
    setFeedbackMessage(undefined);

    try {
      const prompt = `통증일기. 날짜: ${selectedDate}. 부위: ${bodyArea || "미정"}. 강도: ${intensity}/10. 양상: ${sensation}. 악화요인: ${aggravatingFactors}. 상세: ${note}`;
      const res = await sendHealthAssistantMessage(
        [{ role: "user", content: prompt }],
        {
          profile_name: selectedProfile?.displayName || "사용자",
          relationship: selectedProfile?.relationship,
          birth_year: selectedProfile?.birthDate
            ? new Date(selectedProfile.birthDate).getFullYear()
            : undefined,
        },
      );

      if (res.pain_diary_tool) {
        const tool = res.pain_diary_tool;
        if (tool.formatted_diary) setNote(tool.formatted_diary);
        if (tool.body_area) setBodyArea(tool.body_area);
        if (typeof tool.intensity === "number") setIntensity(tool.intensity);
        if (tool.sensation) setSensation(tool.sensation);
        if (tool.aggravating_factors) setAggravatingFactors(tool.aggravating_factors);
        setFeedbackMessage("✨ AI가 맞춤법을 교정하고 품질 좋은 구조적 문장으로 정제했습니다.");
      } else {
        setFeedbackMessage("AI 문장 정제가 완료되었습니다.");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "AI 문장 정제에 실패했습니다.");
    } finally {
      setAiRefining(false);
    }
  };

  // 다이어리 저장 또는 수정
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!runtime || !selectedProfile) return;
    if (!bodyArea.trim()) {
      setError("통증 부위를 입력해 주세요.");
      return;
    }

    setSubmitting(true);
    setError(undefined);
    setFeedbackMessage(undefined);

    try {
      if (currentRecord) {
        // 기존 기록 수정
        const updateRes = await runtime.healthRecords.update(currentRecord.id, {
          recordType: "pain",
          recordedAt: currentRecord.recordedAt,
          payload: {
            type: "pain",
            bodyArea: bodyArea.trim(),
            intensity,
            sensation: sensation.trim() || undefined,
            aggravatingFactors: aggravatingFactors.trim() || undefined,
            note: note.trim() || undefined,
          },
          expectedVersion: currentRecord.version,
        });
        if (!updateRes.ok) throw new Error(updateRes.error.message);
        setFeedbackMessage("통증 다이어리 기록이 수정되었습니다.");
        setSelectedRecordId(currentRecord.id);
      } else {
        // 신규 기록 등록
        const createRes = await runtime.healthRecords.create({
          householdId: PRIMARY_HOUSEHOLD_ID,
          profileId: selectedProfile.id,
          recordType: "pain",
          recordedAt: new Date(`${selectedDate}T12:00:00`).toISOString(),
          source: "manual",
          payload: {
            type: "pain",
            bodyArea: bodyArea.trim(),
            intensity,
            sensation: sensation.trim() || undefined,
            aggravatingFactors: aggravatingFactors.trim() || undefined,
            note: note.trim() || undefined,
          },
        });
        if (!createRes.ok) throw new Error(createRes.error.message);
        setFeedbackMessage("통증 다이어리 기록이 안전하게 저장되었습니다.");
        setSelectedRecordId(createRes.value.id);
      }
      await loadRecords();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "통증 다이어리 저장에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  // 기록 삭제
  const handleDelete = async () => {
    if (!runtime || !currentRecord) return;
    if (!window.confirm("이 통증 기록을 삭제하시겠습니까?")) return;

    setSubmitting(true);
    try {
      const delRes = await runtime.healthRecords.softDelete(currentRecord.id, currentRecord.version);
      if (!delRes.ok) throw new Error(delRes.error.message);
      setFeedbackMessage("통증 기록이 삭제되었습니다.");
      setSelectedRecordId(null);
      await loadRecords();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "기록 삭제에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  // 캘린더 날짜 그리드 계산
  const calendarDays = useMemo(() => {
    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();

    const firstDayIndex = new Date(year, month, 1).getDay(); // 0(일) ~ 6(토)
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const cells: Array<{
      dateKey: string;
      dayNum: number;
      isCurrentMonth: boolean;
      records: HealthRecord[];
      maxIntensity?: number;
    }> = [];

    // 이전 달 빈 칸
    for (let i = 0; i < firstDayIndex; i++) {
      cells.push({
        dateKey: `prev-${i}`,
        dayNum: 0,
        isCurrentMonth: false,
        records: [],
      });
    }

    // 이번 달 날짜들
    for (let day = 1; day <= daysInMonth; day++) {
      const dateKey = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const recs = recordsByDate.get(dateKey) ?? [];
      const intensities = recs.map((r) => ((r.payload as PainPayload)?.intensity ?? 5));
      const maxIntensity = intensities.length > 0 ? Math.max(...intensities) : undefined;
      cells.push({
        dateKey,
        dayNum: day,
        isCurrentMonth: true,
        records: recs,
        maxIntensity,
      });
    }

    return cells;
  }, [calendarMonth, recordsByDate]);

  return (
    <div className="page-shell pain-diary-page">
      <FamilyProfileSidebar
        profiles={profiles}
        selectedProfileId={selectedProfileId}
        onSelect={setSelectedProfileId}
      />

      <main className="pain-diary-main">
        <header className="page-header pain-diary-header">
          <div>
            <p className="eyebrow">가족 건강 관리</p>
            <h1>통증 다이어리</h1>
            <p className="subtext">
              매일 통증 부위와 강도, 양상을 기록하고 AI 교정으로 문장을 깔끔하게 정리해 보세요.
            </p>
          </div>
        </header>

        {domainLoading && <div className="route-loading">가족 정보를 불러오는 중…</div>}
        {recordsLoading && <div className="route-loading">통증 기록을 불러오는 중…</div>}

        {error && <div className="error-alert" role="alert">{error}</div>}
        {feedbackMessage && <div className="success-alert" role="status">{feedbackMessage}</div>}

        {!domainLoading && profiles.length === 0 && (
          <div className="empty-profile-alert" role="alert">
            <p><strong>가족 구성원이 등록되어 있지 않습니다.</strong></p>
            <p>통증 다이어리를 기록하려면 먼저 가족 홈에서 구성원 프로필을 등록해 주세요.</p>
            <a href="/" className="button button-primary">가족 등록하러 가기</a>
          </div>
        )}

        <div className="pain-diary-layout">
          {/* 좌측: 일기 작성 / 수정 폼 */}
          <section className="pain-diary-form-card" aria-label="통증 다이어리 작성 및 수정">
            <div className="card-header">
              <div className="title-row">
                <h2>{selectedDate === todayKey ? "오늘의 통증 다이어리" : `${selectedDate} 통증 기록`}</h2>
                <span className={`status-tag ${currentRecord ? "is-edit" : "is-new"}`}>
                  {currentRecord ? "선택한 기록 수정 중" : "새 기록 작성 중"}
                </span>
              </div>

              {/* 같은 날짜에 등록된 기록 목록 탭 */}
              {dayRecords.length > 0 && (
                <div className="day-records-tabs" role="tablist" aria-label="해당 일자 통증 기록 목록">
                  {dayRecords.map((r, idx) => {
                    const p = (r.payload ?? {}) as PainPayload;
                    const isSelected = currentRecord?.id === r.id;
                    const int = typeof p.intensity === "number" ? p.intensity : 5;
                    return (
                      <button
                        key={r.id}
                        type="button"
                        role="tab"
                        aria-selected={isSelected}
                        className={`day-record-tab ${isSelected ? "is-active" : ""}`}
                        onClick={() => handleSelectRecord(r)}
                      >
                        <span
                          className="tab-intensity-dot"
                          style={{ backgroundColor: getIntensityColor(int) }}
                        />
                        <span className="tab-title">{p.bodyArea || `기록 ${idx + 1}`}</span>
                        <span className="tab-intensity-pill">{int}점</span>
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    className={`day-record-tab add-tab ${selectedRecordId === "__NEW__" || !currentRecord ? "is-active" : ""}`}
                    onClick={handleStartNewRecord}
                  >
                    + 새 기록 추가
                  </button>
                </div>
              )}

              <p className="date-hint">캘린더의 일자를 클릭하면 해당 날짜의 일기들을 열람하고 개별 수정하거나 새로 추가할 수 있습니다.</p>
            </div>

            <form onSubmit={handleSubmit} className="diary-form">
              <div className="form-group-row">
                <label className="form-group flex-1">
                  <span>기록 날짜</span>
                  <input
                    type="date"
                    value={selectedDate}
                    onChange={(e) => handleSelectDate(e.target.value)}
                    required
                  />
                </label>

                <label className="form-group flex-2">
                  <span>통증 부위 *</span>
                  <input
                    type="text"
                    placeholder="예: 오른쪽 무릎, 허리 아래쪽, 목 뒷덜미"
                    value={bodyArea}
                    onChange={(e) => setBodyArea(e.target.value)}
                    required
                  />
                </label>
              </div>

              <div className="form-group">
                <div className="intensity-header">
                  <span>통증 강도 (0 ~ 10): <strong>{intensity}점</strong></span>
                  <span
                    className="intensity-pill"
                    style={{ backgroundColor: `${getIntensityColor(intensity)}22`, color: getIntensityColor(intensity) }}
                  >
                    {getIntensityLabel(intensity)}
                  </span>
                </div>
                <div className="slider-wrapper">
                  <span className="slider-min">0 (통증 없음)</span>
                  <input
                    type="range"
                    min="0"
                    max="10"
                    step="1"
                    value={intensity}
                    onChange={(e) => setIntensity(Number(e.target.value))}
                    className="intensity-slider"
                  />
                  <span className="slider-max">10 (극심한 통증)</span>
                </div>
              </div>

              <div className="form-group-row">
                <label className="form-group flex-1">
                  <span>통증 양상</span>
                  <input
                    type="text"
                    placeholder="예: 욱신거림, 찌르는 듯함, 묵직한 이물감"
                    value={sensation}
                    onChange={(e) => setSensation(e.target.value)}
                  />
                </label>

                <label className="form-group flex-1">
                  <span>심해지는 상황 / 시작 상황</span>
                  <input
                    type="text"
                    placeholder="예: 웨이트 운동 후, 장시간 앉아 있을 때, 계단 오를 때"
                    value={aggravatingFactors}
                    onChange={(e) => setAggravatingFactors(e.target.value)}
                  />
                </label>
              </div>

              <div className="form-group">
                <div className="diary-note-header">
                  <span>통증 일기 상세 본문</span>
                  <button
                    type="button"
                    className="button button-outline ai-refine-btn"
                    onClick={handleAiRefine}
                    disabled={aiRefining}
                    title="챗봇 AI 도구로 맞춤법을 맞추고 구조적 문장으로 자동 변환합니다"
                  >
                    {aiRefining ? "AI 교정 중…" : "✨ AI 맞춤법 및 문장 정제"}
                  </button>
                </div>
                <textarea
                  rows={6}
                  placeholder="통증의 증상이나 불편함을 자유롭게 적어보세요.&#10;예: '웨이트한후에 팔꿈치가 아프다. 왼쪽 고관절에 이물감이 있고 왼쪽발 바닥을 딛는 힘이 약한 것 같아.'&#10;우측 상단 'AI 맞춤법 및 문장 정제'를 누르면 문장이 깔끔하게 교정됩니다."
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>

              <div className="diary-form-actions">
                <button
                  type="submit"
                  className="button button-primary save-btn"
                  disabled={submitting}
                >
                  {submitting ? "저장 중…" : currentRecord ? "기록 수정 완료" : "오늘의 다이어리 저장"}
                </button>

                {currentRecord && (
                  <button
                    type="button"
                    className="button button-danger delete-btn"
                    onClick={handleDelete}
                    disabled={submitting}
                  >
                    기록 삭제
                  </button>
                )}
              </div>
            </form>
          </section>

          {/* 우측 사이드: 상단 요약 카드 + 우측 하단 캘린더 */}
          <aside className="pain-diary-sidebar" aria-label="통증 달력 및 통계">
            {/* 최근 통증 요약 카드 */}
            <section className="diary-summary-card">
              <h3>최근 통증 요약</h3>
              {records.length === 0 ? (
                <p className="empty-hint">등록된 통증 기록이 없습니다.</p>
              ) : (
                <div className="summary-list">
                  {records.slice(0, 3).map((r) => {
                    const p = (r.payload ?? {}) as PainPayload;
                    const date = r.recordedAt.slice(0, 10);
                    return (
                      <button
                        key={r.id}
                        type="button"
                        className={`summary-item ${r.id === currentRecord?.id ? "is-selected" : ""}`}
                        onClick={() => {
                          handleSelectDate(date);
                          setSelectedRecordId(r.id);
                        }}
                      >
                        <div className="summary-item-header">
                          <strong>{p.bodyArea || "통증"}</strong>
                          <span className="summary-date">{date}</span>
                        </div>
                        <div className="summary-item-meta">
                          <span
                            className="summary-intensity"
                            style={{ color: getIntensityColor(p.intensity ?? 5) }}
                          >
                            강도 {p.intensity ?? 5}/10
                          </span>
                          {p.sensation && <span className="summary-sensation">· {p.sensation}</span>}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>

            {/* 우측 하단: 월별 통증 캘린더 */}
            <section className="pain-calendar-card" aria-label="월별 통증 캘린더">
              <div className="calendar-header">
                <div className="month-title">
                  <strong>
                    {calendarMonth.getFullYear()}년 {calendarMonth.getMonth() + 1}월
                  </strong>
                </div>
                <div className="month-nav">
                  <button type="button" onClick={handlePrevMonth} aria-label="이전 달" className="nav-btn">
                    &lt;
                  </button>
                  <button type="button" onClick={handleGoToday} className="today-btn">
                    오늘
                  </button>
                  <button type="button" onClick={handleNextMonth} aria-label="다음 달" className="nav-btn">
                    &gt;
                  </button>
                </div>
              </div>

              <div className="calendar-weekdays">
                {["일", "월", "화", "수", "목", "금", "토"].map((w) => (
                  <span key={w} className="weekday-label">{w}</span>
                ))}
              </div>

              <div className="calendar-grid">
                {calendarDays.map((cell) => {
                  if (!cell.isCurrentMonth) {
                    return <div key={cell.dateKey} className="calendar-cell empty" />;
                  }

                  const isSelected = cell.dateKey === selectedDate;
                  const isToday = cell.dateKey === todayKey;
                  const count = cell.records.length;
                  const hasRecord = count > 0;
                  const maxInt = cell.maxIntensity ?? 5;

                  return (
                    <button
                      key={cell.dateKey}
                      type="button"
                      className={`calendar-cell day ${isSelected ? "selected" : ""} ${isToday ? "today" : ""} ${hasRecord ? "has-record" : ""}`}
                      onClick={() => handleSelectDate(cell.dateKey)}
                      title={
                        hasRecord
                          ? `${cell.dateKey}: ${count}건 기록 (최고 강도 ${maxInt}/10)`
                          : `${cell.dateKey}: 기록 없음`
                      }
                    >
                      <span className="day-number">{cell.dayNum}</span>
                      {hasRecord && (
                        <span
                          className="record-dot"
                          style={{ backgroundColor: getIntensityColor(maxInt) }}
                        />
                      )}
                      {count > 1 && <span className="calendar-count-badge">{count}</span>}
                    </button>
                  );
                })}
              </div>

              <div className="calendar-legend">
                <div className="legend-item">
                  <span className="legend-dot" style={{ backgroundColor: "#10b981" }} />
                  <span>경미(0~3)</span>
                </div>
                <div className="legend-item">
                  <span className="legend-dot" style={{ backgroundColor: "#f59e0b" }} />
                  <span>보통(4~6)</span>
                </div>
                <div className="legend-item">
                  <span className="legend-dot" style={{ backgroundColor: "#ef4444" }} />
                  <span>심함(7~10)</span>
                </div>
              </div>
            </section>
          </aside>
        </div>
      </main>
    </div>
  );
}
