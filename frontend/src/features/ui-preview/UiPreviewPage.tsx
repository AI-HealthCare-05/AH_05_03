import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { NavLink } from "react-router-dom";

import { useLocalDomain } from "../../app/localDomainContext";
import type {
  DashboardSummary,
  HealthRecord,
  HealthRecordType,
} from "../../shared/local/domainContracts";

const RECORD_LABELS: Record<HealthRecordType, string> = {
  blood_pressure: "혈압",
  blood_glucose: "혈당",
  body_measurement: "신체 측정",
  lab_result: "검사 결과",
  vaccination: "예방접종",
  health_screening: "건강검진",
  pain: "통증 기록",
  walking: "걷기",
  exercise: "운동",
  medication: "복약",
  note: "건강 메모",
};

const RELATIONSHIPS = ["본인", "배우자", "자녀", "부모", "형제·자매", "기타"];

export function UiPreviewPage() {
  const { runtime, profiles, loading, error, createProfile, createHealthRecord } = useLocalDomain();
  const [selectedProfileId, setSelectedProfileId] = useState<string>();
  const [summary, setSummary] = useState<DashboardSummary>();
  const [records, setRecords] = useState<HealthRecord[]>([]);
  const [profileDialogOpen, setProfileDialogOpen] = useState(false);
  const [recordDialogOpen, setRecordDialogOpen] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const [saving, setSaving] = useState(false);

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === selectedProfileId) ?? profiles[0],
    [profiles, selectedProfileId],
  );

  const refreshDashboard = useCallback(
    async (profileId: string) => {
      if (!runtime) return;
      try {
        const [summaryResult, recordsResult] = await Promise.all([
          runtime.dashboard.summarize(profileId),
          runtime.healthRecords.query({ profileId }),
        ]);
        if (!summaryResult.ok) throw new Error(summaryResult.error.message);
        if (!recordsResult.ok) throw new Error(recordsResult.error.message);
        setSummary(summaryResult.value);
        setRecords(recordsResult.value);
        setActionError(undefined);
      } catch (caught) {
        setActionError(messageFrom(caught, "건강기록을 불러오지 못했습니다."));
      }
    },
    [runtime],
  );

  useEffect(() => {
    if (!selectedProfile) return;
    const timeout = window.setTimeout(() => void refreshDashboard(selectedProfile.id), 0);
    return () => window.clearTimeout(timeout);
  }, [refreshDashboard, selectedProfile]);

  async function submitProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setActionError(undefined);
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      const profile = await createProfile({
        displayName: String(form.get("displayName") ?? ""),
        relationship: String(form.get("relationship") ?? ""),
        birthDate: optionalDate(form.get("birthDate")),
      });
      setSelectedProfileId(profile.id);
      setProfileDialogOpen(false);
      formElement.reset();
    } catch (caught) {
      setActionError(messageFrom(caught, "구성원을 저장하지 못했습니다."));
    } finally {
      setSaving(false);
    }
  }

  async function submitRecord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedProfile) return;
    setSaving(true);
    setActionError(undefined);
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      await createHealthRecord({
        profileId: selectedProfile.id,
        recordType: String(form.get("recordType")) as HealthRecordType,
        recordedAt: new Date(String(form.get("recordedAt"))).toISOString(),
        note: String(form.get("note") ?? ""),
      });
      await refreshDashboard(selectedProfile.id);
      setRecordDialogOpen(false);
      formElement.reset();
    } catch (caught) {
      setActionError(messageFrom(caught, "건강기록을 저장하지 못했습니다."));
    } finally {
      setSaving(false);
    }
  }

  const localReady = Boolean(runtime);

  return (
    <div className="ui-preview-shell">
      <header className="ui-preview-header">
        <NavLink className="ui-preview-brand" to="/ui-preview">
          <span aria-hidden="true">이</span>
          <strong>이어봄</strong>
        </NavLink>
        <nav aria-label="미리보기 메뉴">
          <NavLink to="/ui-preview">건강 기록</NavLink>
          <NavLink to="/data">데이터 관리</NavLink>
          <NavLink className="ui-preview-quiet-link" to="/">기존 화면</NavLink>
        </nav>
      </header>

      <main className="ui-preview-main">
        <aside className="ui-preview-sidebar" aria-label="가족 구성원">
          <div className="ui-preview-sidebar-heading">
            <div>
              <strong>가족 구성원</strong>
              <small>{profiles.length}명</small>
            </div>
            <button
              type="button"
              aria-label="구성원 추가"
              disabled={!localReady}
              onClick={() => setProfileDialogOpen(true)}
            >
              +
            </button>
          </div>

          {loading ? <p className="ui-preview-muted">불러오는 중…</p> : null}
          {!loading && profiles.length === 0 ? (
            <p className="ui-preview-sidebar-empty">아직 등록된 구성원이 없습니다.</p>
          ) : null}
          <div className="ui-preview-profile-list">
            {profiles.map((profile) => (
              <button
                key={profile.id}
                type="button"
                className={profile.id === selectedProfile?.id ? "is-selected" : ""}
                aria-pressed={profile.id === selectedProfile?.id}
                onClick={() => setSelectedProfileId(profile.id)}
              >
                <span aria-hidden="true">{profile.displayName.slice(0, 1)}</span>
                <span>
                  <strong>{profile.displayName}</strong>
                  <small>{profile.relationship}</small>
                </span>
              </button>
            ))}
          </div>

          <div className="ui-preview-storage-note">
            <strong>저장 위치</strong>
            <p>건강정보는 이 브라우저에 암호화되어 저장됩니다.</p>
            <NavLink to="/data">백업 관리 열기</NavLink>
          </div>
        </aside>

        <section className="ui-preview-content">
          <div className="ui-preview-page-heading">
            <div>
              <p>건강 기록</p>
              <h1>{selectedProfile ? `${selectedProfile.displayName}님의 기록` : "가족 건강 기록"}</h1>
              <span>
                {selectedProfile
                  ? `${selectedProfile.relationship}${selectedProfile.birthDate ? ` · ${selectedProfile.birthDate.slice(0, 4)}년생` : ""}`
                  : "가족 구성원별 기록을 현재 브라우저에서 관리합니다."}
              </span>
            </div>
            {selectedProfile ? (
              <button className="ui-preview-primary" type="button" onClick={() => setRecordDialogOpen(true)}>
                기록 추가
              </button>
            ) : null}
          </div>

          {error ? <div className="ui-preview-alert" role="alert">{error}</div> : null}
          {actionError ? <div className="ui-preview-alert" role="alert">{actionError}</div> : null}

          {!loading && !selectedProfile ? (
            <div className="ui-preview-empty-state">
              <h2>첫 번째 가족 구성원을 등록하세요</h2>
              <p>구성원 프로필은 로그인 계정이 아니라 건강기록의 대상을 구분하는 로컬 정보입니다.</p>
              <button
                className="ui-preview-primary"
                type="button"
                disabled={!localReady}
                onClick={() => setProfileDialogOpen(true)}
              >
                구성원 등록
              </button>
            </div>
          ) : null}

          {selectedProfile ? (
            <>
              <div className="ui-preview-summary-grid" aria-label="기록 요약">
                <article>
                  <span>저장된 기록</span>
                  <strong>{summary?.totalRecords ?? 0}건</strong>
                  <small>이 브라우저 기준</small>
                </article>
                <article>
                  <span>최근 기록</span>
                  <strong>{summary?.latestRecordedAt ? formatDate(summary.latestRecordedAt) : "없음"}</strong>
                  <small>가장 최근에 입력한 날짜</small>
                </article>
                <article>
                  <span>백업</span>
                  <strong>수동 관리</strong>
                  <small><NavLink to="/data">백업 파일 관리</NavLink></small>
                </article>
              </div>

              <section className="ui-preview-records" aria-labelledby="preview-records-heading">
                <div className="ui-preview-section-heading">
                  <div>
                    <h2 id="preview-records-heading">최근 기록</h2>
                    <p>새로 입력한 기록부터 표시합니다.</p>
                  </div>
                </div>

                {records.length === 0 ? (
                  <div className="ui-preview-table-empty">
                    <strong>아직 기록이 없습니다.</strong>
                    <p>검진 결과나 오늘의 건강 상태를 기록해 보세요.</p>
                  </div>
                ) : (
                  <div className="ui-preview-record-table">
                    <div className="ui-preview-record-row is-heading" aria-hidden="true">
                      <span>종류</span><span>내용</span><span>기록일</span>
                    </div>
                    {records.slice(0, 8).map((record) => (
                      <article className="ui-preview-record-row" key={record.id}>
                        <strong>{RECORD_LABELS[record.recordType]}</strong>
                        <span>{recordNote(record)}</span>
                        <time dateTime={record.recordedAt}>{formatDateTime(record.recordedAt)}</time>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            </>
          ) : null}
        </section>
      </main>

      {profileDialogOpen ? (
        <PreviewDialog title="구성원 등록" onClose={() => setProfileDialogOpen(false)}>
          <form className="ui-preview-form" onSubmit={submitProfile}>
            <p>입력한 정보는 현재 브라우저에 암호화하여 저장합니다.</p>
            <label>이름 또는 호칭<input name="displayName" maxLength={100} required autoFocus /></label>
            <label>
              관계
              <select name="relationship" required defaultValue="">
                <option value="" disabled>선택하세요</option>
                {RELATIONSHIPS.map((relationship) => <option key={relationship}>{relationship}</option>)}
              </select>
            </label>
            <label>생년월일 <small>선택</small><input name="birthDate" type="date" /></label>
            <div className="ui-preview-form-actions">
              <button type="button" onClick={() => setProfileDialogOpen(false)}>취소</button>
              <button className="ui-preview-primary" type="submit" disabled={saving}>
                {saving ? "저장 중…" : "등록"}
              </button>
            </div>
          </form>
        </PreviewDialog>
      ) : null}

      {recordDialogOpen && selectedProfile ? (
        <PreviewDialog title="건강기록 추가" onClose={() => setRecordDialogOpen(false)}>
          <form className="ui-preview-form" onSubmit={submitRecord}>
            <p>{selectedProfile.displayName}님의 기록을 현재 브라우저에 저장합니다.</p>
            <label>
              기록 종류
              <select name="recordType" defaultValue="note" required>
                {Object.entries(RECORD_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <label>기록 시각<input name="recordedAt" type="datetime-local" required defaultValue={currentLocalDateTime()} /></label>
            <label>기록 내용<textarea name="note" rows={5} required /></label>
            <div className="ui-preview-form-actions">
              <button type="button" onClick={() => setRecordDialogOpen(false)}>취소</button>
              <button className="ui-preview-primary" type="submit" disabled={saving}>
                {saving ? "저장 중…" : "저장"}
              </button>
            </div>
          </form>
        </PreviewDialog>
      ) : null}
    </div>
  );
}

function PreviewDialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="ui-preview-dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="ui-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="ui-preview-dialog-title">
        <header>
          <h2 id="ui-preview-dialog-title">{title}</h2>
          <button type="button" aria-label="닫기" onClick={onClose}>×</button>
        </header>
        {children}
      </section>
    </div>
  );
}

function optionalDate(value: FormDataEntryValue | null): `${number}-${number}-${number}` | undefined {
  const date = String(value ?? "");
  return date ? (date as `${number}-${number}-${number}`) : undefined;
}

function messageFrom(caught: unknown, fallback: string): string {
  return caught instanceof Error ? caught.message : fallback;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric" }).format(new Date(value));
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}

function currentLocalDateTime(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function recordNote(record: HealthRecord): string {
  const note = record.payload.note;
  return typeof note === "string" ? note : "저장된 건강기록";
}
