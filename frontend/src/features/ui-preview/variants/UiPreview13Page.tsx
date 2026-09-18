import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { useLocalDomain } from "../../../app/localDomainContext";
import { TREND_SERIES } from "../../assessment/snapshots";
import { useHealthTimeSeries } from "../../data/useHealthTimeSeries";
import type { HealthRecord } from "../../../shared/local/domainContracts";
import { recordSummary, recordTypeLabel } from "../../../shared/local/recordSummary";
import { VariantBar } from "../components/VariantBar";
import { Modal } from "../../../shared/ui/Modal";
import { serverApiClient } from "../../../shared/api/serverApiClient";
import { regionRisks, type RegionRisk } from "../../home/bodyRisk";
import "../styles/shadcn-preview-variants.css";
import "../styles/ui-preview13.css";

const VanatomeBodyMap = lazy(() =>
  import("../../home/VanatomeBodyMap").then((module) => ({
    default: module.VanatomeBodyMap,
  })),
);

type Period = "30d" | "90d" | "1y" | "all";

type MedicalDocumentPage = {
  id: string;
  page_order: number;
  original_filename: string;
  mime_type: string;
  plaintext_size: number;
};

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

type MedicalDocumentSetList = {
  items: MedicalDocumentSet[];
  total: number;
};

const METRIC_KEYS = ["sbp", "fasting_glucose", "hba1c", "ldl", "weight_kg", "waist_cm"];

