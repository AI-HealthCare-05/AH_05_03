import { lazy, Suspense, type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { NavLink, useLocation, useNavigate, useParams } from "react-router-dom";

import { useLocalDomain } from "../../app/localDomainContext";
import type {
  DashboardSummary,
  FamilyProfile,
  HealthRecord,
  HealthRecordType,
  TodayChallengeSummary,
} from "../../shared/local/domainContracts";
import { FamilyHistoryManager } from "./FamilyHistoryManager";
import { TodayChallengeCard } from "../challenge/TodayChallengeCard";
import {
  FloatingHealthTools,
  HealthRecordComposer,
  HealthRecordHistoryDialog,
} from "../health-record/HealthRecordWorkspace";
import { HealthAssistantDrawer } from "../health-assistant/HealthAssistantDrawer";

const VanatomeBodyMap = lazy(() => import("./VanatomeBodyMap").then((module) => ({
  default: module.VanatomeBodyMap,
})));

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
  sleep: "수면",
  daily_condition: "컨디션",
  note: "건강 메모",
};

const RELATIONSHIPS = ["본인", "배우자", "자녀", "부모", "형제·자매", "기타"];

export function HomePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { profileId: routeProfileId, recordId: routeRecordId } = useParams();
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
    updateHealthRecord,
    deleteHealthRecord,
    restoreHealthRecord,
  } = useLocalDomain();
  const [selectedProfileId, setSelectedProfileId] = useState<string>();
  const [summary, setSummary] = useState<DashboardSummary>();
  const [records, setRecords] = useState<HealthRecord[]>([]);
  const [deletedRecords, setDeletedRecords] = useState<HealthRecord[]>([]);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [profileDialogOpen, setProfileDialogOpen] = useState(false);
  const [profileEditDialogOpen, setProfileEditDialogOpen] = useState(false);
  const [profileLifecycleAction, setProfileLifecycleAction] = useState<"hide" | "delete">();
  const [hiddenProfilesDialogOpen, setHiddenProfilesDialogOpen] = useState(false);
  const [recordDialogOpen, setRecordDialogOpen] = useState(false);
  const [recordHistoryDialogOpen, setRecordHistoryDialogOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<HealthRecord>();
  const [deletingRecord, setDeletingRecord] = useState<HealthRecord>();
  const [deletedRecordsDialogOpen, setDeletedRecordsDialogOpen] = useState(false);
  const [familyHistoryDialogOpen, setFamilyHistoryDialogOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [challengeSummary, setChallengeSummary] = useState<TodayChallengeSummary>();
  const [challengeLoading, setChallengeLoading] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const localStorageReady = Boolean(runtime);

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === (routeProfileId ?? selectedProfileId)) ?? profiles[0],
    [profiles, routeProfileId, selectedProfileId],
  );

  const refreshChallenge = useCallback(
    async (profileId: string) => {
      if (!runtime) return;
      setChallengeSummary(undefined);
      setChallengeLoading(true);
      try {
        const result = await runtime.challenges.getTodaySummary(profileId);
        if (result.ok) {
          setChallengeSummary(result.value);
        }
      } catch (err) {
        console.error("Failed to load challenge summary:", err);
      } finally {
        setChallengeLoading(false);
      }
    },
    [runtime],
  );

  const refreshDashboard = useCallback(
    async (profileId: string) => {
      if (!runtime) return;
      setDashboardLoading(true);
      try {
        const [summaryResult, recordsResult] = await Promise.all([
          runtime.dashboard.summarize(profileId),
          runtime.healthRecords.query({ profileId, includeDeleted: true }),
        ]);
        if (!summaryResult.ok) throw new Error(summaryResult.error.message);
        if (!recordsResult.ok) throw new Error(recordsResult.error.message);
        setSummary(summaryResult.value);
        setRecords(recordsResult.value.filter((record) => !record.deletedAt));
        setDeletedRecords(recordsResult.value.filter((record) => Boolean(record.deletedAt)));
        setActionError(undefined);
      } catch (caught) {
        setActionError(messageFrom(caught, "건강 대시보드를 불러오지 못했습니다."));
      } finally {
        setDashboardLoading(false);
      }
    },
    [runtime],
  );

  const handleToggleChallengeTask = useCallback(
    async (taskId: string) => {
      if (!runtime || !challengeSummary?.plan || !selectedProfile) return;
      try {
        const result = await runtime.challenges.toggleTaskComplete(
          challengeSummary.plan.id,
          selectedProfile.id,
          taskId,
          challengeSummary.todayDate,
        );
        if (result.ok) {
          await refreshChallenge(selectedProfile.id);
        }
      } catch (err) {
        console.error("Failed to toggle task complete:", err);
      }
    },
    [challengeSummary, refreshChallenge, runtime, selectedProfile],
  );

  const handleCompleteAllChallenge = useCallback(async () => {
    if (!runtime || !challengeSummary?.plan || !selectedProfile) return;
    try {
      const result = await runtime.challenges.completeAllToday(
        challengeSummary.plan.id,
        selectedProfile.id,
        challengeSummary.todayDate,
      );
      if (result.ok) {
        await refreshChallenge(selectedProfile.id);
      }
    } catch (err) {
      console.error("Failed to complete all challenge tasks:", err);
    }
  }, [challengeSummary, refreshChallenge, runtime, selectedProfile]);

  useEffect(() => {
    if (!runtime || !routeRecordId) return;
    void runtime.healthRecords.get(routeRecordId).then((result) => {
      if (result.ok && !result.value.deletedAt) setEditingRecord(result.value);
    });
  }, [routeRecordId, runtime]);

  const familyHistoryDialogVisible = familyHistoryDialogOpen
    || Boolean(routeProfileId && location.pathname.endsWith("/family-history"));

  useEffect(() => {
    if (!selectedProfile) return;
    const timeout = window.setTimeout(() => {
      void refreshDashboard(selectedProfile.id);
      void refreshChallenge(selectedProfile.id);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [refreshChallenge, refreshDashboard, selectedProfile]);

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
      void navigate(`/members/${profile.id}`);
      setProfileDialogOpen(false);
      formElement.reset();
    } catch (caught) {
      setActionError(messageFrom(caught, "구성원을 저장하지 못했습니다."));
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

  async function submitHealthRecordUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingRecord || !selectedProfile) return;
    setSaving(true);
    setActionError(undefined);
    const form = new FormData(event.currentTarget);
    try {
      await updateHealthRecord(editingRecord.id, {
        recordType: String(form.get("recordType")) as HealthRecordType,
        recordedAt: new Date(String(form.get("recordedAt"))).toISOString(),
        note: String(form.get("note") ?? ""),
        expectedVersion: editingRecord.version,
      });
      await refreshDashboard(selectedProfile.id);
      setEditingRecord(undefined);
      void navigate(`/members/${selectedProfile.id}/records`);
    } catch (caught) {
      setActionError(messageFrom(caught, "건강기록을 수정하지 못했습니다."));
    } finally {
      setSaving(false);
    }
  }

  async function confirmHealthRecordDelete() {
    if (!deletingRecord || !selectedProfile) return;
    setSaving(true);
    setActionError(undefined);
    try {
      await deleteHealthRecord(deletingRecord.id, deletingRecord.version);
      await refreshDashboard(selectedProfile.id);
      setDeletingRecord(undefined);
    } catch (caught) {
      setActionError(messageFrom(caught, "건강기록을 삭제하지 못했습니다."));
    } finally {
      setSaving(false);
    }
  }

  async function restoreDeletedHealthRecord(record: HealthRecord) {
    if (!selectedProfile) return;
    setSaving(true);
    setActionError(undefined);
    try {
      await restoreHealthRecord(record.id, record.version);
      await refreshDashboard(selectedProfile.id);
      if (deletedRecords.length === 1) setDeletedRecordsDialogOpen(false);
    } catch (caught) {
      setActionError(messageFrom(caught, "건강기록을 복원하지 못했습니다."));
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
          <p>현재 버전은 같은 브라우저 프로필의 사용자별 보관함 잠금을 아직 지원하지 않습니다. 공용 PC에서는 각자 다른 OS·브라우저 프로필을 사용하세요.</p>
        </div>
        <NavLink to="/data">백업 관리</NavLink>
      </section>

      {error ? <div className="alert error-alert" role="alert">{error}</div> : null}
      {actionError && !profileLifecycleAction && !hiddenProfilesDialogOpen ? <div className="alert error-alert" role="alert">{actionError}</div> : null}

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
                <button className="secondary-button" type="button" onClick={() => {
                  setFamilyHistoryDialogOpen(true);
                  void navigate(`/members/${selectedProfile.id}/family-history`);
                }}>
                  가족력 관리
                </button>
                <button className="primary-button" type="button" onClick={() => setRecordDialogOpen(true)}>
                  건강기록 작성
                </button>
              </div>
            </div>

            {/* 1. 오늘의 챌린지 카드 (Hero Section) */}
            <TodayChallengeCard
              profileName={selectedProfile.displayName}
              summary={challengeSummary}
              loading={challengeLoading}
              onToggleTask={handleToggleChallengeTask}
              onCompleteAll={handleCompleteAllChallenge}
              onOpenAssistantForChallenge={() => setAssistantOpen(true)}
            />

            {/* 2. 건강 지표 요약 카드 */}
            <div className="metric-grid">
              <button className="metric-card-button" type="button" onClick={() => setRecordHistoryDialogOpen(true)}>
                <MetricCard label="저장된 기록" value={`${summary?.totalRecords ?? 0}건`} helper="눌러서 전체 기록 보기" />
              </button>
              <MetricCard
                label="최근 기록"
                value={summary?.latestRecordedAt ? formatDate(summary.latestRecordedAt) : "아직 없음"}
                helper="이 브라우저 기준"
              />
              <MetricCard label="프로필 상태" value="안전" helper="서버 전송 없음" tone="safe" />
            </div>

            {/* 3. 최근 건강기록 목록 */}
            <div className="records-panel">
              <div className="panel-heading">
                <div>
                  <h3>최근 건강기록</h3>
                  <p>최신 기록부터 보여줍니다.</p>
                </div>
                <div className="panel-heading-actions">
                  {deletedRecords.length > 0 ? (
                    <button className="text-button" type="button" onClick={() => {
                      setActionError(undefined);
                      setDeletedRecordsDialogOpen(true);
                    }}>
                      삭제된 기록 {deletedRecords.length}건
                    </button>
                  ) : null}
                  {dashboardLoading ? <span className="subtle-status">불러오는 중…</span> : null}
                </div>
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
                      <div className="record-row-actions">
                        <button type="button" onClick={() => {
                          setActionError(undefined);
                          setEditingRecord(record);
                          void navigate(`/members/${selectedProfile.id}/records/${record.id}`);
                        }}>수정</button>
                        <button type="button" onClick={() => {
                          setActionError(undefined);
                          setDeletingRecord(record);
                        }}>삭제</button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* 4. 3D 인체 모델 */}
            <Suspense fallback={<div className="body-map-loading">3D 인체 미리보기를 준비하는 중…</div>}>
              <VanatomeBodyMap profileName={selectedProfile.displayName} />
            </Suspense>
          </div>

          <aside className="family-switcher-panel" aria-label="가족 구성원">
            <div className="family-switcher-header">
              <div>
                <p className="section-kicker">가족 구성원</p>
                <h2 id="members-heading">기록 대상</h2>
              </div>
              <span className="section-count">{profiles.length}명</span>
            </div>

            <p className="family-switcher-description">구성원을 선택하면 해당 프로필의 건강기록과 챌린지로 전환됩니다.</p>

            <div className="family-switcher-list" role="list">
              {profiles.map((profile, index) => {
                const isSelected = profile.id === selectedProfile.id;
                return (
                  <button
                    className={isSelected ? "family-switcher-card is-selected" : "family-switcher-card"}
                    key={profile.id}
                    type="button"
                    role="listitem"
                    aria-pressed={isSelected}
                    onClick={() => {
                      setSelectedProfileId(profile.id);
                      void navigate(`/members/${profile.id}`);
                    }}
                  >
                    <span className={`member-avatar avatar-tone-${index % 4}`} aria-hidden="true">
                      {profile.displayName.slice(0, 1)}
                    </span>
                    <span className="family-switcher-copy">
                      <strong>{profile.displayName}</strong>
                      <small>{profile.relationship}{profile.birthDate ? ` · ${profile.birthDate.slice(0, 4)}년생` : ""}</small>
                    </span>
                    {isSelected ? <span className="family-switcher-current">현재</span> : null}
                  </button>
                );
              })}

              <button
                className="family-switcher-card family-switcher-add"
                type="button"
                disabled={!localStorageReady}
                onClick={() => setProfileDialogOpen(true)}
              >
                <span className="add-member-mark" aria-hidden="true">+</span>
                <span className="family-switcher-copy">
                  <strong>구성원 추가</strong>
                  <small>새 프로필 만들기</small>
                </span>
              </button>
            </div>

            {hiddenProfiles.length > 0 ? (
              <button className="family-switcher-hidden" type="button" onClick={() => {
                setActionError(undefined);
                setHiddenProfilesDialogOpen(true);
              }}>
                숨긴 프로필 {hiddenProfiles.length}명 관리
              </button>
            ) : null}
          </aside>
        </section>
      ) : (
        <section className="dashboard-section" aria-labelledby="members-heading">
          <div className="section-title-row">
            <div>
              <p className="section-kicker">가족 구성원</p>
              <h2 id="members-heading">첫 건강 프로필을 만들어 주세요</h2>
            </div>
            {hiddenProfiles.length > 0 ? (
              <button className="secondary-button compact-button" type="button" onClick={() => {
                setActionError(undefined);
                setHiddenProfilesDialogOpen(true);
              }}>
                숨긴 프로필 {hiddenProfiles.length}명
              </button>
            ) : null}
          </div>
          {loading ? <DashboardSkeleton /> : null}
          {!loading ? (
          <EmptyHousehold
            disabled={!localStorageReady}
            onCreate={() => setProfileDialogOpen(true)}
          />
          ) : null}
        </section>
      )}

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
          <HealthRecordComposer
            profile={selectedProfile}
            runtime={runtime}
            onClose={() => setRecordDialogOpen(false)}
            onSaved={() => refreshDashboard(selectedProfile.id)}
            onOpenPainChat={() => {
              setRecordDialogOpen(false);
              setAssistantOpen(true);
            }}
          />
        </Modal>
      ) : null}

      {recordHistoryDialogOpen ? (
        <Modal title={`${selectedProfile?.displayName ?? ""}님의 저장된 건강기록`} onClose={() => setRecordHistoryDialogOpen(false)}>
          <HealthRecordHistoryDialog
            records={records}
            onEdit={(record) => {
              setRecordHistoryDialogOpen(false);
              setEditingRecord(record);
              if (selectedProfile) void navigate(`/members/${selectedProfile.id}/records/${record.id}`);
            }}
            onDelete={(record) => {
              setRecordHistoryDialogOpen(false);
              setDeletingRecord(record);
            }}
          />
        </Modal>
      ) : null}

      {editingRecord ? (
        <Modal title="건강기록 수정" onClose={() => {
          setEditingRecord(undefined);
          if (selectedProfile) void navigate(`/members/${selectedProfile.id}/records`);
        }}>
          <form className="product-form" onSubmit={submitHealthRecordUpdate}>
            <label>
              기록 종류
              <select name="recordType" defaultValue={editingRecord.recordType} required>
                {Object.entries(RECORD_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label>
              기록 시각
              <input name="recordedAt" type="datetime-local" required defaultValue={toLocalDateTime(editingRecord.recordedAt)} />
            </label>
            <label>
              기록 내용
              <textarea name="note" rows={5} required defaultValue={recordNote(editingRecord)} />
            </label>
            <div className="form-actions">
              <button className="secondary-button" type="button" onClick={() => {
                setEditingRecord(undefined);
                if (selectedProfile) void navigate(`/members/${selectedProfile.id}/records`);
              }}>취소</button>
              <button className="primary-button" type="submit" disabled={saving}>{saving ? "저장 중…" : "변경사항 저장"}</button>
            </div>
          </form>
        </Modal>
      ) : null}

      {deletingRecord ? (
        <Modal title="건강기록을 삭제할까요?" onClose={() => setDeletingRecord(undefined)}>
          <div className="profile-confirmation">
            <p>기록은 즉시 영구 삭제되지 않고 삭제 목록으로 이동합니다. 필요하면 다시 복원할 수 있습니다.</p>
            {actionError ? <div className="alert error-alert" role="alert">{actionError}</div> : null}
            <div className="form-actions">
              <button className="secondary-button" type="button" onClick={() => setDeletingRecord(undefined)}>취소</button>
              <button className="danger-button" type="button" disabled={saving} onClick={() => void confirmHealthRecordDelete()}>
                {saving ? "처리 중…" : "삭제 목록으로 이동"}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}

      {deletedRecordsDialogOpen ? (
        <Modal title="삭제된 건강기록" onClose={() => setDeletedRecordsDialogOpen(false)}>
          <div className="hidden-profiles-content">
            <p className="form-notice">삭제한 기록은 대시보드 집계에서 제외되며 이 브라우저에서 복원할 수 있습니다.</p>
            {actionError ? <div className="alert error-alert" role="alert">{actionError}</div> : null}
            <div className="hidden-profile-list">
              {deletedRecords.map((record) => (
                <article className="hidden-profile-row" key={record.id}>
                  <div><strong>{RECORD_LABELS[record.recordType]}</strong><small>{formatDateTime(record.recordedAt)} · {recordNote(record)}</small></div>
                  <button className="secondary-button" type="button" disabled={saving} onClick={() => void restoreDeletedHealthRecord(record)}>복원</button>
                </article>
              ))}
            </div>
          </div>
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

      {familyHistoryDialogVisible && runtime && selectedProfile ? (
        <FamilyHistoryManager runtime={runtime} profile={selectedProfile} onClose={() => {
          setFamilyHistoryDialogOpen(false);
          void navigate(`/members/${selectedProfile.id}`);
        }} />
      ) : null}
      {selectedProfile ? (
        <>
          <button
            type="button"
            className="health-assistant-launcher-btn"
            onClick={() => setAssistantOpen(true)}
            aria-label="건강 비서 봄이 열기"
          >
            <span className="launcher-icon" aria-hidden="true">봄</span>
            <span>봄이 대화</span>
          </button>
          <HealthAssistantDrawer
            profile={selectedProfile}
            runtime={runtime}
            isOpen={assistantOpen}
            onClose={() => setAssistantOpen(false)}
            onRecordSaved={() => refreshDashboard(selectedProfile.id)}
            onChallengeSaved={async () => {
              await refreshDashboard(selectedProfile.id);
              await refreshChallenge(selectedProfile.id);
            }}
            onNavigateToRecords={() => setRecordHistoryDialogOpen(true)}
          />
        </>
      ) : null}
      <FloatingHealthTools
        profile={selectedProfile}
        runtime={runtime}
        onSaved={() => selectedProfile ? refreshDashboard(selectedProfile.id) : Promise.resolve()}
      />
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

function toLocalDateTime(value: string): string {
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function recordNote(record: HealthRecord): string {
  const p = record.payload as Record<string, unknown>;
  if (typeof p.note === "string" && p.note.trim()) {
    return p.note.trim();
  }
  if (record.recordType === "exercise" || p.exerciseName) {
    const parts = [
      p.exerciseName,
      p.distanceKm ? `${p.distanceKm}km` : "",
      p.durationMinutes ? `${p.durationMinutes}분` : "",
      p.weightKg ? `${p.weightKg}kg` : "",
      p.reps ? `${p.reps}회` : "",
      p.sets ? `${p.sets}세트` : "",
    ].filter(Boolean);
    return parts.join(" ") || "운동 기록";
  }
  if (record.recordType === "blood_pressure" || p.systolic || p.systolicMmHg) {
    const sys = p.systolic ?? p.systolicMmHg;
    const dia = p.diastolic ?? p.diastolicMmHg;
    const pulse = p.pulse ?? p.pulseBpm;
    return `혈압 ${sys}/${dia} mmHg${pulse ? ` (맥박 ${pulse})` : ""}`;
  }
  if (record.recordType === "blood_glucose" || p.glucose || p.valueMgDl || p.value) {
    const val = p.glucose ?? p.valueMgDl ?? p.value;
    const timing = p.timing ? ` (${p.timing})` : "";
    return `혈당 ${val} mg/dL${timing}`;
  }
  if (record.recordType === "medication" || p.medicationName) {
    const name = p.medicationName;
    const dosage = p.dosage ? ` ${p.dosage}` : "";
    const taken = p.takenAt ? ` (${p.takenAt})` : "";
    return `복약: ${name}${dosage}${taken}`;
  }
  if (record.recordType === "pain" || p.bodyArea) {
    const area = p.bodyArea || "통증";
    const intensity = p.intensity !== undefined ? ` (강도 ${p.intensity})` : "";
    const sensation = p.sensation ? ` - ${p.sensation}` : "";
    return `${area}${intensity}${sensation}`;
  }
  if (record.recordType === "health_screening" || record.recordType === "lab_result") {
    const name = p.screeningName || p.testName || "건강검진";
    const summary = p.summary || p.itemsSummary || "";
    return `${name}${summary ? `: ${summary}` : ""}`.slice(0, 120);
  }
  if (record.recordType === "sleep" || p.durationHours !== undefined) {
    const hours = p.durationHours ? `${p.durationHours}시간` : "";
    const quality = p.quality ? ` (수면 질: ${p.quality})` : "";
    return `수면 ${hours}${quality}`.trim();
  }
  if (record.recordType === "daily_condition" || p.condition) {
    const cond = p.condition ? `컨디션: ${p.condition}` : "컨디션 기록";
    const raw = p.rawText ? ` (${p.rawText})` : "";
    return `${cond}${raw}`;
  }
  return "저장된 건강기록";
}

function recordMark(type: HealthRecordType): string {
  if (type === "health_screening" || type === "lab_result") return "검";
  if (type === "pain") return "통";
  if (type === "blood_pressure" || type === "blood_glucose") return "수";
  if (type === "sleep") return "잠";
  if (type === "daily_condition") return "상";
  return "기";
}
