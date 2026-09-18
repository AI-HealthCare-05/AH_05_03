import { lazy, Suspense, type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";

import { useLocalDomain } from "../../../app/localDomainContext";
import { BirthDateInput } from "../../../shared/ui/BirthDateInput";
import { Modal } from "../../../shared/ui/Modal";
import { ListRowsSkeleton, MemberListSkeleton } from "../../../shared/ui/Skeleton";
import { RecordSummary } from "../../home/RecordSummary";
import { RecordCard } from "../../home/RecordCard";
import { recordTypeLabel, recordSummary } from "../../../shared/local/recordSummary";
import type {
  DashboardSummary,
  FamilyProfile,
  Gender,
  HealthRecord,
  HealthRecordType,
} from "../../../shared/local/domainContracts";
import { LEVEL_LABEL, type RiskLevel } from "../../assessment/contracts";
import { type LatestSummary, listLatestByProfile } from "../../assessment/snapshots";
import { regionRisks, type RegionRisk } from "../../home/bodyRisk";
import { FamilyHistoryManager } from "../../home/FamilyHistoryManager";
import { FamilyIntegratedMonitoring } from "../../home/FamilyIntegratedMonitoring";
import { serverApiClient } from "../../../shared/api/serverApiClient";
import { useHouseholdEventStream } from "../../sync/useHouseholdEventStream";
import { VariantBar } from "../components/VariantBar";
import "../styles/shadcn-preview.css";
import "../styles/shadcn-preview-variants.css";

const RecordDetail = lazy(() => import("../../home/RecordDetail").then((m) => ({ default: m.RecordDetail })));
const VanatomeBodyMap = lazy(() => import("../../home/VanatomeBodyMap").then((m) => ({ default: m.VanatomeBodyMap })));

const RECORD_TYPES: HealthRecordType[] = [
  "blood_pressure",
  "blood_glucose",
  "body_measurement",
  "lab_result",
  "health_screening",
  "pain",
  "walking",
  "exercise",
  "medication",
  "sleep",
  "daily_condition",
  "vaccination",
  "note",
];

const RELATIONSHIPS = ["본인", "배우자", "자녀", "부모", "형제·자매", "기타"];

export function UiPreview5Page() {
  const navigate = useNavigate();
  const location = useLocation();
  const { profileId: routeProfileId, recordId: routeRecordId } = useParams();
  const {
    runtime,
    householdId,
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
  const [familyRecords, setFamilyRecords] = useState<HealthRecord[]>([]);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [loadedProfileId, setLoadedProfileId] = useState<string>();
  const [recordChoiceOpen, setRecordChoiceOpen] = useState(false);
  const [verdicts, setVerdicts] = useState<Record<string, LatestSummary>>({});
  const [openRecord, setOpenRecord] = useState<HealthRecord>();
  const [bodyRecord, setBodyRecord] = useState<HealthRecord>();
  const [highlightOrganKey, setHighlightOrganKey] = useState<string>();
  const [highlightPainIntensity, setHighlightPainIntensity] = useState<number>();
  const [highlightOrganIntensities, setHighlightOrganIntensities] = useState<Record<string, number>>();
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

  const listedRecords = useMemo(() => {
    const docLinked = new Set(
      records.filter((record) => record.recordType !== "assessment" && record.sourceDocumentId).map((r) => r.sourceDocumentId),
    );
    return records.filter((record) => {
      if (record.recordType !== "assessment") return true;
      const payload = record.payload as { sourceRecordId?: string };
      if (payload.sourceRecordId && records.some((item) => item.id === payload.sourceRecordId)) return false;
      if (record.sourceDocumentId && docLinked.has(record.sourceDocumentId)) return false;
      return true;
    });
  }, [records]);

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
        setLoadedProfileId(profileId);
        setActionError(undefined);
      } catch (caught) {
        setActionError(messageFrom(caught, "건강 대시보드를 불러오지 못했습니다."));
      } finally {
        setDashboardLoading(false);
      }

      void listLatestByProfile(runtime, [profileId])
        .then((latest) => setVerdicts((prev) => ({ ...prev, ...latest })))
        .catch(() => {});

      if (profiles.length > 0) {
        void Promise.all(
          profiles.map((p) => runtime.healthRecords.query({ profileId: p.id, includeDeleted: false })),
        )
          .then((results) => {
            const combined = results.flatMap((res) => (res.ok ? res.value : []));
            setFamilyRecords(combined);
          })
          .catch((err) => {
            console.warn("[UiPreview5Page] Failed to sync family records:", err);
          });
      }
    },
    [runtime, profiles],
  );

  const refreshFamilyRecords = useCallback(
    async (familyProfiles: FamilyProfile[]) => {
      if (!runtime || familyProfiles.length === 0) return;
      try {
        const results = await Promise.all(
          familyProfiles.map((p) =>
            runtime.healthRecords.query({ profileId: p.id, includeDeleted: false }),
          ),
        );
        const combined = results.flatMap((res) => (res.ok ? res.value : []));
        setFamilyRecords(combined);
      } catch (err) {
        console.warn("[UiPreview5Page] Failed to load family records for monitoring:", err);
      }
    },
    [runtime],
  );

  const activeBodyRecord = useMemo(
    () => bodyRecord ?? records.find((record) => record.recordType === "assessment"),
    [bodyRecord, records],
  );

  const bodyRisks: RegionRisk[] | undefined = useMemo(() => {
    if (!activeBodyRecord || activeBodyRecord.recordType !== "assessment") return undefined;
    const payload = activeBodyRecord.payload as unknown as {
      verdicts?: { key: string; name?: string; risk_level: string }[];
      levels?: Record<string, string>;
    };
    const riskVerdicts =
      payload.verdicts ??
      Object.entries(payload.levels ?? {}).map(([key, risk_level]) => ({ key, risk_level }));
    const risks = regionRisks(riskVerdicts);
    return risks.length > 0 ? risks : undefined;
  }, [activeBodyRecord]);

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === (routeProfileId ?? selectedProfileId)) ?? profiles[0],
    [profiles, routeProfileId, selectedProfileId],
  );

  useEffect(() => {
    setHighlightOrganKey(undefined);
    setBodyRecord(undefined);
  }, [selectedProfile?.id]);

  useEffect(() => {
    if (!runtime || !routeRecordId) return;
    void runtime.healthRecords.get(routeRecordId).then((result) => {
      if (result.ok && !result.value.deletedAt) setEditingRecord(result.value);
    });
  }, [routeRecordId, runtime]);

  const familyHistoryDialogVisible = familyHistoryDialogOpen
    || Boolean(routeProfileId && location.pathname.endsWith("/family-history"));

  const activeProfileId = selectedProfile?.id;
  useEffect(() => {
    if (!activeProfileId) return;
    const timeout = window.setTimeout(() => void refreshDashboard(activeProfileId), 0);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [refreshDashboard, activeProfileId]);

  useEffect(() => {
    if (profiles.length > 0) {
      void refreshFamilyRecords(profiles);
    }
  }, [profiles, refreshFamilyRecords]);

  useHouseholdEventStream({
    serverClient: serverApiClient,
    householdId,
    onRecordEvent: () => {
      const targetId = selectedProfile?.id;
      if (targetId) void refreshDashboard(targetId);
      if (profiles.length > 0) void refreshFamilyRecords(profiles);
    },
  });

  const profileIds = useMemo(() => profiles.map((profile) => profile.id).join(","), [profiles]);
  useEffect(() => {
    if (!runtime || !profileIds) return;
    let cancelled = false;
    void listLatestByProfile(runtime, profileIds.split(","))
      .then((found) => {
        if (!cancelled) setVerdicts(found);
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setActionError(messageFrom(caught, "구성원별 최근 판정을 불러오지 못했습니다."));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [runtime, profileIds]);

  const handleSelectOrgan = useCallback(
    (
      key?: string,
      _label?: string,
      intensity?: number,
      organIntensities?: Record<string, number>,
    ) => {
      const nextKey = key || undefined;
      setHighlightOrganKey((prev) => (prev !== nextKey ? nextKey : prev));
      setHighlightPainIntensity((prev) => (prev !== intensity ? intensity : prev));
      setHighlightOrganIntensities((prev) => {
        if (!prev && !organIntensities) return prev;
        if (prev && organIntensities && Object.keys(prev).length === Object.keys(organIntensities).length) {
          let same = true;
          for (const [k, v] of Object.entries(organIntensities)) {
            if (prev[k] !== v) {
              same = false;
              break;
            }
          }
          if (same) return prev;
        }
        return organIntensities;
      });
    },
    [],
  );

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
        gender: optionalGender(form.get("gender")),
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
        gender: optionalGender(form.get("gender")),
        accountEmail: selectedProfile.accountEmail,
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
    <div className="shadcn-preview-root sp-v5-container">
      {/* 4K 시안 전환 바 */}
      <VariantBar current="v5" />

      {/* 헤더 GNB */}
      <header className="sp-header">
        <div className="sp-header-inner">
          <div className="sp-brand">
            <div className="sp-brand-logo">
              <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                <path d="M16 28C16 28 4 20 4 11.5C4 7.5 7.5 4 11.5 4C13.8 4 15.3 5.2 16 6.2C16.7 5.2 18.2 4 20.5 4C24.5 4 28 7.5 28 11.5C28 20 16 28 16 28Z" stroke="#1d4fb8" strokeWidth="2.5" />
                <circle cx="11.5" cy="12.5" r="1.8" fill="#1d4fb8" />
                <circle cx="20.5" cy="12.5" r="1.8" fill="#1d4fb8" />
                <path d="M13.5 16.5C14.2 17.3 15.1 17.8 16 17.8C16.9 17.8 17.8 17.3 18.5 16.5" stroke="#1d4fb8" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </div>
            <div>
              <span className="sp-brand-title">이어봄</span>
              <span className="sp-brand-slogan">시안 5: 메인 실측 여백없는 와이드 뷰</span>
            </div>
          </div>

          <nav className="sp-nav">
            <button type="button" className="sp-nav-item active">가족 홈</button>
            <button type="button" className="sp-nav-item" onClick={() => void navigate("/assessment")}>질환 예측</button>
            <button type="button" className="sp-nav-item" onClick={() => void navigate("/pain-diary")}>통증 다이어리</button>
            <button type="button" className="sp-nav-item" onClick={() => void navigate("/health-data")}>건강 데이터</button>
          </nav>
        </div>
      </header>

      <div className="sp-v5-content">
        {/* 상단 통합 배너 (타이틀 & 액션 & 실측 메트릭) */}
        <header className="sp-v5-top-banner">
          <div className="sp-v5-title-zone">
            <p className="page-kicker">가족 홈 · 43인치 무여백 와이드 실측 뷰</p>
            <h1>우리 가족의 건강기록</h1>
            <p>
              {(!loading && profiles.length === 0
                ? "가족 구성원을 등록하면 그 사람의 기록과 판정이 여기에 쌓입니다."
                : "구성원을 고르면 그 사람의 기록과 판정이 이어집니다.") +
                " (실측 데이터 및 실제 서비스 컴포넌트 100% 연동)"}
            </p>
          </div>

          <div className="sp-v5-top-actions">
          {hiddenProfiles.length > 0 ? (
            <button
              className="secondary-button compact-button"
              type="button"
              onClick={() => {
                setActionError(undefined);
                setHiddenProfilesDialogOpen(true);
              }}
            >
              숨긴 프로필 {hiddenProfiles.length}명
            </button>
          ) : null}
          {selectedProfile ? (
            <>
              <button
                className="secondary-button"
                type="button"
                onClick={() => {
                  setActionError(undefined);
                  setProfileEditDialogOpen(true);
                }}
              >
                프로필 관리
              </button>
              <button
                className="secondary-button"
                type="button"
                onClick={() => {
                  setActionError(undefined);
                  setFamilyHistoryDialogOpen(true);
                }}
              >
                가족력 관리
              </button>
              <button
                className="primary-button"
                type="button"
                onClick={() => setRecordChoiceOpen(true)}
              >
                + 새 기록 작성
              </button>
            </>
          ) : null}
        </div>
      </header>

      {error ? <div className="alert error-alert" role="alert">{error}</div> : null}
      {actionError && !profileLifecycleAction && !hiddenProfilesDialogOpen ? (
        <div className="alert error-alert" role="alert">{actionError}</div>
      ) : null}

      {/* 가족 구성원 가로 전개 풀 와이드 스트립 */}
      <section className="sp-v5-member-strip-wrapper" aria-labelledby="v5-members-heading">
        <div className="sp-v5-member-strip-header">
          <h2 id="v5-members-heading">가족 구성원 선택</h2>
          <span style={{ fontSize: "13px", color: "#64748b" }}>
            클릭하여 해당 구성원의 실시간 대시보드 및 3D 신체 상태를 확인하세요.
          </span>
        </div>

        {loading ? <MemberListSkeleton /> : null}
        {!loading && profiles.length === 0 ? (
          <EmptyHousehold
            disabled={!localStorageReady}
            onCreate={() => setProfileDialogOpen(true)}
          />
        ) : null}
        {profiles.length > 0 ? (
          <div className="sp-v5-member-grid" role="list">
            {profiles.map((profile, index) => (
              <button
                className={profile.id === selectedProfile?.id ? "member-card is-selected" : "member-card"}
                key={profile.id}
                type="button"
                role="listitem"
                aria-pressed={profile.id === selectedProfile?.id}
                onClick={() => {
                  setSelectedProfileId(profile.id);
                  setHighlightOrganKey(undefined);
                  setBodyRecord(undefined);
                }}
              >
                <span className={`member-avatar avatar-tone-${index % 4}`} aria-hidden="true">
                  {profile.displayName.slice(0, 1)}
                </span>
                <span className="member-card-copy">
                  <strong>{profile.displayName}</strong>
                  <small>{formatProfileDescription(profile)}</small>
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
                <small>새 프로필 등록</small>
              </span>
            </button>
          </div>
        ) : null}
      </section>

      {/* 선택된 구성원 정보 & 핵심 지표 인라인 바 */}
      {selectedProfile ? (
        <div className="sp-v5-selected-bar">
          <div>
            <h2>{selectedProfile.displayName}님의 건강 현황</h2>
          </div>
          <div className="sp-v5-metric-bar">
            <MetricCard label="저장된 기록" value={`${summary?.totalRecords ?? 0}건`} />
            <MetricCard
              label="최근 기록"
              value={summary?.latestRecordedAt ? formatDate(summary.latestRecordedAt) : "아직 없음"}
            />
            <MetricCard label="프로필 상태" value="안전" tone="safe" />
          </div>
        </div>
      ) : null}

      {/* 43인치 2열 고밀도 메인 워크스페이스:
          좌측 (62%): 실제 <FamilyIntegratedMonitoring /> + 실제 <div className="records-panel">
          우측 (38% Sticky): 실제 <VanatomeBodyMap /> 3D 인체 해부도 + 판정 세부 정보 */}
      {selectedProfile ? (
        <main className="sp-v5-main-workspace">
          {/* 좌측 메인 열: 모니터링 & 기록 */}
          <div className="sp-v5-left-col">
            {/* 1. 실제 가족 통합 모니터링 컴포넌트 */}
            <FamilyIntegratedMonitoring
              profiles={profiles}
              selectedProfileId={selectedProfile.id}
              onSelectProfile={(id) => {
                setSelectedProfileId(id);
                setHighlightOrganKey(undefined);
                setHighlightPainIntensity(undefined);
                setHighlightOrganIntensities(undefined);
                setBodyRecord(undefined);
              }}
              records={familyRecords.length > 0 ? familyRecords : records}
              onSelectOrgan={handleSelectOrgan}
            />

            {/* 2. 실제 최근 건강기록 패널 */}
            <section className="sp-v5-records-card">
              <div className="records-panel">
                <div className="panel-heading">
                  <div>
                    <h3>최근 건강기록</h3>
                    <p>저장된 실측 기록을 최신순으로 표시합니다.</p>
                  </div>
                  <div className="panel-heading-actions">
                    {deletedRecords.length > 0 ? (
                      <button
                        className="text-button"
                        type="button"
                        onClick={() => {
                          setActionError(undefined);
                          setDeletedRecordsDialogOpen(true);
                        }}
                      >
                        삭제된 기록 {deletedRecords.length}건
                      </button>
                    ) : null}
                    {dashboardLoading ? <span className="subtle-status">불러오는 중…</span> : null}
                  </div>
                </div>

                {loadedProfileId !== selectedProfile.id && records.length === 0 ? (
                  <ListRowsSkeleton rows={3} label="최근 건강기록을 불러오는 중" />
                ) : records.length === 0 ? (
                  <div className="compact-empty">
                    <strong>아직 건강기록이 없습니다.</strong>
                    <p>검진 결과, 통증 변화나 건강 메모부터 남겨보세요.</p>
                    <button className="text-button" type="button" onClick={() => setRecordChoiceOpen(true)}>
                      첫 기록 작성하기
                    </button>
                  </div>
                ) : (
                  <ul className="record-list">
                    {listedRecords.slice(0, 6).map((record) => (
                      <RecordCard
                        key={record.id}
                        record={record}
                        pressed={activeBodyRecord?.id === record.id}
                        summary={record.recordType === "assessment" ? <RecordSummary record={record} /> : undefined}
                        onOpen={() => {
                          setActionError(undefined);
                          if (record.recordType === "assessment") setBodyRecord(record);
                          setOpenRecord(record);
                        }}
                      />
                    ))}
                  </ul>
                )}
              </div>
            </section>
          </div>

          {/* 우측 열 (Sticky): 3D 인체 해부도 & 판정 현황 */}
          <aside className="sp-v5-right-col" aria-label="3D 인체 해부도 및 부위 판정">
            <div className="sp-v5-sticky-body-card">
              <Suspense fallback={<div className="body-map-loading">3D 인체 미리보기를 준비하는 중…</div>}>
                <VanatomeBodyMap
                  key={`${selectedProfile.id}-${selectedProfile.gender}`}
                  profileName={selectedProfile.displayName}
                  gender={selectedProfile.gender}
                  risks={bodyRisks}
                  risksAt={activeBodyRecord ? formatDateTime(activeBodyRecord.recordedAt) : undefined}
                  highlightOrganKey={highlightOrganKey}
                  highlightPainIntensity={highlightPainIntensity}
                  highlightOrganIntensities={highlightOrganIntensities}
                />
              </Suspense>
            </div>

            {/* 현재 연동된 판정 또는 신체 부위 상태 요약 카드 */}
            {activeBodyRecord ? (
              <div className="sp-v5-active-record-card">
                <h3>연동 판정 근거</h3>
                <div className="sp-v5-active-record-meta">
                  <span>기준 일시: {formatDateTime(activeBodyRecord.recordedAt)}</span>
                  <span>•</span>
                  <span>{activeBodyRecord.sourceDocumentId ? "검진표 OCR 연동" : "수기/직접 작성"}</span>
                </div>
                {bodyRisks && bodyRisks.length > 0 ? (
                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "10px" }}>
                    {bodyRisks.map((r) => (
                      <span
                        key={r.region}
                        style={{
                          background: r.level === "VERY_HIGH" || r.level === "HIGH" ? "#fee2e2" : "#fef3c7",
                          color: r.level === "VERY_HIGH" || r.level === "HIGH" ? "#b91c1c" : "#b45309",
                          padding: "4px 10px",
                          borderRadius: "6px",
                          fontSize: "12px",
                          fontWeight: 700,
                        }}
                      >
                        {r.label}: {LEVEL_LABEL[r.level as RiskLevel] ?? r.level}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p style={{ margin: "6px 0 0", fontSize: "13px", color: "#64748b" }}>
                    현재 표시 중인 판정에 특이 위험 장기가 감지되지 않았습니다.
                  </p>
                )}
              </div>
            ) : null}
          </aside>
        </main>
      ) : null}
      </div>

      {/* 모든 실제 모달 다이얼로그 (생성, 수정, 삭제, 복원 등) */}
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
              성별
              <select name="gender" defaultValue="">
                <option value="" disabled>남성 또는 여성</option>
                <option value="male">남성</option>
                <option value="female">여성</option>
              </select>
            </label>
            <BirthDateInput />
            <div className="form-actions">
              <button className="secondary-button" type="button" onClick={() => setProfileDialogOpen(false)}>취소</button>
              <button className="primary-button" type="submit" disabled={saving}>{saving ? "저장 중…" : "프로필 저장"}</button>
            </div>
          </form>
        </Modal>
      ) : null}

      {openRecord ? (
        <Suspense fallback={null}>
          <RecordDetail
            record={openRecord}
            onClose={() => setOpenRecord(undefined)}
            linkedAssessment={
              openRecord.recordType === "assessment"
                ? undefined
                : records.find(
                    (item) =>
                      item.recordType === "assessment" &&
                      ((item.payload as { sourceRecordId?: string }).sourceRecordId === openRecord.id ||
                        (Boolean(openRecord.sourceDocumentId) &&
                          item.sourceDocumentId === openRecord.sourceDocumentId)),
                  )
            }
            onViewPrediction={(assessment) => setOpenRecord(assessment)}
            onEdit={
              openRecord.recordType === "assessment"
                ? undefined
                : () => {
                    const target = openRecord;
                    setOpenRecord(undefined);
                    setActionError(undefined);
                    setEditingRecord(target);
                  }
            }
            onDelete={() => {
              const target = openRecord;
              setOpenRecord(undefined);
              setActionError(undefined);
              setDeletingRecord(target);
            }}
          />
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
                void navigate("/assessment", {
                  state: { withDocument: true, profileId: selectedProfile.id },
                });
              }}
            >
              <strong>검진표 올려서 판정</strong>
              <small>
                건강검진 결과지를 올리면 표에서 수치를 읽어 판정 폼을 채워요.
              </small>
              <span className="record-choice-meta">이미지 · PDF · 7~20초</span>
            </button>

            <button
              className="record-choice-card"
              type="button"
              onClick={() => {
                setRecordChoiceOpen(false);
                try {
                  localStorage.setItem("ieobom:global-assistant-open", "true");
                } catch {
                  // ignore
                }
                window.dispatchEvent(new CustomEvent("ieobom:open-assistant"));
              }}
            >
              <strong>봄이와 대화로</strong>
              <small>
                “어제 30분 걸었어”, “아침 혈압 130에 85” 처럼 말하면 비서가 기록으로 남겨요.
              </small>
              <span className="record-choice-meta">운동 · 혈압 · 혈당 · 복약 · 통증</span>
            </button>
          </div>
          <p className="form-notice">
            검진표 원본은 암호화해 보관됩니다. AI 문서 분석 결과를 원본과 대조한 뒤 확정할 수 있습니다.
          </p>
        </Modal>
      ) : null}

      {recordDialogOpen && selectedProfile ? (
        <Modal kicker="내 계정에 저장" title={`${selectedProfile.displayName}님의 건강기록 작성`} onClose={() => setRecordDialogOpen(false)}>
          <form className="product-form" onSubmit={submitHealthRecord}>
            <p className="form-notice">기록은 내 계정에 저장되고, 같은 가정 구성원만 볼 수 있습니다.</p>
            <label>
              기록 종류
              <select name="recordType" defaultValue="note" required>
                {RECORD_TYPES.map((value) => <option key={value} value={value}>{recordTypeLabel(value)}</option>)}
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
        <Modal kicker="이 기기에 저장" title="건강기록 수정" onClose={() => setEditingRecord(undefined)}>
          <form className="product-form" onSubmit={submitHealthRecordUpdate}>
            <label>
              기록 종류
              <select name="recordType" defaultValue={editingRecord.recordType} required>
                {RECORD_TYPES.map((value) => <option key={value} value={value}>{recordTypeLabel(value)}</option>)}
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
              <button className="secondary-button" type="button" onClick={() => setEditingRecord(undefined)}>취소</button>
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
                  <div><strong>{recordTypeLabel(record.recordType)}</strong><small>{formatDateTime(record.recordedAt)} · {recordNote(record)}</small></div>
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
              성별
              <select name="gender" defaultValue={selectedProfile.gender ?? ""}>
                <option value="" disabled>남성 또는 여성</option>
                <option value="male">남성</option>
                <option value="female">여성</option>
              </select>
            </label>
            <BirthDateInput defaultValue={selectedProfile.birthDate ?? ""} />
            {selectedProfile.accountEmail ? (
              <label>
                연동 계정 (Google)
                <input
                  type="text"
                  readOnly
                  disabled
                  defaultValue={selectedProfile.accountEmail}
                  style={{ opacity: 0.85, cursor: "not-allowed" }}
                />
              </label>
            ) : null}
            <div className="form-actions">
              <button className="secondary-button" type="button" onClick={() => setProfileEditDialogOpen(false)}>취소</button>
              <button className="primary-button" type="submit" disabled={saving}>{saving ? "저장 중…" : "변경사항 저장"}</button>
            </div>
          </form>

          <section className="profile-lifecycle-zone" aria-labelledby="v5-profile-lifecycle-heading">
            <h3 id="v5-profile-lifecycle-heading">프로필 정리</h3>
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
                    <small>{formatProfileDescription(profile)}</small>
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
        <FamilyHistoryManager
          runtime={runtime}
          profile={selectedProfile}
          onClose={() => setFamilyHistoryDialogOpen(false)}
        />
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

function MetricCard({ label, value, helper, tone }: { label: string; value: string; helper?: string; tone?: "safe" }) {
  return (
    <article className={tone === "safe" ? "metric-card is-safe" : "metric-card"}>
      <span>{label}</span>
      <strong>{value}</strong>
      {helper ? <small>{helper}</small> : null}
    </article>
  );
}

function optionalDate(value: FormDataEntryValue | null): `${number}-${number}-${number}` | undefined {
  const date = String(value ?? "");
  return date ? (date as `${number}-${number}-${number}`) : undefined;
}

function optionalGender(value: FormDataEntryValue | null): Gender | null {
  const str = String(value ?? "");
  return str === "male" || str === "female" ? str : null;
}

function formatProfileDescription(profile: FamilyProfile): string {
  const genderLabel = profile.gender === "male" ? "남성" : profile.gender === "female" ? "여성" : "";
  const birthYear = profile.birthDate ? `${profile.birthDate.slice(0, 4)}년생` : "";
  return [profile.relationship, genderLabel, birthYear].filter(Boolean).join(" · ");
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
  return recordSummary(record);
}