function Icon({ name }: { name: "home" | "assessment" | "pain" | "data" | "shield" | "refresh" | "arrow" | "trend" | "user" | "doc" }) {
  const paths: Record<string, React.ReactNode> = {
    home: <><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></>,
    assessment: <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>,
    pain: <><circle cx="12" cy="12" r="10"/><path d="m4.93 4.93 4.24 4.24"/><path d="m14.83 9.17 4.24-4.24"/><path d="m14.83 14.83 4.24 4.24"/><path d="m9.17 14.83-4.24 4.24"/></>,
    data: <><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></>,
    shield: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></>,
    refresh: <><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 21h5v-5"/></>,
    arrow: <><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></>,
    trend: <><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></>,
    user: <><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></>,
    doc: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></>,
  };
  return (
    <svg className="up13-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

function MiniLineChart({ values, label, color = "#1d4fb8" }: { values: number[]; label: string; color?: string }) {
  if (values.length < 2) {
    return (
      <div style={{ height: "180px", display: "grid", placeItems: "center", background: "#f8fafc", borderRadius: "12px", color: "#5b687e", fontSize: "12px" }}>
        측정 수치가 2개 이상일 때 변화 추이가 나타납니다.
      </div>
    );
  }
  const width = 640;
  const height = 180;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values
    .map((val, idx) => {
      const x = 24 + (idx / Math.max(values.length - 1, 1)) * (width - 48);
      const y = 20 + (1 - (val - min) / span) * (height - 48);
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <div style={{ height: "180px", width: "100%" }}>
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height: "100%", overflow: "visible" }} role="img" aria-label={`${label} 추이`}>
        <title>{label} 추이 차트</title>
        {[0, 1, 2].map((idx) => (
          <line key={idx} x1="20" x2={width - 20} y1={24 + idx * 56} y2={24 + idx * 56} stroke="#e8edf5" strokeWidth="1" />
        ))}
        <polyline points={points} fill="none" stroke={color} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
        {points.split(" ").map((pt, i) => {
          const [cx, cy] = pt.split(",");
          const isLatest = i === values.length - 1;
          return <circle key={i} cx={cx} cy={cy} r={isLatest ? 5.5 : 3.5} fill={isLatest ? color : "#ffffff"} stroke={color} strokeWidth="2.5" />;
        })}
      </svg>
    </div>
  );
}

function formatDate(value?: string | null) {
  if (!value) return "기록 없음";
  return new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric" }).format(new Date(value));
}

function formatDateTime(value?: string | null) {
  if (!value) return "확인되지 않음";
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function UiPreview13Page() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const isPreview = pathname.startsWith("/ui-preview");
  const { runtime, profiles, loading: domainLoading } = useLocalDomain();

  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [period, setPeriod] = useState<Period>("1y");
  const [metricKey, setMetricKey] = useState("sbp");
  const [records, setRecords] = useState<HealthRecord[]>([]);
  const [documentSets, setDocumentSets] = useState<MedicalDocumentSet[]>([]);
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [documentsError, setDocumentsError] = useState<string>();
  const [openDocumentSet, setOpenDocumentSet] = useState<MedicalDocumentSet>();
  const [selectedOrgan, setSelectedOrgan] = useState<string>();

  const activeProfile = profiles.find((p) => p.id === selectedProfileId) ?? profiles[0];

  useEffect(() => {
    if (!selectedProfileId && profiles[0]) {
      setSelectedProfileId(profiles[0].id);
    }
  }, [profiles, selectedProfileId]);

  const fromDate = useMemo(() => {
    if (period === "all") return undefined;
    const date = new Date();
    date.setDate(date.getDate() - (period === "30d" ? 30 : period === "90d" ? 90 : 365));
    return date.toISOString();
  }, [period]);

  const { loading: seriesLoading, visibleObservations, activeTrendSeries, familyComparisonData, refresh } =
    useHealthTimeSeries({
      runtime,
      profiles,
      activeProfileId: activeProfile?.id,
      fromDate,
    });

  // 건강 기록 로드
  useEffect(() => {
    if (!runtime || !activeProfile) return;
    let cancelled = false;
    void runtime.healthRecords
      .query({ profileId: activeProfile.id, includeDeleted: false })
      .then((result) => {
        if (!cancelled && result.ok) {
          setRecords(result.value.slice().sort((a, b) => b.recordedAt.localeCompare(a.recordedAt)));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [runtime, activeProfile]);

  // 원본 의료서류 목록 로드
  const loadDocumentSets = useCallback(async () => {
    if (!activeProfile) return setDocumentSets([]);
    setDocumentsLoading(true);
    setDocumentsError(undefined);
    try {
      const response = await serverApiClient.listMedicalDocumentSets<MedicalDocumentSetList>(activeProfile.id, 50);
      setDocumentSets(response.items ?? []);
    } catch (caught) {
      setDocumentsError(caught instanceof Error ? caught.message : "원본 서류 목록 오류");
    } finally {
      setDocumentsLoading(false);
    }
  }, [activeProfile]);

  useEffect(() => {
    void loadDocumentSets();
  }, [loadDocumentSets]);

  const selectedSeries = activeTrendSeries.find((s) => s.key === metricKey);
  const metricSpec = TREND_SERIES.find((s) => s.key === metricKey) ?? TREND_SERIES[0];
  const activeObservations = visibleObservations.filter((p) => p.profileId === activeProfile?.id);

  const latest = selectedSeries?.points.at(-1);
  const first = selectedSeries?.points[0];
  const delta = latest && first ? latest.value - first.value : 0;

  // 질환 판정 기반 3D 장기 위험도 도출
  const bodyRisks: RegionRisk[] = useMemo(() => {
    const assessed = records.filter((r) => r.recordType === "assessment");
    const latestAssessed = assessed[0];
    const payload = latestAssessed?.payload as Record<string, unknown> | undefined;
    const verdicts = Array.isArray(payload?.verdicts)
      ? (payload?.verdicts as Array<{ key: string; level: string; name?: string }>)
      : [];
    if (!verdicts.length) return [];
    return regionRisks(
      verdicts.map((v) => ({
        key: v.key,
        name: v.name,
        risk_level: v.level,
      })),
    );
  }, [records]);

  const assessedRecords = records.filter((r) => r.recordType === "assessment");
  const latestAssessment = assessedRecords[0];
  const assessmentPayload = latestAssessment?.payload as Record<string, unknown> | undefined;
  const highestLevel = typeof assessmentPayload?.highestLevel === "string" ? assessmentPayload.highestLevel : "정상";

  // 가족 비교 데이터 행
  const familyMetricRows = Object.entries(familyComparisonData).map(([id, item]) => {
    const points = item.metrics[metricKey] ?? [];
    return {
      id,
      name: item.name,
      relation: item.relation,
      value: points.at(-1)?.value,
      date: points.at(-1)?.at,
    };
  });

  return (
    <div className="up13-root">
      {isPreview ? <VariantBar current="v13" /> : null}

      {/* 상단 앱 헤더 (프리뷰 모드일 때 자체 헤더 표시) */}
      {isPreview ? (
        <header className="up13-header">
          <div className="up13-brand">
            <div className="up13-logo">
              <Icon name="trend" />
            </div>
            <div className="up13-brand-text">
              <strong>이어봄 헬스허브</strong>
              <span>가족 건강 통합 분석 대시보드</span>
            </div>
          </div>

          <nav className="up13-topnav" aria-label="주요 내비게이션">
            <button type="button" className="up13-nav-btn" onClick={() => void navigate("/")}>
              <Icon name="home" /> 가족 홈
            </button>
            <button type="button" className="up13-nav-btn active">
              <Icon name="data" /> 건강 분석 홈
            </button>
            <button type="button" className="up13-nav-btn" onClick={() => void navigate("/health-data")}>
              수치 대시보드
            </button>
            <button type="button" className="up13-nav-btn" onClick={() => void navigate("/assessment")}>
              <Icon name="assessment" /> 질환 예측
            </button>
            <button type="button" className="up13-nav-btn" onClick={() => void navigate("/pain-diary")}>
              <Icon name="pain" /> 통증 다이어리
            </button>
          </nav>

          <div className="up13-header-actions">
            <button type="button" className="up13-user-btn" onClick={() => void navigate("/account")}>
              <span className="up13-user-avatar">{activeProfile?.displayName?.slice(0, 1) ?? "나"}</span>
              <span>{activeProfile?.displayName ?? "가족"}</span>
            </button>
          </div>
        </header>
      ) : null}

      <main className="up13-main">
        {/* 상단 1: 가족 구성원 선택 레일 & 기간 필터 */}
        <section className="up13-family-bar" aria-label="가족 구성원 및 기간 선택">
          <div className="up13-family-members">
            {profiles.map((profile) => {
              const isSelected = profile.id === activeProfile?.id;
              return (
                <button
                  key={profile.id}
                  type="button"
                  className={`up13-member-pill ${isSelected ? "active" : ""}`}
                  onClick={() => {
                    setSelectedProfileId(profile.id);
                    setSelectedOrgan(undefined);
                  }}
                >
                  <span className="up13-pill-avatar">{profile.displayName.slice(0, 1)}</span>
                  <div className="up13-pill-copy">
                    <strong>{profile.displayName}</strong>
                    <small>{profile.relationship || "가족"}</small>
                  </div>
                  <span className={`up13-pill-badge ${isSelected ? "safe" : "none"}`}>
                    {isSelected ? "선택됨" : "조회"}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="up13-control-group">
            <div className="up13-period-tabs" aria-label="분석 기간">
              <button
                type="button"
                className={`up13-period-btn ${period === "30d" ? "active" : ""}`}
                onClick={() => setPeriod("30d")}
              >
                30일
              </button>
              <button
                type="button"
                className={`up13-period-btn ${period === "90d" ? "active" : ""}`}
                onClick={() => setPeriod("90d")}
              >
                90일
              </button>
              <button
                type="button"
                className={`up13-period-btn ${period === "1y" ? "active" : ""}`}
                onClick={() => setPeriod("1y")}
              >
                1년
              </button>
              <button
                type="button"
                className={`up13-period-btn ${period === "all" ? "active" : ""}`}
                onClick={() => setPeriod("all")}
              >
                전체
              </button>
            </div>

            <button
              type="button"
              className="up13-refresh-btn"
              onClick={() => {
                void refresh();
                void loadDocumentSets();
              }}
              disabled={seriesLoading || domainLoading}
            >
              <Icon name="refresh" />
              <span>새로고침</span>
            </button>
          </div>
        </section>

        {/* 상단 2: 핵심 바이탈 KPI 요약 스트립 */}
        <section className="up13-kpi-strip" aria-label="주요 건강지표 요약">
          <article className="up13-kpi-card">
            <div className="up13-kpi-head">
              <span className="up13-kpi-title">선택 지표: {metricSpec.label}</span>
              <Icon name="trend" />
            </div>
            <div className="up13-kpi-val">
              {latest ? latest.value : "—"}
              <small>{metricSpec.unit}</small>
            </div>
            <div className="up13-kpi-meta">
              <span>{latest ? `${formatDate(latest.at)} 측정` : "측정 기록 없음"}</span>
            </div>
          </article>

          <article className="up13-kpi-card">
            <div className="up13-kpi-head">
              <span className="up13-kpi-title">기간 내 변화폭</span>
              <Icon name="assessment" />
            </div>
            <div className="up13-kpi-val">
              {selectedSeries && delta !== 0 ? (
                <span className={delta > 0 ? "trend-up" : "trend-down"}>
                  {delta > 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1)}
                </span>
              ) : (
                "—"
              )}
              <small>{metricSpec.unit}</small>
            </div>
            <div className="up13-kpi-meta">
              <span>{selectedSeries ? `${selectedSeries.points.length}회 관측값 비교` : "비교 수치 부족"}</span>
            </div>
          </article>

          <article className="up13-kpi-card">
            <div className="up13-kpi-head">
              <span className="up13-kpi-title">최근 종합 AI 위험 판정</span>
              <Icon name="shield" />
            </div>
            <div className="up13-kpi-val">
              <span style={{ color: highestLevel.includes("HIGH") || highestLevel.includes("높") ? "#b43e47" : "#0f6b50" }}>
                {highestLevel}
              </span>
            </div>
            <div className="up13-kpi-meta">
              <span>{latestAssessment ? `${formatDate(latestAssessment.recordedAt)} 스냅샷` : "저장된 판정 없음"}</span>
            </div>
          </article>

          <article className="up13-kpi-card">
            <div className="up13-kpi-head">
              <span className="up13-kpi-title">공인 보관 서류 및 기록</span>
              <Icon name="doc" />
            </div>
            <div className="up13-kpi-val">
              {records.length} <small>건 기록</small> / {documentSets.length} <small>건 서류</small>
            </div>
            <div className="up13-kpi-meta">
              <span>표준 관측값 {activeObservations.length}개 연동</span>
            </div>
          </article>
        </section>

        {/* 중단: 3D 인체 디지털 트윈 + 지표 추이 벤토 히어로 */}
        <section className="up13-bento-hero">
          {/* 좌측: 3D 인체 디지털 트윈 (바디맵) */}
          <article className="up13-panel-twin">
            <div className="up13-twin-header">
              <div>
                <h2>{activeProfile?.displayName ?? "구성원"}님의 3D 신체 트윈</h2>
                <p>실제 건강검진 위험 판정 및 통증 지점이 장기 메시에 직접 매핑됩니다.</p>
              </div>
              <span className="up13-pill-badge safe">인터랙티브 3D</span>
            </div>

            <div className="up13-twin-viewport">
              <div className="up13-twin-overlay-status">
                <strong>{activeProfile?.displayName ?? "나"} (디지털 트윈)</strong>
                <span>판정 장기: {bodyRisks.length > 0 ? `${bodyRisks.length}곳 주의/관심` : "이상 소견 없음"}</span>
              </div>
              <div className="up13-twin-canvas-holder">
                <Suspense fallback={<div style={{ height: "100%", display: "grid", placeItems: "center", color: "#5b687e" }}>3D 인체 모델 로드 중…</div>}>
                  <VanatomeBodyMap
                    key={`${activeProfile?.id}-${activeProfile?.gender}`}
                    profileName={activeProfile?.displayName ?? "나"}
                    gender={activeProfile?.gender}
                    risks={bodyRisks}
                    highlightOrganKey={selectedOrgan}
                  />
                </Suspense>
              </div>
            </div>

            <div className="up13-twin-legend">
              {["heart", "liver", "kidneys", "pancreas"].map((key) => {
                const label = key === "heart" ? "심장" : key === "liver" ? "간" : key === "kidneys" ? "콩팥" : "췌장";
                const isFocused = selectedOrgan === key;
                return (
                  <button
                    key={key}
                    type="button"
                    className={`up13-twin-organ-pill ${isFocused ? "selected" : ""}`}
                    onClick={() => setSelectedOrgan(isFocused ? undefined : key)}
                  >
                    <strong>{label}</strong>
                    <span>{isFocused ? "초점 해제" : "자세히 보기"}</span>
                  </button>
                );
              })}
            </div>
          </article>

          {/* 우측: 핵심 지표 시계열 추이 & 인사이트 */}
          <div className="up13-analytics-column">
            <article className="up13-panel-trend">
              <div className="up13-trend-head">
                <div>
                  <h3 style={{ margin: 0, fontSize: "18px", fontWeight: 700 }}>
                    {metricSpec.label} 시계열 추이 분석
                  </h3>
                  <p style={{ margin: "4px 0 0", fontSize: "12px", color: "var(--up13-muted)" }}>
                    검진표 OCR 분석 결과와 일상 직접 측정값을 날짜 순으로 대조합니다.
                  </p>
                </div>
                <div className="up13-trend-tabs">
                  {METRIC_KEYS.map((key) => {
                    const spec = TREND_SERIES.find((item) => item.key === key);
                    return (
                      <button
                        key={key}
                        type="button"
                        className={`up13-metric-chip ${metricKey === key ? "active" : ""}`}
                        onClick={() => setMetricKey(key)}
                      >
                        {spec?.label ?? key}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="up13-chart-area">
                <MiniLineChart
                  values={selectedSeries?.points.map((p) => p.value) ?? []}
                  label={metricSpec.label}
                  color="#1d4fb8"
                />
              </div>

              <div className="up13-insight-banner">
                <Icon name="shield" />
                <div>
                  <strong>의학적 해석 근거: </strong>
                  {selectedSeries && selectedSeries.points.length >= 2
                    ? `첫 측정(${first?.value}${metricSpec.unit}) 대비 최근 측정(${latest?.value}${metricSpec.unit})에서 ${Math.abs(delta).toFixed(1)}${metricSpec.unit} ${delta > 0 ? "상승" : "안정"}했습니다. 생활습관과 투약 준수를 지속 확인하세요.`
                    : "현재 기간에 연결된 유효 측정값이 부족합니다. 상단 또는 챗봇을 통해 새 수치를 기록해보세요."}
                </div>
              </div>
            </article>

            {/* 검사항목 최근 수치 빠른 스캔 카드 */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px" }}>
              {METRIC_KEYS.slice(0, 3).map((key) => {
                const spec = TREND_SERIES.find((item) => item.key === key);
                const s = activeTrendSeries.find((item) => item.key === key);
                const lastVal = s?.points.at(-1);
                return (
                  <div
                    key={key}
                    style={{
                      background: "#ffffff",
                      border: "1px solid var(--up13-border)",
                      borderRadius: "14px",
                      padding: "14px",
                      cursor: "pointer",
                      borderLeft: metricKey === key ? "4px solid var(--up13-blue)" : "1px solid var(--up13-border)",
                    }}
                    onClick={() => setMetricKey(key)}
                  >
                    <span style={{ fontSize: "11px", color: "var(--up13-muted)", fontWeight: 600 }}>{spec?.label}</span>
                    <div style={{ fontSize: "20px", fontWeight: 700, margin: "6px 0 2px" }}>
                      {lastVal ? lastVal.value : "—"} <small style={{ fontSize: "11px", fontWeight: 400, color: "#5b687e" }}>{spec?.unit}</small>
                    </div>
                    <small style={{ fontSize: "11px", color: "var(--up13-muted)" }}>
                      {lastVal ? formatDate(lastVal.at) : "미측정"}
                    </small>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* 하단 2분할: 가족 동반 수치 비교 + 원본 서류 및 근거 뷰 */}
        <section className="up13-bottom-grid">
          {/* 하단 좌측: 같은 지표 가족 비교 */}
          <article className="up13-panel">
            <div className="up13-panel-title-row">
              <div>
                <h3>가족 간 {metricSpec.label} 수치 비교</h3>
                <p>같은 검사 항목, 같은 단위를 기준으로 온 가족의 현재 위치를 비교합니다.</p>
              </div>
              <span className="up13-pill-badge none">가족 {familyMetricRows.length}명</span>
            </div>

            <div className="up13-family-compare-list">
              {familyMetricRows.map((row) => {
                const values = familyMetricRows.flatMap((item) => (item.value === undefined ? [] : [item.value]));
                const max = Math.max(...values, 1);
                const pct = row.value !== undefined ? Math.max(12, (row.value / max) * 100) : 0;
                return (
                  <div key={row.id} className="up13-compare-row">
                    <div className="up13-compare-person">
                      <span className="up13-compare-avatar">{row.name.slice(0, 1)}</span>
                      <div className="up13-compare-name">
                        <strong>{row.name}</strong>
                        <small>{row.relation || "가족"}</small>
                      </div>
                    </div>
                    <div className="up13-compare-bar-track">
                      <div className="up13-compare-bar-fill" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="up13-compare-val">
                      {row.value ?? "—"}
                      <small>{row.value !== undefined ? metricSpec.unit : ""}</small>
                    </div>
                    <div className="up13-compare-date">{formatDate(row.date)}</div>
                  </div>
                );
              })}
            </div>
          </article>

          {/* 하단 우측: 건강기록 & 공인 원본 서류 대조 */}
          <article className="up13-panel">
            <div className="up13-panel-title-row">
              <div>
                <h3>원본 근거 및 건강기록 대조</h3>
                <p>AI가 인식한 요약 기록과 AES-256으로 암호화 보관된 검진표 원본입니다.</p>
              </div>
              <button
                type="button"
                className="up13-refresh-btn"
                onClick={() => void navigate("/health-data")}
              >
                <span>전체 보기</span>
                <Icon name="arrow" />
              </button>
            </div>

            <div className="up13-evidence-split">
              {/* 왼쪽 칼럼: 최근 건강 기록 */}
              <div>
                <div className="up13-evidence-col-title">
                  <span>최근 건강기록 요약</span>
                  <span>{records.length}건</span>
                </div>
                <div className="up13-record-mini-list">
                  {records.length === 0 ? (
                    <div style={{ padding: "24px", textAlign: "center", color: "#5b687e", fontSize: "12px" }}>
                      등록된 기록이 없습니다.
                    </div>
                  ) : (
                    records.slice(0, 4).map((record) => (
                      <div
                        key={record.id}
                        className="up13-record-mini-item"
                        onClick={() => void navigate(`/members/${record.profileId}/records/${record.id}`)}
                      >
                        <div style={{ display: "flex", alignItems: "center", minWidth: 0 }}>
                          <span className="up13-record-type-badge">{recordTypeLabel(record.recordType).slice(0, 1)}</span>
                          <div className="up13-record-item-info">
                            <strong>{recordTypeLabel(record.recordType)}</strong>
                            <small>{recordSummary(record)}</small>
                          </div>
                        </div>
                        <span style={{ fontSize: "11px", color: "var(--up13-muted)", flexShrink: 0 }}>
                          {formatDate(record.recordedAt)}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* 오른쪽 칼럼: 암호화 보관 원본 서류 */}
              <div>
                <div className="up13-evidence-col-title">
                  <span>원본 서류 묶음</span>
                  <span>{documentSets.length}건</span>
                </div>
                {documentsError ? (
                  <div style={{ padding: "12px", background: "#fff1f2", color: "#b43e47", fontSize: "12px", borderRadius: "8px" }}>
                    {documentsError}
                  </div>
                ) : null}
                {documentsLoading ? (
                  <div style={{ padding: "24px", textAlign: "center", color: "#5b687e", fontSize: "12px" }}>
                    원본 서류 목록을 불러오는 중입니다…
                  </div>
                ) : null}
                <div className="up13-record-mini-list">
                  {!documentsLoading && documentSets.length === 0 ? (
                    <div style={{ padding: "24px", textAlign: "center", color: "#5b687e", fontSize: "12px" }}>
                      보관된 원본 서류가 없습니다.
                    </div>
                  ) : (
                    documentSets.map((docSet) => (
                      <div
                        key={docSet.id}
                        className="up13-doc-mini-item"
                        onClick={() => setOpenDocumentSet(docSet)}
                      >
                        <div style={{ display: "flex", alignItems: "center", minWidth: 0 }}>
                          <div className="up13-doc-icon">원</div>
                          <div className="up13-record-item-info">
                            <strong>{docSet.document_type === "health_screening" ? "건강검진 결과통보서" : "의료 서류"}</strong>
                            <small>
                              실제 검사일: {docSet.examined_at ? formatDate(docSet.examined_at) : "확인 필요"} · {docSet.pages.length}장
                            </small>
                          </div>
                        </div>
                        <span className={`up13-pill-badge ${docSet.status === "analyzed" ? "safe" : "caution"}`}>
                          {docSet.status === "analyzed" ? "확정" : "대조필요"}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </article>
        </section>
      </main>

      {/* 원본 서류 대조 모달 */}
      {openDocumentSet ? (
        <MedicalDocumentModal
          documentSet={openDocumentSet}
          onClose={() => setOpenDocumentSet(undefined)}
        />
      ) : null}
    </div>
  );
}

function MedicalDocumentModal({
  documentSet,
  onClose,
}: {
  documentSet: MedicalDocumentSet;
  onClose: () => void;
}) {
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
      }),
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
    <Modal kicker="원본 서류 대조 및 검증" title="건강검진 공인 원본 서류" className="up13-doc-modal" onClose={onClose}>
      <p style={{ margin: "0 0 16px", padding: "12px 14px", background: "var(--up13-blue-soft)", borderRadius: "10px", fontSize: "13px", color: "var(--up13-ink)" }}>
        서류의 실제 검사일시와 AI 분석일시, 원본 보관일시를 분리하여 대조 검증합니다.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "10px", margin: "0 0 16px" }}>
        <div style={{ padding: "12px", border: "1px solid var(--up13-border)", borderRadius: "10px", background: "#fff" }}>
          <div style={{ fontSize: "11px", color: "var(--up13-muted)", fontWeight: 700 }}>실제 검사일</div>
          <strong style={{ fontSize: "13px", display: "block", marginTop: "4px" }}>
            {formatDateTime(documentSet.examined_at)}
          </strong>
        </div>
        <div style={{ padding: "12px", border: "1px solid var(--up13-border)", borderRadius: "10px", background: "#fff" }}>
          <div style={{ fontSize: "11px", color: "var(--up13-muted)", fontWeight: 700 }}>서류 발급일</div>
          <strong style={{ fontSize: "13px", display: "block", marginTop: "4px" }}>
            {formatDateTime(documentSet.issued_at)}
          </strong>
        </div>
        <div style={{ padding: "12px", border: "1px solid var(--up13-border)", borderRadius: "10px", background: "#fff" }}>
          <div style={{ fontSize: "11px", color: "var(--up13-muted)", fontWeight: 700 }}>암호화 보관일시</div>
          <strong style={{ fontSize: "13px", display: "block", marginTop: "4px" }}>
            {formatDateTime(documentSet.created_at)}
          </strong>
        </div>
        <div style={{ padding: "12px", border: "1px solid var(--up13-border)", borderRadius: "10px", background: "#fff" }}>
          <div style={{ fontSize: "11px", color: "var(--up13-muted)", fontWeight: 700 }}>AI 분석일시</div>
          <strong style={{ fontSize: "13px", display: "block", marginTop: "4px" }}>
            {formatDateTime(documentSet.analyzed_at)}
          </strong>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: "32px", textAlign: "center", color: "var(--up13-muted)" }}>
          암호화된 원본 서류 이미지를 복호화하는 중입니다…
        </div>
      ) : null}

      {error ? (
        <div style={{ padding: "12px", background: "#fff1f2", color: "#b43e47", fontSize: "13px", borderRadius: "8px", margin: "10px 0" }}>
          {error}
        </div>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "14px" }}>
        {documentSet.pages.map((page) => {
          const url = pageUrls[page.id];
          return (
            <article
              key={page.id}
              style={{
                border: "1px solid var(--up13-border)",
                borderRadius: "12px",
                overflow: "hidden",
                background: "#ffffff",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  padding: "10px 14px",
                  borderBottom: "1px solid var(--up13-border)",
                  fontSize: "12px",
                }}
              >
                <strong>{page.page_order}쪽 · {page.original_filename}</strong>
                <small style={{ color: "var(--up13-muted)" }}>{Math.ceil(page.plaintext_size / 1024)} KB</small>
              </div>
              {url ? (
                page.mime_type.startsWith("image/") ? (
                  <img
                    src={url}
                    alt={`${page.page_order}쪽 원본`}
                    style={{ width: "100%", height: "auto", maxHeight: "540px", objectFit: "contain", background: "#f8fafc" }}
                  />
                ) : (
                  <a href={url} target="_blank" rel="noreferrer" style={{ display: "block", padding: "20px", color: "var(--up13-blue)" }}>
                    원본 문서 파일 열기
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
