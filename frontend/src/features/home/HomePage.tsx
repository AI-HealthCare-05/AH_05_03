import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { NavLink } from "react-router-dom";

import { useLocalDomain } from "../../app/localDomainContext";
import type {
  DashboardSummary,
  FamilyProfile,
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
  note: "건강 메모",
};

const RELATIONSHIPS = ["본인", "배우자", "자녀", "부모", "형제·자매", "기타"];

export function HomePage() {
  const {
    runtime,
    profiles,
    hiddenProfiles,
    loading,
    error,
    createProfile,
    updateProfile,
    hideProfile,
    restoreProfile,
    deleteEmptyProfile,
    createHealthRecord,
  } = useLocalDomain();
  const [selectedProfileId, setSelectedProfileId] = useState<string>();
  const [summary, setSummary] = useState<DashboardSummary>();
  const [records, setRecords] = useState<HealthRecord[]>([]);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [profileDialogOpen, setProfileDialogOpen] = useState(false);
  const [profileEditDialogOpen, setProfileEditDialogOpen] = useState(false);
  const [profileLifecycleAction, setProfileLifecycleAction] = useState<"hide" | "delete">();
  const [hiddenProfilesDialogOpen, setHiddenProfilesDialogOpen] = useState(false);
  const [recordDialogOpen, setRecordDialogOpen] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const localStorageReady = Boolean(runtime);

  const refreshDashboard = useCallback(
    async (profileId: string) => {
      if (!runtime) return;
      setDashboardLoading(true);
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
        setActionError(messageFrom(caught, "건강 대시보드를 불러오지 못했습니다."));
      } finally {
        setDashboardLoading(false);
      }
    },
    [runtime],
  );

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === selectedProfileId) ?? profiles[0],
    [profiles, selectedProfileId],
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

  async function submitHealthRecord(event: FormEvent<HTMLFormElement>) {
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

  async function submitProfileUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedProfile) return;
    setSaving(true);
    setActionError(undefined);
    const form = new FormData(event.currentTarget);
    try {
      await updateProfile(selectedProfile.id, {
        displayName: String(form.get("displayName") ?? ""),
        relationship: String(form.get("relationship") ?? ""),
        birthDate: optionalDate(form.get("birthDate")),
        expectedVersion: selectedProfile.version,
      });
      setProfileEditDialogOpen(false);
    } catch (caught) {
      setActionError(messageFrom(caught, "프로필을 수정하지 못했습니다."));
    } finally {
      setSaving(false);
    }
  }

  async function confirmProfileLifecycle() {
    if (!selectedProfile || !profileLifecycleAction) return;
    setSaving(true);
    setActionError(undefined);
    try {
      if (profileLifecycleAction === "hide") {
        await hideProfile(selectedProfile.id, selectedProfile.version);
      } else {
        await deleteEmptyProfile(selectedProfile.id);
      }
      setSelectedProfileId(undefined);
      setProfileLifecycleAction(undefined);
    } catch (caught) {
      setActionError(messageFrom(caught, "프로필 상태를 변경하지 못했습니다."));
    } finally {
      setSaving(false);
    }
  }

  async function restoreHiddenProfile(profile: FamilyProfile) {
    setSaving(true);
    setActionError(undefined);
    try {
      const restored = await restoreProfile(profile.id, profile.version);
      setSelectedProfileId(restored.id);
      if (hiddenProfiles.length === 1) setHiddenProfilesDialogOpen(false);
    } catch (caught) {
      setActionError(messageFrom(caught, "숨긴 프로필을 복원하지 못했습니다."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="product-page">
      <section className="dashboard-heading">
        <div>
          <p className="page-kicker">우리 가족 건강 홈</p>
          <h1>가족의 건강 흐름을 한곳에서 이어보세요</h1>
          <p>기록은 서버가 아니라 현재 브라우저에 암호화되어 저장됩니다.</p>
        </div>
        <div className="heading-actions">
          <span className="local-status-badge">
            {localStorageReady ? "이 브라우저에 저장 중" : "로컬 저장소 확인 필요"}
          </span>
          <button
            className="primary-button"
            type="button"
            disabled={!localStorageReady}
            onClick={() => setProfileDialogOpen(true)}
          >
            구성원 추가
          </button>
        </div>
      </section>

      <section className="privacy-strip" aria-label="데이터 보관 안내">
        <span className="privacy-strip-mark" aria-hidden="true">로컬</span>
        <div>
          <strong>민감한 건강정보는 이 기기 안에서 처리합니다.</strong>
          <p>계정·구독·초대 상태만 서버에 저장되며 건강기록은 자동 업로드되지 않습니다.</p>
        </div>
        <NavLink to="/data">백업 관리</NavLink>
      </section>

      {error ? <div className="alert error-alert" role="alert">{error}</div> : null}
      {actionError && !profileLifecycleAction && !hiddenProfilesDialogOpen ? <div className="alert error-alert" role="alert">{actionError}</div> : null}

      <section className="dashboard-section" aria-labelledby="members-heading">
        <div className="section-title-row">
          <div>
            <p className="section-kicker">가족 구성원</p>
            <h2 id="members-heading">누구의 기록을 볼까요?</h2>
          </div>
          <div className="member-section-actions">
            {hiddenProfiles.length > 0 ? (
              <button className="secondary-button compact-button" type="button" onClick={() => {
                setActionError(undefined);
                setHiddenProfilesDialogOpen(true);
              }}>
                숨긴 프로필 {hiddenProfiles.length}명
              </button>
            ) : null}
            <span className="section-count">{profiles.length}명</span>
          </div>
        </div>

        {loading ? <DashboardSkeleton /> : null}
        {!loading && profiles.length === 0 ? (
          <EmptyHousehold
            disabled={!localStorageReady}
            onCreate={() => setProfileDialogOpen(true)}
          />
        ) : null}
        {profiles.length > 0 ? (
          <div className="member-list" role="list">
            {profiles.map((profile, index) => (
              <button
                className={profile.id === selectedProfileId ? "member-card is-selected" : "member-card"}
                key={profile.id}
                type="button"
                role="listitem"
                aria-pressed={profile.id === selectedProfileId}
                onClick={() => setSelectedProfileId(profile.id)}
              >
                <span className={`member-avatar avatar-tone-${index % 4}`} aria-hidden="true">
                  {profile.displayName.slice(0, 1)}
                </span>
                <span className="member-card-copy">
                  <strong>{profile.displayName}</strong>
                  <small>{profile.relationship}{profile.birthDate ? ` · ${profile.birthDate.slice(0, 4)}년생` : ""}</small>
                </span>
                <span className="member-storage-label">로컬 프로필</span>
              </button>
            ))}
            <button
              className="member-card add-member-card"
              type="button"
              disabled={!localStorageReady}
              onClick={() => setProfileDialogOpen(true)}
            >
              <span className="add-member-mark" aria-hidden="true">+</span>
              <span className="member-card-copy">
                <strong>구성원 추가</strong>
                <small>이 브라우저에 새 프로필 만들기</small>
              </span>
            </button>
          </div>
        ) : null}
      </section>

      {selectedProfile ? (
        <section className="member-dashboard" aria-labelledby="selected-member-heading">
          <div className="member-dashboard-main">
            <div className="section-title-row">
              <div>
                <p className="section-kicker">선택한 구성원</p>
                <h2 id="selected-member-heading">{selectedProfile.displayName}님의 건강기록</h2>
              </div>
              <div className="member-dashboard-actions">
                <button className="secondary-button" type="button" onClick={() => {
                  setActionError(undefined);
                  setProfileEditDialogOpen(true);
                }}>
                  프로필 관리
                </button>
                <button className="primary-button" type="button" onClick={() => setRecordDialogOpen(true)}>
                  건강기록 작성
                </button>
              </div>
            </div>

            <div className="metric-grid">
              <MetricCard label="저장된 기록" value={`${summary?.totalRecords ?? 0}건`} helper="암호화 로컬 저장" />
              <MetricCard
                label="최근 기록"
                value={summary?.latestRecordedAt ? formatDate(summary.latestRecordedAt) : "아직 없음"}
                helper="이 브라우저 기준"
              />
              <MetricCard label="프로필 상태" value="안전" helper="서버 전송 없음" tone="safe" />
            </div>

            <div className="records-panel">
              <div className="panel-heading">
                <div>
                  <h3>최근 건강기록</h3>
                  <p>최신 기록부터 보여줍니다.</p>
                </div>
                {dashboardLoading ? <span className="subtle-status">불러오는 중…</span> : null}
              </div>
              {records.length === 0 ? (
                <div className="compact-empty">
                  <strong>아직 건강기록이 없습니다.</strong>
                  <p>검진 결과, 통증 변화나 건강 메모부터 남겨보세요.</p>
                  <button className="text-button" type="button" onClick={() => setRecordDialogOpen(true)}>
                    첫 기록 작성하기
                  </button>
                </div>
              ) : (
                <ul className="record-list">
                  {records.slice(0, 5).map((record) => (
                    <li key={record.id}>
                      <span className="record-type-mark" aria-hidden="true">{recordMark(record.recordType)}</span>
                      <div>
                        <strong>{RECORD_LABELS[record.recordType]}</strong>
                        <p>{recordNote(record)}</p>
                      </div>
                      <time dateTime={record.recordedAt}>{formatDateTime(record.recordedAt)}</time>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <aside className="quick-actions-panel">
            <p className="section-kicker">빠른 작업</p>
            <h2>무엇을 기록할까요?</h2>
            <button type="button" onClick={() => setRecordDialogOpen(true)}>
              <strong>건강기록 작성</strong>
              <small>검진·통증·수치·메모</small>
            </button>
            <button type="button" disabled title="다음 구현 단계에서 제공됩니다.">
              <strong>가족력 관리</strong>
              <small>구성원별 정보 · 후속 구현</small>
            </button>
            <NavLink to="/data">
              <strong>암호화 백업</strong>
              <small>파일로 내보내기·가져오기</small>
            </NavLink>
          </aside>
        </section>
      ) : null}

      {profileDialogOpen ? (
        <Modal title="가족 구성원 로컬 프로필 만들기" onClose={() => setProfileDialogOpen(false)}>
          <form className="product-form" onSubmit={submitProfile}>
            <p className="form-notice">입력한 정보는 이 브라우저에 암호화해 저장하며 서버로 보내지 않습니다.</p>
            <label>
              이름 또는 호칭
              <input name="displayName" maxLength={100} required placeholder="예: 나, 엄마, 민준" autoFocus />
            </label>
            <label>
              관계
              <select name="relationship" required defaultValue="">
                <option value="" disabled>관계를 선택하세요</option>
                {RELATIONSHIPS.map((relationship) => <option key={relationship}>{relationship}</option>)}
              </select>
            </label>
            <label>
              생년월일 <span className="optional-label">선택</span>
              <input name="birthDate" type="date" />
            </label>
            <div className="form-actions">
              <button className="secondary-button" type="button" onClick={() => setProfileDialogOpen(false)}>취소</button>
              <button className="primary-button" type="submit" disabled={saving}>{saving ? "저장 중…" : "프로필 저장"}</button>
            </div>
          </form>
        </Modal>
      ) : null}

      {recordDialogOpen && selectedProfile ? (
        <Modal title={`${selectedProfile.displayName}님의 건강기록 작성`} onClose={() => setRecordDialogOpen(false)}>
          <form className="product-form" onSubmit={submitHealthRecord}>
            <p className="form-notice">이 기록은 서버 API를 거치지 않고 현재 브라우저에 바로 암호화됩니다.</p>
            <label>
              기록 종류
              <select name="recordType" defaultValue="note" required>
                {Object.entries(RECORD_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label>
              기록 시각
              <input name="recordedAt" type="datetime-local" required defaultValue={currentLocalDateTime()} />
            </label>
            <label>
              기록 내용
              <textarea name="note" rows={5} required placeholder="변화, 수치 또는 확인할 내용을 적어주세요." />
            </label>
            <div className="form-actions">
              <button className="secondary-button" type="button" onClick={() => setRecordDialogOpen(false)}>취소</button>
              <button className="primary-button" type="submit" disabled={saving}>{saving ? "암호화 중…" : "기록 저장"}</button>
            </div>
          </form>
        </Modal>
      ) : null}

      {profileEditDialogOpen && selectedProfile ? (
        <Modal title={`${selectedProfile.displayName} 프로필 관리`} onClose={() => setProfileEditDialogOpen(false)}>
          <form className="product-form" onSubmit={submitProfileUpdate}>
            <p className="form-notice">프로필 정보와 건강기록은 계속 이 브라우저에만 저장됩니다.</p>
            <label>
              이름 또는 호칭
              <input
                name="displayName"
                maxLength={100}
                required
                defaultValue={selectedProfile.displayName}
                autoFocus
              />
            </label>
            <label>
              관계
              <select name="relationship" required defaultValue={selectedProfile.relationship}>
                {RELATIONSHIPS.map((relationship) => <option key={relationship}>{relationship}</option>)}
              </select>
            </label>
            <label>
              생년월일 <span className="optional-label">선택</span>
              <input name="birthDate" type="date" defaultValue={selectedProfile.birthDate ?? ""} />
            </label>
            <div className="form-actions">
              <button className="secondary-button" type="button" onClick={() => setProfileEditDialogOpen(false)}>취소</button>
              <button className="primary-button" type="submit" disabled={saving}>{saving ? "저장 중…" : "변경사항 저장"}</button>
            </div>
          </form>

          <section className="profile-lifecycle-zone" aria-labelledby="profile-lifecycle-heading">
            <h3 id="profile-lifecycle-heading">프로필 정리</h3>
            <p>기록을 보존하려면 숨기기를 사용하세요. 영구 삭제는 연결된 기록이 없는 프로필에만 허용됩니다.</p>
            <div className="profile-lifecycle-actions">
              <button className="secondary-button" type="button" onClick={() => {
                setActionError(undefined);
                setProfileEditDialogOpen(false);
                setProfileLifecycleAction("hide");
              }}>
                목록에서 숨기기
              </button>
              <button className="danger-button" type="button" onClick={() => {
                setActionError(undefined);
                setProfileEditDialogOpen(false);
                setProfileLifecycleAction("delete");
              }}>
                빈 프로필 영구 삭제
              </button>
            </div>
          </section>
        </Modal>
      ) : null}

      {profileLifecycleAction && selectedProfile ? (
        <Modal
          title={profileLifecycleAction === "hide" ? "프로필을 목록에서 숨길까요?" : "빈 프로필을 영구 삭제할까요?"}
          onClose={() => setProfileLifecycleAction(undefined)}
        >
          <div className="profile-confirmation">
            {profileLifecycleAction === "hide" ? (
              <p><strong>{selectedProfile.displayName}</strong> 프로필과 연결 기록은 보존됩니다. 현재 가족 목록에서만 보이지 않게 됩니다.</p>
            ) : (
              <p><strong>{selectedProfile.displayName}</strong> 프로필을 이 브라우저에서 삭제합니다. 연결된 기록이 하나라도 있으면 삭제하지 않고 안내합니다.</p>
            )}
            {actionError ? <div className="alert error-alert" role="alert">{actionError}</div> : null}
            <div className="form-actions">
              <button className="secondary-button" type="button" onClick={() => setProfileLifecycleAction(undefined)}>취소</button>
              <button
                className={profileLifecycleAction === "delete" ? "danger-button" : "primary-button"}
                type="button"
                disabled={saving}
                onClick={() => void confirmProfileLifecycle()}
              >
                {saving ? "처리 중…" : profileLifecycleAction === "hide" ? "프로필 숨기기" : "영구 삭제"}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}

      {hiddenProfilesDialogOpen ? (
        <Modal title="숨긴 프로필 관리" onClose={() => setHiddenProfilesDialogOpen(false)}>
          <div className="hidden-profiles-content">
            <p className="form-notice">숨긴 프로필과 연결된 건강기록은 삭제되지 않았습니다. 복원하면 가족 목록에서 다시 확인할 수 있습니다.</p>
            {actionError ? <div className="alert error-alert" role="alert">{actionError}</div> : null}
            <div className="hidden-profile-list">
              {hiddenProfiles.map((profile) => (
                <article key={profile.id} className="hidden-profile-row">
                  <div>
                    <strong>{profile.displayName}</strong>
                    <small>{profile.relationship}{profile.birthDate ? ` · ${profile.birthDate.slice(0, 4)}년생` : ""}</small>
                  </div>
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={saving}
                    aria-label={`${profile.displayName} 프로필 복원`}
                    onClick={() => void restoreHiddenProfile(profile)}
                  >
                    {saving ? "처리 중…" : "복원"}
                  </button>
                </article>
              ))}
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function EmptyHousehold({ disabled, onCreate }: { disabled: boolean; onCreate: () => void }) {
  return (
    <div className="empty-household">
      <div className="empty-household-copy">
        <span className="empty-step">첫 단계</span>
        <h3>가족 구성원 프로필을 만들어 시작하세요.</h3>
        <p>별도 로그인 없이 건강기록의 대상을 구분하는 로컬 프로필입니다.</p>
        <button className="primary-button" type="button" disabled={disabled} onClick={onCreate}>
          첫 구성원 등록
        </button>
      </div>
      <ol className="onboarding-steps">
        <li><span>1</span><div><strong>프로필 만들기</strong><small>이름·관계·생년 정보</small></div></li>
        <li><span>2</span><div><strong>건강기록 남기기</strong><small>검진·통증·건강 메모</small></div></li>
        <li><span>3</span><div><strong>백업 파일 보관</strong><small>암호화해 직접 내보내기</small></div></li>
      </ol>
    </div>
  );
}

function DashboardSkeleton() {
  return <div className="dashboard-skeleton" aria-label="로컬 프로필 불러오는 중"><span /><span /><span /></div>;
}

function MetricCard({ label, value, helper, tone }: { label: string; value: string; helper: string; tone?: "safe" }) {
  return (
    <article className={tone === "safe" ? "metric-card is-safe" : "metric-card"}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{helper}</small>
    </article>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div className="modal-heading">
          <div><p className="section-kicker">이 기기에 저장</p><h2 id="modal-title">{title}</h2></div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="닫기">×</button>
        </div>
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
  return new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
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

function recordMark(type: HealthRecordType): string {
  if (type === "health_screening" || type === "lab_result") return "검";
  if (type === "pain") return "통";
  if (type === "blood_pressure" || type === "blood_glucose") return "수";
  return "기";
}
