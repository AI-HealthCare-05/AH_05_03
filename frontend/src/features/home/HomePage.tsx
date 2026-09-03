import { lazy, Suspense, type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { NavLink, useLocation, useNavigate, useParams } from "react-router-dom";

import { useLocalDomain } from "../../app/localDomainContext";
import { Modal } from "../../shared/ui/Modal";
// 모달은 눌러야 뜬다. 정적으로 두면 판정 카드 일체가 홈의 첫 청크에 실린다.
const RecordDetail = lazy(() => import("./RecordDetail").then((m) => ({ default: m.RecordDetail })));
// 건강 비서. 3,000줄 + CSS 1,500줄이라 홈의 첫 청크에 넣지 않는다 — 대화를 한 번도
// 열지 않는 사용자가 그걸 다 받아 갈 이유가 없다.
const HealthAssistantDrawer = lazy(() =>
  import("../health-assistant/HealthAssistantDrawer").then((m) => ({ default: m.HealthAssistantDrawer })),
);
import { RecordSummary } from "./RecordSummary";
import type {
  DashboardSummary,
  FamilyProfile,
  HealthRecord,
  HealthRecordType,
} from "../../shared/local/domainContracts";
import { LEVEL_LABEL } from "../assessment/contracts";
import type { RiskLevel } from "../assessment/contracts";
import { type LatestSummary, listLatestByProfile } from "../assessment/snapshots";
import { regionRisks, type RegionRisk } from "./bodyRisk";
import { FamilyHistoryManager } from "./FamilyHistoryManager";
import { ChallengeDashboardCard } from "../challenge/ChallengeDashboardCard";

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
  assessment: "위험 판정",
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
    createHealthRecord,
    updateHealthRecord,
    deleteHealthRecord,
    restoreHealthRecord,
    purgeHealthRecord,
  } = useLocalDomain();
  const [selectedProfileId, setSelectedProfileId] = useState<string>();
  const [summary, setSummary] = useState<DashboardSummary>();
  const [records, setRecords] = useState<HealthRecord[]>([]);
  const [deletedRecords, setDeletedRecords] = useState<HealthRecord[]>([]);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  // "건강기록 작성" 을 누르면 바로 폼이 아니라 갈림길이 먼저 뜬다. 손으로 적는 것과
  // 검진표를 올리는 것은 하는 일이 전혀 달라서, 한 폼에 욱여넣으면 둘 다 어색해진다.
  const [recordChoiceOpen, setRecordChoiceOpen] = useState(false);
  // 구성원별 최근 판정. 카드 위에 얹어 "누구를 열어 봐야 하나"를 한눈에 준다.
  const [verdicts, setVerdicts] = useState<Record<string, LatestSummary>>({});
  // 자세히 볼 판정 기록. 판정은 수정·삭제 대상이 아니라 열어 보는 대상이다.
  const [openRecord, setOpenRecord] = useState<HealthRecord>();
  // 3D 인체에 색을 입힐 판정. `openRecord` 와 따로 두는 이유는 모달을 닫아도 색은
  // 남아야 하기 때문이다 — 모달을 닫는 동작은 "그만 볼래" 지 "선택을 풀래" 가 아니다.
  const [bodyRecord, setBodyRecord] = useState<HealthRecord>();
  const [assistantOpen, setAssistantOpen] = useState(false);
  // 영구 삭제를 물어볼 대상. **한 번 더 누르게 한다** — 되돌릴 수 없는데 복원 버튼
  // 바로 옆이라, 한 번에 지워지면 누르려던 것과 다른 것이 사라진다.
  const [purgingRecord, setPurgingRecord] = useState<HealthRecord>();
  const [profileDialogOpen, setProfileDialogOpen] = useState(false);
  const [profileEditDialogOpen, setProfileEditDialogOpen] = useState(false);
  const [profileLifecycleAction, setProfileLifecycleAction] = useState<"hide" | "delete">();
  const [hiddenProfilesDialogOpen, setHiddenProfilesDialogOpen] = useState(false);
  const [recordDialogOpen, setRecordDialogOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<HealthRecord>();
  const [deletingRecord, setDeletingRecord] = useState<HealthRecord>();
  const [deletedRecordsDialogOpen, setDeletedRecordsDialogOpen] = useState(false);
  const [familyHistoryDialogOpen, setFamilyHistoryDialogOpen] = useState(false);
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

  /**
   * 인체에 색을 입힐 판정 **한 장**.
   *
   * 여러 판정을 합치지 않는다. 합치면 "언제 잰 몸인가" 가 사라진다 — 3월의 콩팥과
   * 9월의 심장을 한 인체에 얹으면 그건 아무 시점의 몸도 아니다. 고르지 않았으면
   * 가장 최근 판정을 쓴다. 색이 무엇을 근거로 하는지는 화면에 날짜로 적는다.
   */
  const activeBodyRecord = useMemo(
    () => bodyRecord ?? records.find((record) => record.recordType === "assessment"),
    [bodyRecord, records],
  );

  // 고른 판정 -> 부위별 위험. 판정이 없는 기록(수치만 적은 것)이면 색을 안 칠한다.
  const bodyRisks: RegionRisk[] | undefined = useMemo(() => {
    if (!activeBodyRecord || activeBodyRecord.recordType !== "assessment") return undefined;
    const payload = activeBodyRecord.payload as unknown as {
      verdicts?: { key: string; name?: string; risk_level: string }[];
      levels?: Record<string, string>;
    };
    // `verdicts` 가 생기기 전에 남긴 기록도 있다. 그때는 등급만 남아 있으므로
    // 그걸로 만든다 — 이름이 없어도 부위는 키로 정해진다.
    const verdicts =
      payload.verdicts ??
      Object.entries(payload.levels ?? {}).map(([key, risk_level]) => ({ key, risk_level }));
    const risks = regionRisks(verdicts);
    return risks.length > 0 ? risks : undefined;
  }, [activeBodyRecord]);

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === (routeProfileId ?? selectedProfileId)) ?? profiles[0],
    [profiles, routeProfileId, selectedProfileId],
  );

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
    const timeout = window.setTimeout(() => void refreshDashboard(selectedProfile.id), 0);
    return () => window.clearTimeout(timeout);
  }, [refreshDashboard, selectedProfile]);

  // 판정 요약은 구성원 목록이 바뀔 때만 다시 읽는다. 판정 화면에서 돌아오면 라우트가
  // 갈리면서 이 화면이 다시 서므로 최신값이 따라온다.
  // 취소 깃발을 두는 이유는 구성원을 빠르게 더했을 때 **먼저 띄운 조회가 늦게 돌아와**
  // 지운 사람의 요약을 되살리는 것을 막기 위해서다.
  const profileIds = useMemo(() => profiles.map((profile) => profile.id).join(","), [profiles]);
  useEffect(() => {
    if (!runtime || !profileIds) return;
    let cancelled = false;
    void listLatestByProfile(runtime, profileIds.split(","))
      .then((found) => {
        if (!cancelled) setVerdicts(found);
      })
      .catch((caught: unknown) => {
        // 카드 위 요약이 못 뜨는 것뿐이라 화면 전체를 막지 않는다. 다만 조용히
        // 넘기지도 않는다 — 보관함이 깨졌다는 신호일 수 있다.
        if (!cancelled) {
          setActionError(messageFrom(caught, "구성원별 최근 판정을 불러오지 못했습니다."));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [runtime, profileIds]);

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

  async function purgeDeletedHealthRecord(record: HealthRecord) {
    setActionError(undefined);
    setSaving(true);
    try {
      await purgeHealthRecord(record.id, record.version);
      setPurgingRecord(undefined);
      await refreshDashboard(record.profileId);
      if (deletedRecords.length === 1) setDeletedRecordsDialogOpen(false);
    } catch (caught) {
      setActionError(messageFrom(caught, "건강기록을 영구 삭제하지 못했습니다."));
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

      {/* 챌린지 요약. 로그인 전이거나 서버가 안 붙으면 스스로 아무것도 안 그린다. */}
      <ChallengeDashboardCard />

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
                className={profile.id === selectedProfile?.id ? "member-card is-selected" : "member-card"}
                key={profile.id}
                type="button"
                role="listitem"
                aria-pressed={profile.id === selectedProfile?.id}
                onClick={() => {
                  setSelectedProfileId(profile.id);
                  void navigate(`/members/${profile.id}`);
                }}
              >
                <span className={`member-avatar avatar-tone-${index % 4}`} aria-hidden="true">
                  {profile.displayName.slice(0, 1)}
                </span>
                <span className="member-card-copy">
                  <strong>{profile.displayName}</strong>
                  <small>{profile.relationship}{profile.birthDate ? ` · ${profile.birthDate.slice(0, 4)}년생` : ""}</small>
                </span>
                <MemberVerdict summary={verdicts[profile.id]} />
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
                <button className="primary-button" type="button" onClick={() => setRecordChoiceOpen(true)}>
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

            <Suspense fallback={<div className="body-map-loading">3D 인체 미리보기를 준비하는 중…</div>}>
              <VanatomeBodyMap
                profileName={selectedProfile.displayName}
                risks={bodyRisks}
                risksAt={activeBodyRecord ? formatDateTime(activeBodyRecord.recordedAt) : undefined}
              />
            </Suspense>

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
                  {/* 기록으로 들어가는 문 셋이 모두 같은 갈림길을 지난다. 하나만
                      곧장 폼을 열면 어느 버튼을 눌렀느냐에 따라 다른 일이 벌어진다. */}
                  <button className="text-button" type="button" onClick={() => setRecordChoiceOpen(true)}>
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
                        <RecordSummary record={record} />
                      </div>
                      <time dateTime={record.recordedAt}>{formatDateTime(record.recordedAt)}</time>
                      <div className="record-row-actions">
                        {/* 판정은 그날 화면에 뜬 값을 그대로 남긴 것이라 고칠 것이 아니다.
                            손으로 고치면 그날 본 것과 기록이 어긋난다. 그래서 열어 보기만 한다. */}
                        {record.recordType === "assessment" ? (
                          <button
                            type="button"
                            aria-pressed={activeBodyRecord?.id === record.id}
                            onClick={() => {
                              setBodyRecord(record);
                              setOpenRecord(record);
                            }}
                          >
                            자세히
                          </button>
                        ) : (
                          <button type="button" onClick={() => {
                            setActionError(undefined);
                            setEditingRecord(record);
                            void navigate(`/members/${selectedProfile.id}/records/${record.id}`);
                          }}>수정</button>
                        )}
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
          </div>

          <aside className="quick-actions-panel">
            <p className="section-kicker">빠른 작업</p>
            <h2>무엇을 기록할까요?</h2>
            <button type="button" onClick={() => setRecordChoiceOpen(true)}>
              <strong>건강기록 작성</strong>
              <small>직접 적거나, 검진표를 올려 판정까지</small>
            </button>
            <button type="button" onClick={() => {
              setFamilyHistoryDialogOpen(true);
              void navigate(`/members/${selectedProfile.id}/family-history`);
            }}>
              <strong>가족력 관리</strong>
              <small>구성원별 질환·친족 정보</small>
            </button>
            <NavLink to="/data">
              <strong>암호화 백업</strong>
              <small>파일로 내보내기·가져오기</small>
            </NavLink>
          </aside>
        </section>
      ) : null}

      {profileDialogOpen ? (
        <Modal kicker="이 기기에 저장" title="가족 구성원 로컬 프로필 만들기" onClose={() => setProfileDialogOpen(false)}>
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

      {openRecord ? (
        <Suspense fallback={null}>
          <RecordDetail record={openRecord} onClose={() => setOpenRecord(undefined)} />
        </Suspense>
      ) : null}

      {recordChoiceOpen && selectedProfile ? (
        <Modal kicker="이 기기에 저장" title={`${selectedProfile.displayName}님의 기록을 어떻게 남길까요?`} onClose={() => setRecordChoiceOpen(false)}>
          <div className="record-choice">
            <button
              className="record-choice-card"
              type="button"
              onClick={() => {
                setRecordChoiceOpen(false);
                setRecordDialogOpen(true);
              }}
            >
              <strong>직접 작성</strong>
              <small>혈압을 재거나 통증이 있었던 날처럼, 짧게 적어 두는 기록이에요.</small>
              <span className="record-choice-meta">종류 · 시각 · 내용</span>
            </button>

            <button
              className="record-choice-card is-primary"
              type="button"
              onClick={() => {
                setRecordChoiceOpen(false);
                // 판정 화면이 문서 패널을 열고, 이 구성원을 골라 둔 채로 시작한다.
                void navigate("/assessment", {
                  state: { withDocument: true, profileId: selectedProfile.id },
                });
              }}
            >
              <strong>검진표 올려서 판정</strong>
              <small>
                건강검진 결과지를 올리면 표에서 수치를 읽어 판정 폼을 채워요. 원본을 옆에 두고 고친 뒤 예측하면
                결과와 수치가 함께 기록으로 남습니다.
              </small>
              <span className="record-choice-meta">이미지 · PDF · 7~20초</span>
            </button>

            {/* 대화로 남기는 길. 앞의 둘과 성격이 다르다 — 무엇을 적을지 정하지 않고
                "어제 30분 걸었어" 처럼 말하면 비서가 종류와 칸을 골라 준다. 폼을
                채우기 어려운 사람에게는 이쪽이 유일하게 끝까지 가는 길이다. */}
            <button
              className="record-choice-card"
              type="button"
              onClick={() => {
                setRecordChoiceOpen(false);
                setAssistantOpen(true);
              }}
            >
              <strong>봄이와 대화로</strong>
              <small>
                “어제 30분 걸었어”, “아침 혈압 130에 85” 처럼 말하면 비서가 종류를 고르고 빠진 칸을 되물어 기록으로
                남겨요. 검진표 사진도 대화 안에서 올릴 수 있어요.
              </small>
              <span className="record-choice-meta">운동 · 혈압 · 혈당 · 복약 · 통증</span>
            </button>
          </div>
          <p className="form-notice">
            검진표 원본은 이 브라우저에 암호화해 보관합니다. 읽는 동안에만 서버를 거치고, 서버 데이터베이스에는
            남지 않습니다.
          </p>
        </Modal>
      ) : null}

      {recordDialogOpen && selectedProfile ? (
        <Modal kicker="이 기기에 저장" title={`${selectedProfile.displayName}님의 건강기록 작성`} onClose={() => setRecordDialogOpen(false)}>
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

      {editingRecord ? (
        <Modal kicker="이 기기에 저장" title="건강기록 수정" onClose={() => {
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
        <Modal kicker="이 기기에 저장" title="건강기록을 삭제할까요?" onClose={() => setDeletingRecord(undefined)}>
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
        <Modal kicker="이 기기에 저장" title="삭제된 건강기록" onClose={() => setDeletedRecordsDialogOpen(false)}>
          <div className="hidden-profiles-content">
            <p className="form-notice">삭제한 기록은 대시보드 집계에서 제외되며 이 브라우저에서 복원할 수 있습니다.</p>
            {actionError ? <div className="alert error-alert" role="alert">{actionError}</div> : null}
            <div className="hidden-profile-list">
              {deletedRecords.map((record) => (
                <article className="hidden-profile-row" key={record.id}>
                  <div><strong>{RECORD_LABELS[record.recordType]}</strong><small>{formatDateTime(record.recordedAt)} · {recordNote(record)}</small></div>
                  {purgingRecord?.id === record.id ? (
                    <div className="record-purge-confirm">
                      <span>되돌릴 수 없어요.</span>
                      <button className="danger-button" type="button" disabled={saving} onClick={() => void purgeDeletedHealthRecord(record)}>
                        영구 삭제
                      </button>
                      <button className="text-button" type="button" disabled={saving} onClick={() => setPurgingRecord(undefined)}>
                        취소
                      </button>
                    </div>
                  ) : (
                    <div className="record-row-actions">
                      <button className="secondary-button" type="button" disabled={saving} onClick={() => void restoreDeletedHealthRecord(record)}>복원</button>
                      <button className="text-button" type="button" disabled={saving} onClick={() => setPurgingRecord(record)}>영구 삭제</button>
                    </div>
                  )}
                </article>
              ))}
            </div>
          </div>
        </Modal>
      ) : null}

      {profileEditDialogOpen && selectedProfile ? (
        <Modal kicker="이 기기에 저장" title={`${selectedProfile.displayName} 프로필 관리`} onClose={() => setProfileEditDialogOpen(false)}>
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
        <Modal kicker="이 기기에 저장" title="숨긴 프로필 관리" onClose={() => setHiddenProfilesDialogOpen(false)}>
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

      {/* 건강 비서 "봄이". 대화로 기록을 남기고 서류를 읽는다. 프로필이 있어야
          누구의 기록인지 정해지므로 그때만 띄운다. */}
      {selectedProfile && runtime ? (
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
          {assistantOpen ? (
            <Suspense fallback={null}>
              <HealthAssistantDrawer
                // 구성원을 바꾸면 대화를 새로 연다. 인사말이 초기 상태라 effect 로
                // 되맞추지 않고 이 한 줄로 끝낸다 — 남의 대화가 남아 있으면 안 된다.
                key={selectedProfile.id}
                profile={selectedProfile}
                runtime={runtime}
                isOpen={assistantOpen}
                onClose={() => setAssistantOpen(false)}
                onRecordSaved={() => refreshDashboard(selectedProfile.id)}
                onNavigateToRecords={() => setDeletedRecordsDialogOpen(false)}
              />
            </Suspense>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

const LEVEL_TONE: Record<string, string> = {
  VERY_HIGH: "tone-very-high",
  HIGH: "tone-high",
  CAUTION: "tone-caution",
  NORMAL: "tone-normal",
  INSUFFICIENT_DATA: "tone-unknown",
};

/**
 * 구성원 카드 아래 한 줄 — 가장 최근 판정.
 *
 * **판정이 없는 사람도 자리를 비우지 않는다.** 빈 칸으로 두면 카드 높이가 들쭉날쭉해
 * 목록이 흔들리고, "아직 안 했다"는 사실 자체가 사용자가 봐야 할 정보다.
 */
function MemberVerdict({ summary }: { summary?: LatestSummary }) {
  if (!summary) {
    return <span className="member-verdict is-empty">판정 기록 없음</span>;
  }
  const level = summary.highestLevel as RiskLevel;
  return (
    <span className={`member-verdict ${LEVEL_TONE[summary.highestLevel] ?? "tone-unknown"}`}>
      <strong>{LEVEL_LABEL[level] ?? summary.highestLevel}</strong>
      {summary.needsAttention > 0 ? <span>주의 {summary.needsAttention}개</span> : <span>주의 없음</span>}
      <small>{formatDate(summary.recordedAt)}</small>
    </span>
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

function toLocalDateTime(value: string): string {
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
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
