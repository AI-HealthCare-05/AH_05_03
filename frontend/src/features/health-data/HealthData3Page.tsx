import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { useLocalDomain } from "../../app/localDomainContext";
import { TREND_SERIES } from "../assessment/snapshots";
import { useHealthTimeSeries } from "../data/useHealthTimeSeries";
import type { ObservationPoint } from "../data/timeSeriesObservation";
import type { FamilyProfile, HealthRecord } from "../../shared/local/domainContracts";
import { recordSummary, recordTypeLabel } from "../../shared/local/recordSummary";
import { VariantBar } from "../ui-preview/components/VariantBar";
import { Modal } from "../../shared/ui/Modal";
import { serverApiClient } from "../../shared/api/serverApiClient";
import { FamilySharingSection } from "./FamilySharingSection";
import "../ui-preview/styles/shadcn-preview-variants.css";
import "../ui-preview/styles/health-data3.css";

type DataView = "overview" | "trends" | "family" | "records" | "sharing";

const DATA_VIEWS: { id: DataView; label: string; icon: "overview" | "trend" | "family" | "records" | "sharing" }[] = [
  { id: "overview", label: "종합 개요", icon: "overview" },
  { id: "trends", label: "지표 추이", icon: "trend" },
  { id: "family", label: "가족 비교", icon: "family" },
  { id: "records", label: "기록 근거", icon: "records" },
  { id: "sharing", label: "가족 공유 범위", icon: "sharing" },
];

