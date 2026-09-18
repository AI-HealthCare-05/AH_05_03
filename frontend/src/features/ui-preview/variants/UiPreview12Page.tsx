import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { useLocalDomain } from "../../../app/localDomainContext";
import { TREND_SERIES } from "../../assessment/snapshots";
import { useHealthTimeSeries } from "../../data/useHealthTimeSeries";
import type { HealthRecord } from "../../../shared/local/domainContracts";
import { recordSummary, recordTypeLabel } from "../../../shared/local/recordSummary";
import { VariantBar } from "../components/VariantBar";
import { Modal } from "../../../shared/ui/Modal";
import { serverApiClient } from "../../../shared/api/serverApiClient";
import "../styles/shadcn-preview-variants.css";
import "../styles/ui-preview12.css";
import "../styles/ui-preview12-document-evidence.css";

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

function Icon({ name }: { name: "overview" | "trend" | "family" | "records" | "shield" | "refresh" | "arrow" }) {
  const paths: Record<string, React.ReactNode> = {
    overview: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
    trend: <><path d="M4 18V6"/><path d="M4 18h16"/><path d="m7 14 4-4 3 2 5-6"/></>,
    family: <><circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3.5 20c.4-4 2.2-6 5.5-6s5.1 2 5.5 6"/><path d="M14 15c3.8-.8 6.1 1 6.5 5"/></>,
    records: <><path d="M6 3h9l4 4v14H6z"/><path d="M15 3v5h5"/><path d="M9 12h7M9 16h7"/></>,
    shield: <><path d="M12 3 4.5 6v5.5c0 4.7 3 8 7.5 9.5 4.5-1.5 7.5-4.8 7.5-9.5V6z"/><path d="m9 12 2 2 4-5"/></>,
    refresh: <><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></>,
    arrow: <><path d="M5 12h14"/><path d="m14 7 5 5-5 5"/></>,
  };
  return <svg className="up12-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function MiniLine({ values, label }: { values: number[]; label: string }) {
  if (values.length < 2) return <div className="up12-chart-empty">추이를 표시하려면 두 번 이상의 측정이 필요합니다.</div>;
  const width = 620;
  const height = 210;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values.map((value, index) => {
    const x = 24 + (index / Math.max(values.length - 1, 1)) * (width - 48);
    const y = 18 + (1 - (value - min) / span) * (height - 48);
    return `${x},${y}`;
  }).join(" ");
  return (
    <div className="up12-chart-frame">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${label} 시계열 차트. 최저 ${min}, 최고 ${max}`}>
        <title>{label} 시계열</title>
        {[0, 1, 2, 3].map((line) => <line key={line} x1="24" x2={width - 24} y1={24 + line * 48} y2={24 + line * 48} className="up12-gridline" />)}
        <polyline points={points} className="up12-line" />
        {points.split(" ").map((point, index) => {
          const [cx, cy] = point.split(",");
          return <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={index === values.length - 1 ? 5 : 3.5} className={index === values.length - 1 ? "up12-point latest" : "up12-point"} />;
        })}
      </svg>
      <div className="up12-chart-axis"><span>첫 측정</span><span>최근 측정</span></div>
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
  return ({ draft: "보관됨", analysis_queued: "분석 대기", analyzing: "분석 중", needs_review: "원본 대조 필요", analyzed: "확정됨", failed: "분석 실패" } as const)[status];
}

export function UiPreview12Page() {
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

  const activeProfile = profiles.find((profile) => profile.id === selectedProfileId) ?? profiles[0];
  useEffect(() => {
    if (!selectedProfileId && profiles[0]) setSelectedProfileId(profiles[0].id);
  }, [profiles, selectedProfileId]);

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
    return () => { cancelled = true; };
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

  useEffect(() => { void loadDocumentSets(); }, [loadDocumentSets]);

  const selectedSeries = activeTrendSeries.find((series) => series.key === metricKey);
  const metricSpec = TREND_SERIES.find((series) => series.key === metricKey) ?? TREND_SERIES[0];
  const activeObservations = visibleObservations.filter((point) => point.profileId === activeProfile?.id);
  const latestByMetric = useMemo(() => {
    const map = new Map<string, (typeof activeObservations)[number]>();
    for (const point of activeObservations) map.set(point.metricKey, point);
    return map;
  }, [activeObservations]);
  const latest = selectedSeries?.points.at(-1);
  const first = selectedSeries?.points[0];
  const delta = latest && first ? latest.value - first.value : 0;
  const sourceCounts = activeObservations.reduce<Record<string, number>>((acc, point) => {
    acc[point.sourceType] = (acc[point.sourceType] ?? 0) + 1;
    return acc;
  }, {});
  const assessedRecords = records.filter((record) => record.recordType === "assessment");
  const latestAssessment = assessedRecords[0];
  const assessmentPayload = latestAssessment?.payload as Record<string, unknown> | undefined;
  const highestLevel = typeof assessmentPayload?.highestLevel === "string" ? assessmentPayload.highestLevel : "정보 없음";
  const documentsById = useMemo(() => new Map(documentSets.map((documentSet) => [documentSet.id, documentSet])), [documentSets]);

  const familyMetricRows = Object.entries(familyComparisonData).map(([id, item]) => {
    const points = item.metrics[metricKey] ?? [];
    return { id, name: item.name, relation: item.relation, value: points.at(-1)?.value, date: points.at(-1)?.at };
  });

  return (
    <div className="up12-root">
      {isPreview && <VariantBar current="v12" />}
      {isPreview && (
        <header className="up12-header">
          <div className="up12-brand" aria-label="이어봄 헬스케어 분석">
            <span className="up12-logo"><Icon name="trend" /></span>
            <div><strong>이어봄 분석</strong><span>가족 건강 데이터 워크스페이스</span></div>
          </div>
          <nav className="up12-topnav" aria-label="주요 메뉴">
            <button type="button" onClick={() => void navigate("/")}>가족 홈</button>
            <button type="button" className="active">건강 데이터2</button>
            <button type="button" onClick={() => void navigate("/health-data")}>건강 데이터</button>
            <button type="button" onClick={() => void navigate("/assessment")}>질환 예측</button>
          </nav>
          <button type="button" className="up12-profile-button" onClick={() => void navigate("/account")}>
            <span>{activeProfile?.displayName?.slice(0, 1) ?? "나"}</span> 계정 관리
          </button>
        </header>
      )}

      <div className="up12-shell">
        <aside className="up12-sidebar" aria-label="분석 메뉴">
          <p>분석 메뉴</p>
          <a href="#overview" className="active"><Icon name="overview" />종합 개요</a>
          <a href="#trends"><Icon name="trend" />지표 추이</a>
          <a href="#family"><Icon name="family" />가족 비교</a>
          <a href="#records"><Icon name="records" />기록 근거</a>
          <div className="up12-sidebar-note">
            <Icon name="shield" />
            <strong>데이터 해석 원칙</strong>
            <span>측정값과 예측 결과를 구분해 표시합니다.</span>
          </div>
        </aside>

        <main className="up12-main">
          <section className="up12-title-row" id="overview">
            <div><p className="up12-kicker">HEALTH ANALYTICS</p><h1>건강 변화 분석</h1><p>가족의 실제 측정 기록을 한 흐름에서 비교하고 근거까지 확인하세요.</p></div>
            <button type="button" className="up12-refresh" onClick={() => { void refresh(); void loadDocumentSets(); }} disabled={loading || documentsLoading}><Icon name="refresh" />데이터 새로고침</button>
          </section>

          <section className="up12-filterbar" aria-label="분석 조건">
            <label>분석 대상<select value={activeProfile?.id ?? ""} onChange={(event) => setSelectedProfileId(event.target.value)}>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.displayName} · {profile.relationship}</option>)}</select></label>
            <label>분석 기간<select value={period} onChange={(event) => setPeriod(event.target.value as Period)}><option value="30d">최근 30일</option><option value="90d">최근 90일</option><option value="1y">최근 1년</option><option value="all">전체 기간</option></select></label>
            <label>대표 지표<select value={metricKey} onChange={(event) => setMetricKey(event.target.value)}>{TREND_SERIES.map((metric) => <option key={metric.key} value={metric.key}>{metric.label}</option>)}</select></label>
            <div className="up12-data-status"><span className="up12-status-dot" />{loading || domainLoading ? "데이터 갱신 중" : `관측값 ${visibleObservations.length}개 연결됨`}</div>
          </section>

          <section className="up12-kpis" aria-label="핵심 분석 요약">
            <article><span>최근 {metricSpec.label}</span><strong>{latest ? latest.value : "—"}<small>{metricSpec.unit}</small></strong><p>{latest ? `${formatDate(latest.at)} 측정` : "측정 기록 없음"}</p></article>
            <article><span>기간 내 변화</span><strong className={delta > 0 ? "caution" : "stable"}>{selectedSeries ? `${delta > 0 ? "+" : ""}${Number(delta.toFixed(1))}` : "—"}<small>{metricSpec.unit}</small></strong><p>{selectedSeries ? `${selectedSeries.points.length}개 실제 시점 비교` : "비교 가능한 기록 부족"}</p></article>
            <article><span>최근 위험 판정</span><strong className={highestLevel.includes("HIGH") || highestLevel.includes("높") ? "danger" : "neutral"}>{highestLevel}</strong><p>{latestAssessment ? `${formatDate(latestAssessment.recordedAt)} 판정 스냅샷` : "저장된 판정 없음"}</p></article>
            <article><span>관측 지표 범위</span><strong>{new Set(activeObservations.map((point) => point.metricKey)).size}<small>개 지표</small></strong><p>{records.length}개 기록에서 확인 · 완전성 판정 아님</p></article>
          </section>

          <section className="up12-analysis-grid" id="trends">
            <article className="up12-panel up12-trend-panel">
              <div className="up12-panel-head"><div><span className="up12-eyebrow">개인 시계열</span><h2>{activeProfile?.displayName ?? "사용자"}님의 {metricSpec.label}</h2></div><span className="up12-period-label">{period === "all" ? "전체" : period.replace("d", "일")}</span></div>
              <MiniLine values={selectedSeries?.points.map((point) => point.value) ?? []} label={metricSpec.label} />
              <div className="up12-insight-strip"><strong>관찰 요약</strong><span>{selectedSeries ? `첫 기록 ${first?.value}${metricSpec.unit}에서 최근 ${latest?.value}${metricSpec.unit}로 ${Math.abs(delta).toFixed(1)}${metricSpec.unit} ${delta > 0 ? "상승" : delta < 0 ? "하락" : "유지"}했습니다.` : "현재 기간에는 추이를 계산할 수 있는 측정값이 충분하지 않습니다."}</span></div>
            </article>

            <article className="up12-panel up12-source-panel">
              <div className="up12-panel-head"><div><span className="up12-eyebrow">데이터 출처</span><h2>분석 신뢰도</h2></div></div>
              <div className="up12-source-count"><strong>{activeObservations.length}</strong><span>표준 관측값</span></div>
              <ul>
                <li><span>직접 측정</span><strong>{sourceCounts.direct_vital ?? 0}</strong></li>
                <li><span>검진·판정 스냅샷</span><strong>{sourceCounts.assessment_snapshot ?? 0}</strong></li>
                <li><span>문서 인식</span><strong>{sourceCounts.lab_ocr ?? 0}</strong></li>
              </ul>
              <p>같은 사실을 중복 집계하지 않고 실제 측정 시점을 기준으로 분석합니다.</p>
            </article>
          </section>

          <section className="up12-lower-grid" id="family">
            <article className="up12-panel">
              <div className="up12-panel-head"><div><span className="up12-eyebrow">같은 지표 · 같은 단위</span><h2>가족 {metricSpec.label} 비교</h2></div><span className="up12-count">{familyMetricRows.filter((row) => row.value !== undefined).length}명 기록</span></div>
              <div className="up12-family-list">
                {familyMetricRows.map((row) => {
                  const values = familyMetricRows.flatMap((item) => item.value === undefined ? [] : [item.value]);
                  const max = Math.max(...values, 1);
                  return <div className="up12-family-row" key={row.id}><div><span className="up12-avatar">{row.name.slice(0, 1)}</span><span><strong>{row.name}</strong><small>{row.relation || "가족"}</small></span></div><div className="up12-bar"><i style={{ width: row.value === undefined ? "0%" : `${Math.max(8, (row.value / max) * 100)}%` }} /></div><strong>{row.value ?? "—"}<small>{row.value === undefined ? "" : metricSpec.unit}</small></strong><time>{formatDate(row.date)}</time></div>;
                })}
              </div>
            </article>

            <article className="up12-panel">
              <div className="up12-panel-head"><div><span className="up12-eyebrow">최근값 스캔</span><h2>주요 건강지표</h2></div></div>
              <div className="up12-metric-table" role="table" aria-label="주요 건강지표 최근값">
                {METRIC_KEYS.map((key) => {
                  const spec = TREND_SERIES.find((item) => item.key === key);
                  const point = latestByMetric.get(key);
                  return <button type="button" key={key} className={metricKey === key ? "active" : ""} onClick={() => setMetricKey(key)}><span>{spec?.label ?? key}<small>{formatDate(point?.measuredAt)}</small></span><strong>{point?.value ?? "—"}<small>{point ? point.unit : ""}</small></strong><Icon name="arrow" /></button>;
                })}
              </div>
            </article>
          </section>

          <section className="up12-panel up12-records" id="records">
            <div className="up12-panel-head"><div><span className="up12-eyebrow">원본까지 이어지는 근거</span><h2>건강기록과 원본 서류</h2></div><button type="button" onClick={() => void navigate("/health-data")}>간단 보기 <Icon name="arrow" /></button></div>
            <div className="up12-evidence-layout">
              <div>
                <div className="up12-evidence-heading"><strong>건강기록</strong><span>측정값·판정의 요약</span></div>
                {records.length === 0 ? <div className="up12-empty">표시할 건강기록이 없습니다.</div> : <div className="up12-record-list">{records.slice(0, 5).map((record) => {
                  const source = record.sourceDocumentId ? documentsById.get(record.sourceDocumentId) : undefined;
                  return <button type="button" key={record.id} onClick={() => void navigate(`/members/${record.profileId}/records/${record.id}`)}><span className="up12-record-type">{recordTypeLabel(record.recordType).slice(0, 1)}</span><span><strong>{recordTypeLabel(record.recordType)}</strong><small>{source?.examined_at ? `실제 검사일 ${formatDateTime(source.examined_at)} · ` : ""}{recordSummary(record)}</small></span><time>{source?.examined_at ? formatDate(source.examined_at) : formatDate(record.recordedAt)}</time><span className="up12-source-badge">{record.source === "manual" ? "직접 입력" : record.source === "ocr" ? "문서 분석" : "연동 기록"}</span><Icon name="arrow" /></button>;
                })}</div>}
              </div>
              <div className="up12-document-evidence">
                <div className="up12-evidence-heading"><strong>암호화 보관 원본</strong><span>서류 묶음 단위 · 원본 대조 가능</span></div>
                {documentsError ? <div className="up12-document-error"><span>{documentsError}</span><button type="button" onClick={() => void loadDocumentSets()}>다시 시도</button></div> : null}
                {documentsLoading ? <div className="up12-empty">원본 서류 목록을 불러오는 중입니다…</div> : documentSets.length === 0 ? <div className="up12-empty">이 구성원에게 보관된 원본 서류가 없습니다.</div> : <div className="up12-document-list">{documentSets.map((documentSet) => <button type="button" key={documentSet.id} onClick={() => setOpenDocumentSet(documentSet)}><span className="up12-document-icon">원</span><span><strong>{documentSet.document_type === "health_screening" ? "건강검진 원본" : "의료 서류 원본"}</strong><small>실제 검사일 {formatDateTime(documentSet.examined_at)} · {documentSet.pages.length}장</small></span><span className={`up12-document-status ${documentSet.status}`}>{documentStatus(documentSet.status)}</span><Icon name="arrow" /></button>)}</div>}
              </div>
            </div>
          </section>
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
    void Promise.all(documentSet.pages.map(async (page) => {
      const blob = await serverApiClient.readMedicalDocumentPage(documentSet.id, page.id);
      const url = URL.createObjectURL(blob);
      urls.push(url);
      return [page.id, url] as const;
    })).then((entries) => {
      if (!cancelled) setPageUrls(Object.fromEntries(entries));
    }).catch((caught: unknown) => {
      if (!cancelled) setError(caught instanceof Error ? caught.message : "원본 서류를 열지 못했습니다.");
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; urls.forEach((url) => URL.revokeObjectURL(url)); };
  }, [documentSet]);

  return <Modal kicker="원본·AI 분석·확정값 대조" title="건강검진 원본 서류" className="up12-document-modal" onClose={onClose}>
    <p className="up12-document-intro">저장 시각을 실제 검사일로 바꾸어 보이지 않습니다. 네 날짜는 서로 다른 뜻을 갖습니다.</p>
    <dl className="up12-date-grid">
      <div><dt>실제 검사일</dt><dd>{formatDateTime(documentSet.examined_at)}</dd></div>
      <div><dt>서류 발급일</dt><dd>{formatDateTime(documentSet.issued_at)}</dd></div>
      <div><dt>원본 보관일시</dt><dd>{formatDateTime(documentSet.created_at)}</dd></div>
      <div><dt>AI 분석일시</dt><dd>{formatDateTime(documentSet.analyzed_at)}</dd></div>
    </dl>
    <p className="up12-date-confidence">날짜 확인 상태: <strong>{documentSet.date_confidence === "confirmed" ? "원본 대조로 확인됨" : documentSet.date_confidence === "needs_review" ? "원본 대조 필요" : "아직 확인되지 않음"}</strong></p>
    {loading ? <div className="up12-empty">암호화 보관 원본을 여는 중입니다…</div> : null}
    {error ? <p className="up12-document-error">{error}</p> : null}
    <div className="up12-original-pages">{documentSet.pages.map((page) => {
      const url = pageUrls[page.id];
      return <article key={page.id}><div><strong>{page.page_order}쪽 · {page.original_filename}</strong><small>{Math.ceil(page.plaintext_size / 1024)} KB</small></div>{url ? page.mime_type.startsWith("image/") ? <img src={url} alt={`${page.page_order}쪽 원본 서류`} /> : <a href={url} target="_blank" rel="noreferrer">원본 파일 새 창에서 열기</a> : null}</article>;
    })}</div>
  </Modal>;
}
