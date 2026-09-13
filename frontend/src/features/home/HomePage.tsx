import { lazy, Suspense, type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";

import { useLocalDomain } from "../../app/localDomainContext";
import { BirthDateInput } from "../../shared/ui/BirthDateInput";
import { Modal } from "../../shared/ui/Modal";
import { ListRowsSkeleton, MemberListSkeleton } from "../../shared/ui/Skeleton";
// 모달은 눌러야 뜬다. 정적으로 두면 판정 카드 일체가 홈의 첫 청크에 실린다.
const RecordDetail = lazy(() => import("./RecordDetail").then((m) => ({ default: m.RecordDetail })));
import { RecordSummary } from "./RecordSummary";
import { RecordCard } from "./RecordCard";
import { recordTypeLabel } from "../../shared/local/recordSummary";
import type {
  DashboardSummary,
  FamilyProfile,
  Gender,
  HealthRecord,
  HealthRecordType,
} from "../../shared/local/domainContracts";
import { recordSummary } from "../../shared/local/recordSummary";
import { LEVEL_LABEL } from "../assessment/contracts";
import type { RiskLevel } from "../assessment/contracts";
import { type LatestSummary, listLatestByProfile } from "../assessment/snapshots";
import { regionRisks, type RegionRisk } from "./bodyRisk";
import { FamilyHistoryManager } from "./FamilyHistoryManager";

import { FamilyIntegratedMonitoring } from "./FamilyIntegratedMonitoring";
import { serverApiClient } from "../../shared/api/serverApiClient";
import { useHouseholdEventStream } from "../sync/useHouseholdEventStream";

const VanatomeBodyMap = lazy(() => import("./VanatomeBodyMap").then((module) => ({
  default: module.VanatomeBodyMap,
})));


/** 기록 작성 폼의 종류 보기. **이름은 여기서 정하지 않는다** — `recordTypeLabel`
 *  한 곳에서 온다. 예전에는 이 파일이 자기 이름표를 들고 있었고 이미 어긋나 있었다. */
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

export function HomePage() {
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

  // 전역 비서(채널톡)와 프로필 동기화
  useEffect(() => {
    if (selectedProfileId) {
      try {
        localStorage.setItem("ieobom:selected-profile-id", selectedProfileId);
      } catch {
        // ignore
      }
      window.dispatchEvent(new CustomEvent("ieobom:profile-changed", { detail: { profileId: selectedProfileId } }));
    }
  }, [selectedProfileId]);

  /**
   * 목록에 세울 기록. **판정은 자기 수치 기록에 매달려 있으면 빠진다.**
   *
   * 판정은 수치에서 나온 것이다. 둘을 나란히 두면 같은 일이 두 줄로 서고, 사용자가
   * 어느 쪽을 열어야 하는지 매번 고르게 된다. 수치 기록 하나만 세우고 판정은 그
   * 기록의 자세히에서 "예측 결과 보기" 로 연다.
   *
   * **고리가 없는 판정은 그대로 세운다.** 이 고리(`payload.sourceRecordId`)가 생기기
   * 전에 남긴 판정이 있고, 그것까지 숨기면 **어디에서도 열 수 없다.** 목록에서
   * 빼는 것과 데이터를 잃는 것은 다르다.
   */
  const listedRecords = useMemo(() => {
    const docLinked = new Set(
      records.filter((record) => record.recordType !== "assessment" && record.sourceDocumentId).map((r) => r.sourceDocumentId),
    );
    return records.filter((record) => {
      if (record.recordType !== "assessment") return true;
      const payload = record.payload as { sourceRecordId?: string };
      // 수치 기록을 가리키고 그 기록이 실제로 남아 있으면 목록에서 뺀다.
      if (payload.sourceRecordId && records.some((item) => item.id === payload.sourceRecordId)) return false;
      // 같은 검진표에서 나온 수치 기록이 있으면 그쪽에서 열린다.
      if (record.sourceDocumentId && docLinked.has(record.sourceDocumentId)) return false;
      return true;
    });
  }, [records]);
  const [deletedRecords, setDeletedRecords] = useState<HealthRecord[]>([]);
  const [familyRecords, setFamilyRecords] = useState<HealthRecord[]>([]);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  // **스켈레톤은 첫 한 번만.** `refreshDashboard` 는 기록을 쓰거나 봄이가 판정을
  // 남길 때마다 다시 도는데, 그때마다 목록을 스켈레톤으로 바꾸면 이미 읽고 있던
  // 화면이 깜빡인다(누르려던 버튼이 손밑에서 사라지기도 한다). 한 번 받아 본
  // 뒤에는 **이전 목록을 그대로 두고** 새 값이 오면 조용히 갈아 끼운다.
  const [loadedProfileId, setLoadedProfileId] = useState<string>();
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
  const [highlightOrganKey, setHighlightOrganKey] = useState<string>();
  const [highlightPainIntensity, setHighlightPainIntensity] = useState<number>();
  const [highlightOrganIntensities, setHighlightOrganIntensities] = useState<Record<string, number>>();
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
        setLoadedProfileId(profileId);
        setActionError(undefined);
      } catch (caught) {
        setActionError(messageFrom(caught, "건강 대시보드를 불러오지 못했습니다."));
      } finally {
        setDashboardLoading(false);
      }

      // **판정 요약(구성원 카드의 "매우 높음 주의 N개" 배지)도 같이 새로 읽는다.**
      // 예전에는 이 배지가 구성원 목록이 바뀔 때만 갱신됐다 — "판정 화면에서
      // 돌아오면 라우트가 갈리면서 다시 서니까" 라는 전제였는데, 그 전제가
      // 여기서는 깨진다. 봄이 대화는 이 페이지 **안에** 있어서 라우트가 안
      // 갈린다. 같은 페이지에서 대화로 판정을 남기면(문서 업로드 등) 기록
      // 목록은 새로 읽히는데 배지만 그대로였다.
      //
      // **`await` 하지 않는다.** 이걸 `refreshDashboard` 의 반환 Promise 에
      // 묶으면, 기록을 저장·수정·삭제하는 모든 호출부가 이 여분의 왕복까지
      // 끝나야 자기 할 일(모달 닫기 등)을 마친 것으로 친다 — 배지 하나 때문에
      // 본 동작이 늦어진다. 배지는 늦게 와도 된다.
      void listLatestByProfile(runtime, [profileId])
        .then((latest) => setVerdicts((prev) => ({ ...prev, ...latest })))
        .catch(() => {
          // 배지 하나 못 읽은 것으로 방금 갱신한 대시보드를 에러로 덮지 않는다.
        });

      // 가족 건강 통합 모니터링을 위해 전체 가족의 최신 기록도 함께 갱신한다.
      if (profiles.length > 0) {
        void Promise.all(
          profiles.map((p) => runtime.healthRecords.query({ profileId: p.id, includeDeleted: false })),
        )
          .then((results) => {
            const combined = results.flatMap((res) => (res.ok ? res.value : []));
            setFamilyRecords(combined);
          })
          .catch((err) => {
            console.warn("[HomePage] Failed to sync family records:", err);
          });
      }
    },
    [runtime, profiles, setActionError],
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
        console.warn("[HomePage] Failed to load family records for monitoring:", err);
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

  // 가족 구성원 목록이 초기화되거나 변경되면 전체 가족 기록을 모니터링용으로 로드한다.
  useEffect(() => {
    if (profiles.length > 0) {
      void refreshFamilyRecords(profiles);
    }
  }, [profiles, refreshFamilyRecords]);

  /**
   * 봄이(건강 비서 챗봇)나 다른 컴포넌트에서 기록이 저장되면 즉시 수신하여
   * 현재 활성 대시보드와 가족 통합 모니터링 타임라인을 새로고침한다.
   * (동일 탭 CustomEvent + 다른 브라우저 탭 BroadcastChannel 양방향 수신)
   */
  useEffect(() => {
    const handleRecordSaved = (e: Event) => {
      const customEvent = e as CustomEvent<{ profileId?: string }>;
      const targetId = customEvent.detail?.profileId || selectedProfile?.id;
      if (targetId) {
        void refreshDashboard(targetId);
      }
      if (profiles.length > 0) {
        void refreshFamilyRecords(profiles);
      }
    };
    window.addEventListener("ieobom:record-saved", handleRecordSaved);

    let channel: BroadcastChannel | undefined;
    try {
      channel = new BroadcastChannel("ieobom-sync");
      channel.onmessage = (event) => {
        if (event.data?.type === "record-saved") {
          const targetId = event.data.profileId || selectedProfile?.id;
          if (targetId) void refreshDashboard(targetId);
          if (profiles.length > 0) void refreshFamilyRecords(profiles);
        }
      };
    } catch {
      // BroadcastChannel 미지원 환경 무시
    }

    return () => {
      window.removeEventListener("ieobom:record-saved", handleRecordSaved);
      channel?.close();
    };
  }, [refreshDashboard, refreshFamilyRecords, selectedProfile?.id, profiles]);

  // 다른 가족 구성원의 기기(다른 PC/모바일)에서 작성된 기록을 실시간 SSE 스트림으로 수신
  useHouseholdEventStream({
    serverClient: serverApiClient,
    householdId,
    onRecordEvent: () => {
      const targetId = selectedProfile?.id;
      if (targetId) void refreshDashboard(targetId);
      if (profiles.length > 0) void refreshFamilyRecords(profiles);
    },
  });

  /**
   * 다른 탭·다른 기기에서 바뀐 것을 **돌아왔을 때** 따라잡는다.
   *
   * 정본은 PostgreSQL 이다(ADR-011). 이 탭이 열려 있는 동안 다른 탭이나 다른
   * 기기에서 기록을 남기면, 이 탭은 그 변화를 알 방법이 없다 — 소켓도 폴링도
   * 없다. `visibilitychange` 는 가장 값싼 절충이다: 사용자가 다른 창을 보다가
   * 이 탭으로 돌아오는 그 순간에만 다시 읽는다. 눈에 보이지 않을 때는 아무것도
   * 하지 않으므로 배터리·요청 비용이 거의 없다.
   */
  useEffect(() => {
    if (!selectedProfile) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void refreshDashboard(selectedProfile.id);
        if (profiles.length > 0) void refreshFamilyRecords(profiles);
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    // 탭 전환 없이 다른 앱 창에 있다가 돌아오는 경우도 있다 — `focus` 도 같이 듣는다.
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [refreshDashboard, refreshFamilyRecords, selectedProfile, profiles]);

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
      {/* **머리말 틀을 여기서만 반만 쓰고 있었다.** 나머지 네 화면
          (`HealthDataPage` · `DataManagementPage` · `AccountPage` ·
          `AssessmentPage`)은 `page-kicker` · `h1` · 설명 한 줄을 다 쓰는데
          홈만 설명줄을 빼고 슬로건 한 줄로 서 있었다 — 그 자리를 받으려고
          `.dashboard-heading > div > p:last-child` 가 이미 styles.css 에 있다.
          문장도 이 화면만 랜딩 카피였다("…이어보세요"). 다른 h1 은 전부 그
          화면이 하는 일을 평서로 말한다("구독과 가족 연결을 관리하세요",
          "{이름}님의 건강 변화"). 앱 안에 랜딩이 한 장 끼어 있는 것처럼
          보이던 이유가 글자 크기가 아니라 이 어투였다.

          **인원수는 적지 않는다.** 바로 아래 구성원 카드가 곧 그 수다 —
          머리말에 또 적으면 같은 것을 두 번 세는 자리가 된다.

          **"이 기기에만 저장" 도 쓰지 않는다.** ADR-011 이후 기록은 계정에
          저장된다. 아래 문장은 이 파일 안에서 이미 고쳐 둔 표현을 그대로
          쓴다(기록 작성 폼의 `form-notice`). */}
      <section className="dashboard-heading">
        <div>
          <p className="page-kicker">가족 홈</p>
          <h1>우리 가족의 건강기록</h1>
          {/* 빈 가정에 "구성원을 고르면" 이라고 할 수 없다. 다만 **받는 동안에는
              말하지 않는다** — `loading` 중의 `profiles.length === 0` 은 "없다"
              가 아니라 "아직 모른다" 다. */}
          <p>
            {(!loading && profiles.length === 0
              ? "가족 구성원을 등록하면 그 사람의 기록과 판정이 여기에 쌓입니다."
              : "구성원을 고르면 그 사람의 기록과 판정이 아래로 이어집니다.") +
              " 기록은 내 계정에 저장되고, 같은 가정 구성원만 볼 수 있습니다."}
          </p>
        </div>
      </section>

      {error ? <div className="alert error-alert" role="alert">{error}</div> : null}
      {actionError && !profileLifecycleAction && !hiddenProfilesDialogOpen ? <div className="alert error-alert" role="alert">{actionError}</div> : null}

      {/* **챌린지 요약을 여기서 뺐다.** 가족 홈이 답해야 하는 물음은 "누구의 기록을
          볼까" 하나인데, 나무·점수·물주기가 그 위에 앉아 첫 화면을 차지했다.
          챌린지는 전역 내비에 제 자리가 있으므로 길이 끊기지도 않는다. */}
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
            {/* 인원 수 배지("N명")를 뺐다. 바로 아래 카드가 곧 그 수라서 같은 것을
                두 번 세는 자리였다. `FamilyProfileSidebar` 는 카드가 접혀 있어
                그쪽에는 남는다. */}
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
                  setHighlightOrganKey(undefined);
                  setBodyRecord(undefined);
                  void navigate(`/members/${profile.id}`);
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
                <small>우리 가정에 새 프로필 만들기</small>
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
                <button className="secondary-button" type="button" onClick={() => {
                  setActionError(undefined);
                  setFamilyHistoryDialogOpen(true);
                  void navigate(`/members/${selectedProfile.id}/family-history`);
                }}>
                  가족력 관리
                </button>
              </div>
            </div>

            <div className="metric-grid">
              <MetricCard label="저장된 기록" value={`${summary?.totalRecords ?? 0}건`} />
              <MetricCard
                label="최근 기록"
                value={summary?.latestRecordedAt ? formatDate(summary.latestRecordedAt) : "아직 없음"}
              />
              <MetricCard label="프로필 상태" value="안전" tone="safe" />
            </div>

            <FamilyIntegratedMonitoring
              profiles={profiles}
              selectedProfileId={selectedProfile.id}
              onSelectProfile={(id) => {
                setSelectedProfileId(id);
                setHighlightOrganKey(undefined);
                setHighlightPainIntensity(undefined);
                setHighlightOrganIntensities(undefined);
                setBodyRecord(undefined);
                void navigate(`/members/${id}`);
              }}
              records={familyRecords.length > 0 ? familyRecords : records}
              onSelectOrgan={handleSelectOrgan}
            />

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
              {/* **"아직 없다" 가 먼저 떴다.** 기록을 받아오는 동안에도 `records` 는
                  빈 배열이라, 기록이 있는 사람에게도 "아직 건강기록이 없습니다" 가
                  한 번 스쳤다가 목록으로 바뀌었다. 없다는 말은 다 받아본 뒤에만
                  할 수 있다 — 이 구성원의 기록을 아직 한 번도 못 받아 봤을 때만
                  줄 자리를 잡아 두고, 그 뒤 갱신은 이전 목록을 둔 채로 한다. */}
              {loadedProfileId !== selectedProfile.id && records.length === 0 ? (
                <ListRowsSkeleton rows={3} label="최근 건강기록을 불러오는 중" />
              ) : records.length === 0 ? (
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
                  {/* **판정은 여기 서지 않는다.** 판정은 수치에서 나온 것이라, 수치
                      기록과 나란히 두면 같은 일이 두 줄로 보인다. 수치 기록의 자세히
                      안에서 "예측 결과 보기" 로 연다(`RecordValueDetail`).

                      고리가 없는 옛 판정은 그대로 세운다 — 숨기면 열 방법이 없다. */}
                  {listedRecords.slice(0, 5).map((record) => (
                    <RecordCard
                      key={record.id}
                      record={record}
                      pressed={activeBodyRecord?.id === record.id}
                      summary={record.recordType === "assessment" ? <RecordSummary record={record} /> : undefined}
                      onOpen={() => {
                        setActionError(undefined);
                        // 판정 기록은 3D 인체에 색도 입힌다. 다른 종류는 그 값이 없어
                        // 색을 바꾸지 않는다(`bodyRisks` 가 종류를 본다).
                        if (record.recordType === "assessment") setBodyRecord(record);
                        setOpenRecord(record);
                      }}
                    />
                  ))}
                </ul>
              )}
            </div>
          </div>
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
            /* 이 검진표에서 나온 판정. 같은 원본 서류를 가리키는 판정 기록이 있으면
               "예측하기" 대신 "예측 결과 보기" 가 선다 — 이미 판정한 것을 다시
               판정하게 만들면 같은 서류로 기록이 둘씩 쌓인다. */
            linkedAssessment={
              openRecord.recordType === "assessment"
                ? undefined
                : records.find(
                    (item) =>
                      item.recordType === "assessment" &&
                      // 수치 기록을 직접 가리키는 판정이 우선이다. 검진표 고리는
                      // 그 고리가 생기기 전에 남긴 기록을 위한 뒷문이다.
                      ((item.payload as { sourceRecordId?: string }).sourceRecordId === openRecord.id ||
                        (Boolean(openRecord.sourceDocumentId) &&
                          item.sourceDocumentId === openRecord.sourceDocumentId)),
                  )
            }
            onViewPrediction={(assessment) => setOpenRecord(assessment)}
            // 판정 기록은 고치지 않는다 — 그날 본 값을 그대로 남긴 것이다.
            // 그래서 그 종류에는 `onEdit` 을 넘기지 않고, 카드가 버튼을 안 그린다.
            onEdit={
              openRecord.recordType === "assessment"
                ? undefined
                : () => {
                    const target = openRecord;
                    setOpenRecord(undefined);
                    setActionError(undefined);
                    setEditingRecord(target);
                    if (selectedProfile) void navigate(`/members/${selectedProfile.id}/records/${target.id}`);
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
                “어제 30분 걸었어”, “아침 혈압 130에 85” 처럼 말하면 비서가 종류를 고르고 빠진 칸을 되물어 기록으로
                남겨요. 검진표 사진도 대화 안에서 올릴 수 있어요.
              </small>
              <span className="record-choice-meta">운동 · 혈압 · 혈당 · 복약 · 통증</span>
            </button>
          </div>
          {/* **양쪽 다 틀렸던 문구다.** "이 브라우저에 암호화해 보관" 도 사실이 아니다 —
              서버 런타임은 `documents: undefined` 로 문서 저장소를 아예 들지 않고
              (`serverDomainRuntime.ts`), `DocumentPane` 의 저장은 `if (runtime?.documents)`
              안에 있어서 실행되지 않는다. 원본은 브라우저에도 서버 DB에도 남지 않는다.
              고친 문구가 예전보다 오히려 강한 약속인데, 그것이 지금의 실제 동작이다. */}
          <p className="form-notice">
            검진표 원본은 어디에도 보관하지 않습니다. 읽어 들이는 동안에만 쓰고, 확정한 수치만 내 계정에
            남습니다.
          </p>
        </Modal>
      ) : null}

      {recordDialogOpen && selectedProfile ? (
        <Modal kicker="내 계정에 저장" title={`${selectedProfile.displayName}님의 건강기록 작성`} onClose={() => setRecordDialogOpen(false)}>
          <form className="product-form" onSubmit={submitHealthRecord}>
            {/* **"서버 API를 거치지 않고" 는 사실이 아니었다.** 이 폼은 `createHealthRecord`
                → `runtime.healthRecords.create` → 서버 API 로 간다(ADR-011). 문구만
                ADR-011 이전에 머물러 있었다. */}
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
        <Modal kicker="이 기기에 저장" title="건강기록 수정" onClose={() => {
          setEditingRecord(undefined);
          if (selectedProfile) void navigate(`/members/${selectedProfile.id}/records`);
        }}>
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
        <FamilyHistoryManager runtime={runtime} profile={selectedProfile} onClose={() => {
          setFamilyHistoryDialogOpen(false);
          void navigate(`/members/${selectedProfile.id}`);
        }} />
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

// **3칸이었다.** 실제 `.member-list` 는 4칸이라 기록이 도착하는 순간 칸 수가 바뀌며
// 화면이 한 번 튀었다. 같은 격자·같은 카드 높이로 그리면 자리가 미리 잡혀 튐이 없다.
function DashboardSkeleton() {
  return <MemberListSkeleton />;
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

/**
 * 목록에 적는 한 줄.
 *
 * **예전에는 `note` 가 없으면 "저장된 건강기록" 이라고 적었다.** 혈압 128/82 를
 * 남겨도 목록에는 아무 수치가 없었고, 같은 기록이 건강기록 화면에서는 값으로
 * 보여서 두 화면이 서로 다른 말을 했다. 읽는 방법은 `recordSummary` 한 곳에 있다.
 */
function recordNote(record: HealthRecord): string {
  return recordSummary(record);
}