function viewFromHash(hash: string): DataView {
  const id = hash.replace(/^#/, "");
  return DATA_VIEWS.some((view) => view.id === id) ? (id as DataView) : "overview";
}

type Period = "30d" | "90d" | "1y" | "all";

type MedicalDocumentPage = { id: string; page_order: number; original_filename: string; mime_type: string; plaintext_size: number };
type MedicalDocumentSet = {
  id: string;
  document_type: string;
  status: "draft" | "analysis_queued" | "analyzing" | "needs_review" | "analyzed" | "failed";
  examined_at: string | null;
  issued_at: string | null;
  analyzed_at: string | null;
  created_at: string;
  date_confidence: "unknown" | "needs_review" | "confirmed";
  pages: MedicalDocumentPage[];
};
type MedicalDocumentSetList = { items: MedicalDocumentSet[]; total: number };

const METRIC_KEYS = ["sbp", "fasting_glucose", "hba1c", "ldl", "weight_kg", "waist_cm"];

function Icon({ name }: { name: "overview" | "trend" | "family" | "records" | "sharing" | "shield" | "refresh" | "arrow" }) {
  const paths: Record<string, React.ReactNode> = {
    overview: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="2" />
        <rect x="14" y="3" width="7" height="7" rx="2" />
        <rect x="3" y="14" width="7" height="7" rx="2" />
        <rect x="14" y="14" width="7" height="7" rx="2" />
      </>
    ),
    trend: (
      <>
        <path d="M4 18V6" />
        <path d="M4 18h16" />
        <path d="m7 14 4-4 3 2 5-6" />
      </>
    ),
    family: (
      <>
        <circle cx="9" cy="8" r="3" />
        <circle cx="17" cy="9" r="2.5" />
        <path d="M3.5 20c.4-4 2.2-6 5.5-6s5.1 2 5.5 6" />
        <path d="M14 15c3.8-.8 6.1 1 6.5 5" />
      </>
    ),
    records: (
      <>
        <path d="M6 3h9l4 4v14H6z" />
        <path d="M15 3v5h5" />
        <path d="M9 12h7M9 16h7" />
      </>
    ),
    sharing: (
      <>
        <circle cx="6" cy="12" r="2.4" />
        <circle cx="18" cy="7" r="2.4" />
        <circle cx="18" cy="17" r="2.4" />
        <path d="M8.2 11.2 15.6 8.2M8.2 12.8 15.6 15.8" />
      </>
    ),
    shield: (
      <>
        <path d="M12 3 4.5 6v5.5c0 4.7 3 8 7.5 9.5 4.5-1.5 7.5-4.8 7.5-9.5V6z" />
        <path d="m9 12 2 2 4-5" />
      </>
    ),
    refresh: (
      <>
        <path d="M20 11a8 8 0 1 0-2.3 5.7" />
        <path d="M20 4v7h-7" />
      </>
    ),
    arrow: (
      <>
        <path d="M5 12h14" />
        <path d="m14 7 5 5-5 5" />
      </>
    ),
  };
  return (
    <svg className="hd3-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

function MiniLine({ values, label }: { values: number[]; label: string }) {
  if (values.length < 2) return <div className="hd3-chart-empty">추이를 표시하려면 두 번 이상의 측정이 필요합니다.</div>;
  const width = 640;
  const height = 180;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values
    .map((value, index) => {
      const x = 24 + (index / Math.max(values.length - 1, 1)) * (width - 48);
      const y = 16 + (1 - (value - min) / span) * (height - 36);
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <div className="hd3-chart-frame">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${label} 시계열 차트. 최저 ${min}, 최고 ${max}`}>
        <title>{label} 시계열</title>
        {[0, 1, 2, 3].map((line) => (
          <line key={line} x1="24" x2={width - 24} y1={18 + line * 40} y2={18 + line * 40} className="hd3-gridline" />
        ))}
        <polyline points={points} className="hd3-line" />
        {points.split(" ").map((point, index) => {
          const [cx, cy] = point.split(",");
          return (
            <circle
              key={`${cx}-${cy}`}
              cx={cx}
              cy={cy}
              r={index === values.length - 1 ? 5.5 : 3.5}
              className={index === values.length - 1 ? "hd3-point latest" : "hd3-point"}
            />
          );
        })}
      </svg>
      <div className="hd3-chart-axis">
        <span>첫 측정</span>
        <span>최근 측정</span>
      </div>
    </div>
  );
}

function formatDate(value?: string) {
  if (!value) return "기록 없음";
  return new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric" }).format(new Date(value));
}

function formatDateTime(value?: string | null) {
  if (!value) return "확인되지 않음";
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function documentStatus(status: MedicalDocumentSet["status"]) {
  return ({
    draft: "보관됨",
    analysis_queued: "분석 대기",
    analyzing: "분석 중",
    needs_review: "원본 대조 필요",
    analyzed: "확정됨",
    failed: "분석 실패",
  } as const)[status];
}

export function HealthData3Page() {
  const navigate = useNavigate();
  const { pathname, hash } = useLocation();
  const isPreview = pathname.startsWith("/ui-preview");
  const [dataView, setDataView] = useState<DataView>(() => viewFromHash(hash || (typeof window === "undefined" ? "" : window.location.hash)));

  useEffect(() => {
    setDataView(viewFromHash(hash || window.location.hash));
  }, [hash]);
  const { runtime, profiles, loading: domainLoading, error: domainError } = useLocalDomain();
  const [selectedProfileId, setSelectedProfileId] = useState(() => {
    try {
      return localStorage.getItem("ieobom:selected-profile-id") ?? "";
    } catch {
      return "";
    }
  });
  const [period, setPeriod] = useState<Period>("1y");
  const [metricKey, setMetricKey] = useState("sbp");
  const [records, setRecords] = useState<HealthRecord[]>([]);
  const [documentSets, setDocumentSets] = useState<MedicalDocumentSet[]>([]);
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [documentsError, setDocumentsError] = useState<string>();
  const [openDocumentSet, setOpenDocumentSet] = useState<MedicalDocumentSet>();

  const activeProfile = profiles.find((profile: FamilyProfile) => profile.id === selectedProfileId) ?? profiles[0];
  useEffect(() => {
    const storedOk = selectedProfileId && profiles.some((profile) => profile.id === selectedProfileId);
    if (!storedOk && profiles[0]) setSelectedProfileId(profiles[0].id);
  }, [profiles, selectedProfileId]);

  useEffect(() => {
    if (!selectedProfileId) return;
    try {
      localStorage.setItem("ieobom:selected-profile-id", selectedProfileId);
    } catch {
      // ignore
    }
    window.dispatchEvent(new CustomEvent("ieobom:profile-changed", { detail: { profileId: selectedProfileId } }));
  }, [selectedProfileId]);

  const fromDate = useMemo(() => {
    if (period === "all") return undefined;
    const date = new Date();
    date.setDate(date.getDate() - (period === "30d" ? 30 : period === "90d" ? 90 : 365));
    return date.toISOString();
  }, [period]);

  const { loading, visibleObservations, activeTrendSeries, familyComparisonData, refresh } = useHealthTimeSeries({
    runtime,
    profiles,
    activeProfileId: activeProfile?.id,
    fromDate,
  });

  useEffect(() => {
    if (!runtime || !activeProfile) return;
    let cancelled = false;
    void runtime.healthRecords.query({ profileId: activeProfile.id, includeDeleted: false }).then((result) => {
      if (!cancelled && result.ok) setRecords(result.value.slice().sort((a, b) => b.recordedAt.localeCompare(a.recordedAt)));
    });
    return () => {
      cancelled = true;
    };
  }, [runtime, activeProfile]);

  const loadDocumentSets = useCallback(async () => {
    if (!activeProfile) return setDocumentSets([]);
    setDocumentsLoading(true);
    try {
      const response = await serverApiClient.listMedicalDocumentSets<MedicalDocumentSetList>(activeProfile.id, 50);
      setDocumentSets(response.items);
      setDocumentsError(undefined);
    } catch (caught) {
      setDocumentsError(caught instanceof Error ? caught.message : "원본 서류 목록을 불러오지 못했습니다.");
    } finally {
      setDocumentsLoading(false);
    }
  }, [activeProfile]);

  useEffect(() => {
    void loadDocumentSets();
  }, [loadDocumentSets]);

  const selectedSeries = activeTrendSeries.find((series) => series.key === metricKey);
  const metricSpec = TREND_SERIES.find((item) => item.key === metricKey) ?? TREND_SERIES[0];
  const activeObservations = visibleObservations.filter((point) => point.profileId === activeProfile?.id);
  const latestByMetric = useMemo(() => {
    const map = new Map<string, ObservationPoint>();
    for (const point of activeObservations) map.set(point.metricKey, point);
    return map;
  }, [activeObservations]);
  const latest = selectedSeries?.points.at(-1);
  const first = selectedSeries?.points[0];
  const delta = latest && first ? latest.value - first.value : 0;
  const sourceCounts = activeObservations.reduce<Record<string, number>>((acc: Record<string, number>, point: ObservationPoint) => {
    acc[point.sourceType] = (acc[point.sourceType] ?? 0) + 1;
    return acc;
  }, {});
  const assessedRecords = records.filter((record: HealthRecord) => record.recordType === "assessment");
  const latestAssessment = assessedRecords[0];
  const assessmentPayload = latestAssessment?.payload as Record<string, unknown> | undefined;
  const highestLevel = typeof assessmentPayload?.highestLevel === "string" ? assessmentPayload.highestLevel : "정보 없음";
  const documentsById = useMemo(() => new Map(documentSets.map((documentSet) => [documentSet.id, documentSet])), [documentSets]);

  const familyMetricRows = Object.entries(familyComparisonData).map(([id, item]) => {
    const points = item.metrics[metricKey] ?? [];
    return { id, name: item.name, relation: item.relation, value: points.at(-1)?.value, date: points.at(-1)?.at };
  });

  return (
    <div className="hd3-root">
      {isPreview && <VariantBar current="v16" />}

      <div className="hd3-shell">
        {/* Sidebar */}
        <aside className="hd3-sidebar" aria-label="데이터 일람 메뉴">
          <p className="hd3-sidebar-kicker">DATA VIEWS</p>
          <div className="hd3-sidebar-nav">
            {DATA_VIEWS.map((view) => (
              <a
                key={view.id}
                href={`#${view.id}`}
                className={`hd3-side-link${dataView === view.id ? " active" : ""}`}
                aria-current={dataView === view.id ? "page" : undefined}
                onClick={(event) => {
                  event.preventDefault();
                  setDataView(view.id);
                  void navigate({ pathname, hash: view.id });
                }}
              >
                <Icon name={view.icon} /> {view.label}
              </a>
            ))}
          </div>
          <div className="hd3-side-note">
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <Icon name="shield" />
              <strong>신뢰성 원칙</strong>
            </div>
            <span>측정값과 AI 추론을 혼동하지 않도록 원본 서류 대조 상태를 즉시 표시합니다.</span>
          </div>
        </aside>

        {/* Main Content */}
        <main className="hd3-main">
          {dataView === "sharing" ? <FamilySharingSection /> : null}
          {dataView === "sharing" ? null : (
          <>
          {/* Title Row */}
          <section className="hd3-title-row" id="overview">
            <div>
              <p className="hd3-kicker">HEALTHCARE INTELLIGENCE</p>
              <h1>종합 건강 데이터 일람</h1>
              <p className="hd3-title-desc">우리 가족의 실제 검진 지표와 생체 측정값을 Violet Capsule Minimal 테마로 명확하게 확인합니다.</p>
            </div>
            <button
              type="button"
              className="hd3-refresh-btn"
              onClick={() => {
                void refresh();
                void loadDocumentSets();
              }}
              disabled={loading || documentsLoading}
            >
              <Icon name="refresh" /> 데이터 새로고침
            </button>
          </section>

          {/* Filter Bar */}
          {domainError ? (
            <p className="hd3-title-desc" role="alert">
              건강기록을 서버에서 불러오지 못했습니다. {domainError}
            </p>
          ) : null}

          <section className="hd3-filterbar" aria-label="데이터 필터 옵션">
            <div className="hd3-filter-item">
              <span className="hd3-filter-label">분석 대상 구성원</span>
              <select
                className="hd3-filter-select"
                value={activeProfile?.id ?? ""}
                onChange={(event) => setSelectedProfileId(event.target.value)}
              >
                {profiles.map((profile: FamilyProfile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.displayName} · {profile.relationship}
                  </option>
                ))}
              </select>
            </div>

            <div className="hd3-filter-item">
              <span className="hd3-filter-label">조회 기간</span>
              <select
                className="hd3-filter-select"
                value={period}
                onChange={(event) => setPeriod(event.target.value as Period)}
              >
                <option value="30d">최근 30일</option>
                <option value="90d">최근 90일</option>
                <option value="1y">최근 1년</option>
                <option value="all">전체 기간</option>
              </select>
            </div>

            <div className="hd3-filter-item">
              <span className="hd3-filter-label">관찰 대표 지표</span>
              <select
                className="hd3-filter-select"
                value={metricKey}
                onChange={(event) => setMetricKey(event.target.value)}
              >
                {TREND_SERIES.map((metric) => (
                  <option key={metric.key} value={metric.key}>
                    {metric.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="hd3-data-status">
              <span className="hd3-status-dot" />
              <span>{loading || domainLoading ? "동기화 갱신 중" : `관측값 ${visibleObservations.length}개 연동`}</span>
            </div>
          </section>

          {/* KPIs Overview */}
          <section className="hd3-kpis" aria-label="핵심 분석 요약">
            <article className="hd3-kpi-card">
              <span>최근 {metricSpec.label}</span>
              <div className="hd3-kpi-val">
                {latest ? latest.value : "—"}
                <small>{metricSpec.unit}</small>
              </div>
              <p className="hd3-kpi-sub">{latest ? `${formatDate(latest.at)} 실측` : "측정 기록 없음"}</p>
            </article>

            <article className="hd3-kpi-card">
              <span>기간 내 수치 변동</span>
              <div className={`hd3-kpi-val ${delta > 0 ? "caution" : "stable"}`}>
                {selectedSeries ? `${delta > 0 ? "+" : ""}${Number(delta.toFixed(1))}` : "—"}
                <small>{metricSpec.unit}</small>
              </div>
              <p className="hd3-kpi-sub">{selectedSeries ? `${selectedSeries.points.length}개 측정 시점 비교` : "비교 가능한 기록 부족"}</p>
            </article>

            <article className="hd3-kpi-card">
              <span>만성질환 판정 상태</span>
              <div className={`hd3-kpi-val ${highestLevel.includes("HIGH") || highestLevel.includes("높") ? "danger" : "stable"}`}>
                {highestLevel}
              </div>
              <p className="hd3-kpi-sub">{latestAssessment ? `${formatDate(latestAssessment.recordedAt)} 판정 스냅샷` : "저장된 판정 없음"}</p>
            </article>

            <article className="hd3-kpi-card">
              <span>관측 지표 커버리지</span>
              <div className="hd3-kpi-val">
                {new Set(activeObservations.map((point: ObservationPoint) => point.metricKey)).size}
                <small>개 지표군</small>
              </div>
              <p className="hd3-kpi-sub">{records.length}개 누적 레코드 연동</p>
            </article>
          </section>

          {/* Trend Chart & Reliability */}
          <section className="hd3-analysis-grid" id="trends">
            <article className="hd3-panel">
              <div className="hd3-panel-head">
                <div>
                  <span className="hd3-panel-eyebrow">PERSONAL TIME SERIES</span>
                  <h2>{activeProfile?.displayName ?? "사용자"}님의 {metricSpec.label} 추이</h2>
                </div>
                <span className="hd3-period-tag">{period === "all" ? "전체" : period.replace("d", "일")}</span>
              </div>
              <MiniLine values={selectedSeries?.points.map((point: { value: number }) => point.value) ?? []} label={metricSpec.label} />
              <div className="hd3-insight-strip">
                <strong>관찰 요약:</strong>
                <span>
                  {selectedSeries
                    ? `첫 기록 ${first?.value}${metricSpec.unit}에서 최근 ${latest?.value}${metricSpec.unit}로 ${Math.abs(delta).toFixed(1)}${metricSpec.unit} ${
                        delta > 0 ? "상승 추세" : delta < 0 ? "완만 하락" : "유지"
                      }를 보이고 있습니다.`
                    : "선택된 기간에 분석을 도출하기 위한 충분한 관측값이 없습니다."}
                </span>
              </div>
            </article>

            <article className="hd3-panel">
              <div className="hd3-panel-head">
                <div>
                  <span className="hd3-panel-eyebrow">RELIABILITY</span>
                  <h2>데이터 출처 및 신뢰도</h2>
                </div>
              </div>
              <div className="hd3-source-count">
                <strong>{activeObservations.length}</strong>
                <span>개 정규화 관측값</span>
              </div>
              <ul className="hd3-source-list">
                <li>
                  <span>기기 직접 측정</span>
                  <strong>{sourceCounts.direct_vital ?? 0}건</strong>
                </li>
                <li>
                  <span>종합검진 스냅샷</span>
                  <strong>{sourceCounts.assessment_snapshot ?? 0}건</strong>
                </li>
                <li>
                  <span>의료문서 OCR 인식</span>
                  <strong>{sourceCounts.lab_ocr ?? 0}건</strong>
                </li>
              </ul>
              <p className="hd3-source-desc">
                다중 디바이스와 검진 서류에서 수집된 지표를 중복 없이 시간 축에 정합하여 객관적으로 표현합니다.
              </p>
            </article>
          </section>

          {/* Family Comparison & Metric Scanner */}
          <section className="hd3-lower-grid" id="family">
            <article className="hd3-panel">
              <div className="hd3-panel-head">
                <div>
                  <span className="hd3-panel-eyebrow">FAMILY BENCHMARK</span>
                  <h2>가족 구성원 {metricSpec.label} 비교</h2>
                </div>
                <span className="hd3-count-tag">{familyMetricRows.filter((row) => row.value !== undefined).length}명 측정</span>
              </div>
              <div className="hd3-family-list">
                {familyMetricRows.map((row) => {
                  const values = familyMetricRows.flatMap((item: { value?: number }) => (item.value === undefined ? [] : [item.value]));
                  const max = Math.max(...values, 1);
                  return (
                    <div className="hd3-family-row" key={row.id}>
                      <div className="hd3-family-member">
                        <span className="hd3-family-avatar">{row.name.slice(0, 1)}</span>
                        <span className="hd3-family-name">
                          <strong>{row.name}</strong>
                          <small>{row.relation || "가족"}</small>
                        </span>
                      </div>
                      <div className="hd3-bar-track">
                        <i
                          className="hd3-bar-fill"
                          style={{ width: row.value === undefined ? "0%" : `${Math.max(8, (row.value / max) * 100)}%` }}
                        />
                      </div>
                      <strong>
                        {row.value ?? "—"}
                        <small>{row.value === undefined ? "" : metricSpec.unit}</small>
                      </strong>
                      <time>{formatDate(row.date)}</time>
                    </div>
                  );
                })}
              </div>
            </article>

            <article className="hd3-panel">
              <div className="hd3-panel-head">
                <div>
                  <span className="hd3-panel-eyebrow">METRIC SCANNER</span>
                  <h2>주요 검진 지표 빠른 전환</h2>
                </div>
              </div>
              <div className="hd3-metric-table" role="table" aria-label="주요 건강지표 최근값">
                {METRIC_KEYS.map((key) => {
                  const spec = TREND_SERIES.find((item) => item.key === key);
                  const point = latestByMetric.get(key);
                  return (
                    <button
                      type="button"
                      key={key}
                      className={`hd3-metric-btn ${metricKey === key ? "active" : ""}`}
                      onClick={() => setMetricKey(key)}
                    >
                      <span>
                        <strong>{spec?.label ?? key}</strong>
                        <small>{formatDate(point?.measuredAt)}</small>
                      </span>
                      <strong>
                        {point?.value ?? "—"}
                        <small>{point ? point.unit : ""}</small>
                      </strong>
                      <span className="hd3-metric-arrow">
                        <Icon name="arrow" />
                      </span>
                    </button>
                  );
                })}
              </div>
            </article>
          </section>

          {/* Records & Original Documents */}
          <section className="hd3-panel hd3-records-panel" id="records">
            <div className="hd3-panel-head">
              <div>
                <span className="hd3-panel-eyebrow">EVIDENCE & ORIGINAL DOCUMENTS</span>
                <h2>건강 기록 및 암호화 보관 원본 서류</h2>
              </div>
              <button
                type="button"
                className="hd3-refresh-btn"
                onClick={() => void navigate("/health-data")}
              >
                간단 목록 보기 <Icon name="arrow" />
              </button>
            </div>

            <div className="hd3-evidence-layout">
              <div>
                <div className="hd3-evidence-heading">
                  <strong>건강기록 타임라인</strong>
                  <span>측정값 및 진단 요약</span>
                </div>
                {records.length === 0 ? (
                  <div className="hd3-empty-state">표시할 건강기록이 없습니다.</div>
                ) : (
                  <div className="hd3-record-list">
                    {records.slice(0, 5).map((record: HealthRecord) => {
                      const source = record.sourceDocumentId ? documentsById.get(record.sourceDocumentId) : undefined;
                      return (
                        <button
                          type="button"
                          key={record.id}
                          className="hd3-record-item"
                          onClick={() => void navigate(`/members/${record.profileId}/records/${record.id}`)}
                        >
                          <span className="hd3-badge-icon">{recordTypeLabel(record.recordType).slice(0, 1)}</span>
                          <span className="hd3-record-info">
                            <strong>{recordTypeLabel(record.recordType)}</strong>
                            <small>
                              {source?.examined_at ? `검사일 ${formatDateTime(source.examined_at)} · ` : ""}
                              {recordSummary(record)}
                            </small>
                          </span>
                          <time style={{ fontSize: "11px", color: "var(--hd3-fog)" }}>
                            {source?.examined_at ? formatDate(source.examined_at) : formatDate(record.recordedAt)}
                          </time>
                          <span className="hd3-metric-arrow">
                            <Icon name="arrow" />
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div>
                <div className="hd3-evidence-heading">
                  <strong>암호화 보관 서류</strong>
                  <span>원본 대조 가능 묶음</span>
                </div>
                {documentsError ? (
                  <div className="hd3-empty-state" style={{ color: "#be123c" }}>
                    {documentsError}
                  </div>
                ) : null}
                {documentsLoading ? (
                  <div className="hd3-empty-state">원본 서류 목록을 불러오는 중입니다…</div>
                ) : documentSets.length === 0 ? (
                  <div className="hd3-empty-state">보관된 원본 서류가 없습니다.</div>
                ) : (
                  <div className="hd3-document-list">
                    {documentSets.map((documentSet) => (
                      <button
                        type="button"
                        key={documentSet.id}
                        className="hd3-document-item"
                        onClick={() => setOpenDocumentSet(documentSet)}
                      >
                        <span className="hd3-badge-icon">원</span>
                        <span className="hd3-doc-info">
                          <strong>{documentSet.document_type === "health_screening" ? "건강검진 원본" : "의료 서류 원본"}</strong>
                          <small>검사일 {formatDateTime(documentSet.examined_at)} · {documentSet.pages.length}장</small>
                        </span>
                        <span className={`hd3-status-tag ${documentSet.status}`}>{documentStatus(documentSet.status)}</span>
                        <span className="hd3-metric-arrow">
                          <Icon name="arrow" />
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>
          </>
          )}
        </main>
      </div>

      {openDocumentSet ? <MedicalDocumentDetail documentSet={openDocumentSet} onClose={() => setOpenDocumentSet(undefined)} /> : null}
    </div>
  );
}

function MedicalDocumentDetail({ documentSet, onClose }: { documentSet: MedicalDocumentSet; onClose: () => void }) {
  const [pageUrls, setPageUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    const urls: string[] = [];
    void Promise.all(
      documentSet.pages.map(async (page) => {
        const blob = await serverApiClient.readMedicalDocumentPage(documentSet.id, page.id);
        const url = URL.createObjectURL(blob);
        urls.push(url);
        return [page.id, url] as const;
      })
    )
      .then((entries) => {
        if (!cancelled) setPageUrls(Object.fromEntries(entries));
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "원본 서류를 열지 못했습니다.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [documentSet]);

  return (
    <Modal kicker="원본·AI 분석·확정값 대조" title="건강검진 원본 서류" className="hd3-modal-shell" onClose={onClose}>
      <p style={{ margin: "0 0 14px", padding: "10px 14px", borderRadius: "12px", background: "var(--hd3-bone)", color: "var(--hd3-aubergine)", fontSize: "12px" }}>
        저장 시각을 실제 검사일로 변경하여 왜곡하지 않습니다. 실제 검사일시를 기준으로 정밀 대조합니다.
      </p>
      <dl className="hd3-date-grid">
        <div>
          <dt>실제 검사일</dt>
          <dd>{formatDateTime(documentSet.examined_at)}</dd>
        </div>
        <div>
          <dt>서류 발급일</dt>
          <dd>{formatDateTime(documentSet.issued_at)}</dd>
        </div>
        <div>
          <dt>원본 보관일시</dt>
          <dd>{formatDateTime(documentSet.created_at)}</dd>
        </div>
        <div>
          <dt>AI 분석일시</dt>
          <dd>{formatDateTime(documentSet.analyzed_at)}</dd>
        </div>
      </dl>
      <p style={{ margin: "0 0 14px", color: "var(--hd3-fog)", fontSize: "12px" }}>
        날짜 확인 상태:{" "}
        <strong style={{ color: "var(--hd3-aubergine)" }}>
          {documentSet.date_confidence === "confirmed"
            ? "원본 대조로 확인됨"
            : documentSet.date_confidence === "needs_review"
            ? "원본 대조 필요"
            : "아직 확인되지 않음"}
        </strong>
      </p>
      {loading ? <div className="hd3-empty-state">암호화 보관 원본을 불러오는 중입니다…</div> : null}
      {error ? <p style={{ color: "#be123c", fontSize: "12px" }}>{error}</p> : null}
      <div className="hd3-original-pages">
        {documentSet.pages.map((page) => {
          const url = pageUrls[page.id];
          return (
            <article key={page.id}>
              <div>
                <strong>
                  {page.page_order}쪽 · {page.original_filename}
                </strong>
                <small>{Math.ceil(page.plaintext_size / 1024)} KB</small>
              </div>
              {url ? (
                page.mime_type.startsWith("image/") ? (
                  <img src={url} alt={`${page.page_order}쪽 원본 서류`} />
                ) : (
                  <a href={url} target="_blank" rel="noreferrer" style={{ display: "block", padding: "24px", color: "var(--hd3-aubergine)", fontWeight: 500 }}>
                    원본 파일 새 창에서 열기 ↗
                  </a>
                )
              ) : null}
            </article>
          );
        })}
      </div>
    </Modal>
  );
}
