import { useCallback, useEffect, useMemo, useState, type ReactElement, type ReactNode } from "react";

import { useLocalDomain } from "../../app/localDomainContext";
import type { HealthRecord } from "../../shared/local/domainContracts";
import { FamilyProfileSidebar } from "../family/FamilyProfileSidebar";

type PeriodKey = "1m" | "3m" | "6m" | "1y" | "all";
type ChartPoint = { date: string; value: number };
type ChartSeries = { label: string; color: string; points: ChartPoint[] };

const PERIODS: Array<{ key: PeriodKey; label: string; days?: number }> = [
  { key: "1m", label: "1개월", days: 30 },
  { key: "3m", label: "3개월", days: 90 },
  { key: "6m", label: "6개월", days: 180 },
  { key: "1y", label: "1년", days: 365 },
  { key: "all", label: "전체" },
];

export function HealthDataPage() {
  const { runtime, profiles, loading } = useLocalDomain();
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [period, setPeriod] = useState<PeriodKey>("3m");
  const [records, setRecords] = useState<HealthRecord[]>([]);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [selectedLabMetric, setSelectedLabMetric] = useState("");

  const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId) ?? profiles[0];

  useEffect(() => {
    if (selectedProfile && selectedProfile.id !== selectedProfileId) setSelectedProfileId(selectedProfile.id);
  }, [selectedProfile, selectedProfileId]);

  const loadRecords = useCallback(async () => {
    if (!runtime || !selectedProfile) return;
    setRecordsLoading(true);
    try {
      const result = await runtime.healthRecords.query({ profileId: selectedProfile.id });
      if (!result.ok) throw new Error(result.error.message);
      setRecords(result.value.filter((record) => !record.deletedAt));
      setError(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "건강 데이터를 불러오지 못했습니다.");
    } finally {
      setRecordsLoading(false);
    }
  }, [runtime, selectedProfile]);

  useEffect(() => {
    void loadRecords();
  }, [loadRecords]);

  const periodLabel = PERIODS.find((item) => item.key === period)?.label ?? "선택 기간";
  const filteredRecords = useMemo(() => filterByPeriod(records, period), [period, records]);
  const weightPoints = useMemo(() => extractSingleSeries(filteredRecords, "body_measurement", ["weightKg", "weight"]), [filteredRecords]);
  const systolicPoints = useMemo(() => extractSingleSeries(filteredRecords, "blood_pressure", ["systolicMmHg", "systolic"]), [filteredRecords]);
  const diastolicPoints = useMemo(() => extractSingleSeries(filteredRecords, "blood_pressure", ["diastolicMmHg", "diastolic"]), [filteredRecords]);
  const glucosePoints = useMemo(() => extractSingleSeries(filteredRecords, "blood_glucose", ["valueMgDl", "value", "glucose"]), [filteredRecords]);
  const labMetrics = useMemo(() => collectLabMetrics(filteredRecords), [filteredRecords]);
  const labMetricNames = useMemo(() => [...labMetrics.keys()].sort((a, b) => a.localeCompare(b, "ko")), [labMetrics]);
  const activeLabMetric = labMetricNames.includes(selectedLabMetric) ? selectedLabMetric : (labMetricNames[0] ?? "");
  const screenings = useMemo(
    () => filteredRecords.filter((record) => record.recordType === "health_screening").sort(sortNewest),
    [filteredRecords],
  );

  async function openOriginal(record: HealthRecord) {
    if (!runtime?.documents || !record.sourceDocumentId) return;
    const result = await runtime.documents.readById(record.sourceDocumentId);
    if (!result.ok) return setError(result.error.message);
    const url = URL.createObjectURL(result.value.file);
    window.open(url, "_blank", "noopener,noreferrer");
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  if (!loading && profiles.length === 0) {
    return (
      <div className="product-page health-data-page">
        <section className="dashboard-heading">
          <div><p className="page-kicker">건강 데이터</p><h1>먼저 가족 구성원을 등록해 주세요</h1><p>대시보드에서 프로필을 만들면 건강 변화가 이곳에 표시됩니다.</p></div>
        </section>
      </div>
    );
  }

  return (
    <div className="product-page health-data-page">
      <section className="dashboard-heading health-data-heading">
        <div>
          <p className="page-kicker">건강 데이터</p>
          <h1>{selectedProfile ? `${selectedProfile.displayName}님의 건강 변화` : "건강 변화"}</h1>
          <p>기록된 수치를 기간별로 비교하고 생활습관 변화의 흐름을 확인하세요.</p>
        </div>
        <div className="period-filter" aria-label="조회 기간">
          {PERIODS.map((item) => (
            <button key={item.key} type="button" className={period === item.key ? "is-active" : ""} aria-pressed={period === item.key} onClick={() => setPeriod(item.key)}>
              {item.label}
            </button>
          ))}
        </div>
      </section>

      {error ? <div className="alert error-alert" role="alert">{error}</div> : null}

      <div className="health-data-layout">
        <div className="health-data-main">
          <HealthInsight periodLabel={periodLabel} weight={weightPoints} systolic={systolicPoints} diastolic={diastolicPoints} glucose={glucosePoints} />

          <section className="health-summary-grid" aria-label={`${periodLabel} 건강 요약`}>
            <SummaryCard title="체중" unit="kg" points={weightPoints} />
            <BloodPressureSummary systolic={systolicPoints} diastolic={diastolicPoints} />
            <SummaryCard title="혈당" unit="mg/dL" points={glucosePoints} />
          </section>

          <section className="health-chart-grid">
            <ChartCard title="체중 변화" description={`${periodLabel} 동안 기록된 체중입니다.`} emptyAction="대시보드나 봄이 대화에서 체중을 기록해 보세요.">
              <TimeSeriesChart series={[{ label: "체중", color: "#2563eb", points: weightPoints }]} unit="kg" />
            </ChartCard>
            <ChartCard title="혈압 변화" description="수축기와 이완기 혈압을 함께 비교합니다." emptyAction="혈압을 두 번 이상 기록하면 변화가 나타납니다.">
              <TimeSeriesChart series={[
                { label: "수축기", color: "#ef4444", points: systolicPoints },
                { label: "이완기", color: "#2563eb", points: diastolicPoints },
              ]} unit="mmHg" />
            </ChartCard>
            <ChartCard title="혈당 변화" description="공복·식전·식후 기록을 날짜 순으로 보여줍니다." emptyAction="혈당 기록이 아직 없습니다.">
              <TimeSeriesChart series={[{ label: "혈당", color: "#10b981", points: glucosePoints }]} unit="mg/dL" />
            </ChartCard>
          </section>

          <section className="health-data-panel lab-metric-panel">
            <div className="panel-heading">
              <div><p className="section-kicker">검진 수치</p><h2>항목별 변화</h2><p>서류에서 확인하고 저장한 검사 수치를 비교합니다.</p></div>
              {labMetricNames.length > 0 ? (
                <label className="lab-metric-select">검사항목<select value={activeLabMetric} onChange={(event) => setSelectedLabMetric(event.currentTarget.value)}>{labMetricNames.map((name) => <option key={name}>{name}</option>)}</select></label>
              ) : null}
            </div>
            {activeLabMetric ? (
              <TimeSeriesChart series={[{ label: activeLabMetric, color: "#7c3aed", points: labMetrics.get(activeLabMetric)?.points ?? [] }]} unit={labMetrics.get(activeLabMetric)?.unit ?? ""} />
            ) : (
              <EmptyChart message="아직 구조화된 검진 수치가 없습니다. 건강 파일에서 검진 서류를 추가해 주세요." />
            )}
          </section>

          <section className="health-data-panel screening-history-panel">
            <div className="panel-heading"><div><p className="section-kicker">건강검진 이력</p><h2>저장된 검진 결과</h2><p>검진 요약을 확인하고 연결된 원본 서류를 열 수 있습니다.</p></div>{recordsLoading ? <span className="subtle-status">불러오는 중…</span> : null}</div>
            {screenings.length === 0 ? <div className="compact-empty"><strong>아직 저장된 건강검진 결과가 없습니다.</strong><p>건강 파일에서 검진 서류를 추가해 주세요.</p></div> : (
              <div className="screening-history-list">
                {screenings.map((record) => {
                  const payload = record.payload as Record<string, unknown>;
                  return (
                    <article key={record.id}>
                      <div><time dateTime={record.recordedAt}>{formatDate(record.recordedAt)}</time><strong>{textValue(payload.screeningName) ?? "건강검진"}</strong><p>{textValue(payload.institution) ?? textValue(payload.summary) ?? "검진 결과가 저장되어 있습니다."}</p></div>
                      <button type="button" className="secondary-button" disabled={!record.sourceDocumentId || !runtime?.documents} onClick={() => void openOriginal(record)}>원본 서류 보기</button>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        {selectedProfile ? (
          <FamilyProfileSidebar profiles={profiles} selectedProfileId={selectedProfile.id} onSelect={setSelectedProfileId} description="구성원을 선택하면 해당 가족의 건강 데이터로 전환됩니다." />
        ) : null}
      </div>
    </div>
  );
}

function HealthInsight({ periodLabel, weight, systolic, diastolic, glucose }: { periodLabel: string; weight: ChartPoint[]; systolic: ChartPoint[]; diastolic: ChartPoint[]; glucose: ChartPoint[] }) {
  const insight = changeSentence(periodLabel, "체중", weight, "kg")
    ?? averageSentence(periodLabel, "혈압", systolic, diastolic)
    ?? averageValueSentence(periodLabel, "혈당", glucose, "mg/dL")
    ?? "아직 비교할 건강기록이 충분하지 않습니다. 같은 항목을 두 번 이상 기록하면 변화를 알려드릴게요.";
  return <section className="health-insight-card"><span aria-hidden="true">↗</span><div><p className="section-kicker">기간 변화 요약</p><strong>{insight}</strong><small>저장된 기록을 기준으로 계산한 값이며 의료적 진단이 아닙니다.</small></div></section>;
}

function SummaryCard({ title, unit, points }: { title: string; unit: string; points: ChartPoint[] }) {
  if (points.length === 0) return <article className="health-summary-card is-empty"><span>{title}</span><strong>기록 없음</strong><small>아직 기록이 없습니다.</small></article>;
  const latest = points.at(-1)?.value ?? 0;
  const average = points.reduce((sum, point) => sum + point.value, 0) / points.length;
  const change = points.length > 1 ? latest - points[0].value : undefined;
  return <article className="health-summary-card"><span>{title}</span><strong>{formatNumber(latest)} <small>{unit}</small></strong><p>기간 평균 {formatNumber(average)} {unit}</p><em>{change === undefined ? "비교 기록 부족" : `${change > 0 ? "+" : ""}${formatNumber(change)} ${unit} 변화`}</em></article>;
}

function BloodPressureSummary({ systolic, diastolic }: { systolic: ChartPoint[]; diastolic: ChartPoint[] }) {
  if (systolic.length === 0 || diastolic.length === 0) return <article className="health-summary-card is-empty"><span>혈압</span><strong>기록 없음</strong><small>아직 기록이 없습니다.</small></article>;
  const latestSystolic = systolic.at(-1)?.value ?? 0;
  const latestDiastolic = diastolic.at(-1)?.value ?? 0;
  return <article className="health-summary-card"><span>혈압</span><strong>{formatNumber(latestSystolic)}/{formatNumber(latestDiastolic)} <small>mmHg</small></strong><p>기간 평균 {formatNumber(average(systolic))}/{formatNumber(average(diastolic))}</p><em>{systolic.length > 1 ? `${systolic.length}회 기록` : "비교 기록 부족"}</em></article>;
}

function ChartCard({ title, description, emptyAction, children }: { title: string; description: string; emptyAction: string; children: ReactNode }) {
  const hasPoints = (children as ReactElement<{ series?: ChartSeries[] }>).props.series?.some((series) => series.points.length > 0);
  return <section className="health-data-panel health-chart-card"><div className="panel-heading"><div><h2>{title}</h2><p>{description}</p></div></div>{hasPoints ? children : <EmptyChart message={emptyAction} />}</section>;
}

function EmptyChart({ message }: { message: string }) {
  return <div className="health-chart-empty"><span aria-hidden="true">⌁</span><strong>아직 기록이 없습니다.</strong><p>{message}</p></div>;
}

function TimeSeriesChart({ series, unit }: { series: ChartSeries[]; unit: string }) {
  const available = series.filter((item) => item.points.length > 0);
  const all = available.flatMap((item) => item.points);
  if (all.length === 0) return null;
  const width = 720;
  const height = 250;
  const padding = { left: 54, right: 24, top: 24, bottom: 42 };
  const timestamps = all.map((point) => new Date(point.date).getTime());
  const values = all.map((point) => point.value);
  const minTime = Math.min(...timestamps);
  const maxTime = Math.max(...timestamps);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const valuePadding = Math.max((rawMax - rawMin) * 0.18, 1);
  const minValue = rawMin - valuePadding;
  const maxValue = rawMax + valuePadding;
  const x = (date: string) => padding.left + ((new Date(date).getTime() - minTime) / Math.max(maxTime - minTime, 1)) * (width - padding.left - padding.right);
  const y = (value: number) => padding.top + ((maxValue - value) / Math.max(maxValue - minValue, 1)) * (height - padding.top - padding.bottom);

  return (
    <div className="time-series-chart">
      <div className="chart-legend">{available.map((item) => <span key={item.label}><i style={{ background: item.color }} />{item.label}</span>)}</div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${available.map((item) => item.label).join(", ")} 시계열 그래프`}>
        {[0, 1, 2, 3].map((line) => {
          const lineY = padding.top + (line / 3) * (height - padding.top - padding.bottom);
          const label = maxValue - (line / 3) * (maxValue - minValue);
          return <g key={line}><line x1={padding.left} x2={width - padding.right} y1={lineY} y2={lineY} className="chart-grid-line" /><text x={padding.left - 9} y={lineY + 4} textAnchor="end">{formatNumber(label)}</text></g>;
        })}
        {available.map((item) => {
          const points = item.points.map((point) => `${x(point.date)},${y(point.value)}`).join(" ");
          return <g key={item.label}><polyline points={points} fill="none" stroke={item.color} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />{item.points.map((point) => <circle key={`${item.label}-${point.date}-${point.value}`} cx={x(point.date)} cy={y(point.value)} r="4" fill="white" stroke={item.color} strokeWidth="3"><title>{`${formatDate(point.date)} ${formatNumber(point.value)} ${unit}`}</title></circle>)}</g>;
        })}
        <text x={padding.left} y={height - 12}>{formatShortDate(new Date(minTime))}</text>
        <text x={width - padding.right} y={height - 12} textAnchor="end">{formatShortDate(new Date(maxTime))}</text>
        {unit ? <text x={width - padding.right} y={14} textAnchor="end" className="chart-unit">단위: {unit}</text> : null}
      </svg>
    </div>
  );
}

function filterByPeriod(records: HealthRecord[], period: PeriodKey): HealthRecord[] {
  const days = PERIODS.find((item) => item.key === period)?.days;
  if (!days) return [...records].sort(sortOldest);
  const from = Date.now() - days * 24 * 60 * 60 * 1000;
  return records.filter((record) => new Date(record.recordedAt).getTime() >= from).sort(sortOldest);
}

function extractSingleSeries(records: HealthRecord[], recordType: HealthRecord["recordType"], keys: string[]): ChartPoint[] {
  return records.flatMap((record) => {
    if (record.recordType !== recordType) return [];
    const payload = record.payload as Record<string, unknown>;
    const value = firstNumber(payload, keys);
    return value === undefined ? [] : [{ date: record.recordedAt, value }];
  }).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

function collectLabMetrics(records: HealthRecord[]): Map<string, { unit: string; points: ChartPoint[] }> {
  const result = new Map<string, { unit: string; points: ChartPoint[] }>();
  const add = (name: string, value: unknown, unit: unknown, date: string) => {
    const numeric = numericValue(value);
    if (!name.trim() || numeric === undefined) return;
    const current = result.get(name.trim()) ?? { unit: typeof unit === "string" ? unit : "", points: [] };
    current.points.push({ date, value: numeric });
    if (!current.unit && typeof unit === "string") current.unit = unit;
    result.set(name.trim(), current);
  };
  for (const record of records) {
    const payload = record.payload as Record<string, unknown>;
    if (record.recordType === "lab_result") add(textValue(payload.testName) ?? "", payload.value, payload.unit, record.recordedAt);
    if (record.recordType === "health_screening" && Array.isArray(payload.items)) {
      for (const item of payload.items) {
        if (!item || typeof item !== "object") continue;
        const row = item as Record<string, unknown>;
        add(textValue(row.testName) ?? "", row.value, row.unit, record.recordedAt);
      }
    }
  }
  for (const metric of result.values()) metric.points.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  return result;
}

function firstNumber(payload: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = numericValue(payload[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

function numericValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/)?.[0]);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function textValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function changeSentence(periodLabel: string, label: string, points: ChartPoint[], unit: string): string | undefined {
  if (points.length < 2) return undefined;
  const change = (points.at(-1)?.value ?? 0) - points[0].value;
  const periodPhrase = periodLabel === "전체" ? "전체 기록에서" : `최근 ${periodLabel}간`;
  if (Math.abs(change) < 0.05) return `${periodPhrase} ${label}이 거의 변하지 않았습니다.`;
  return `${periodPhrase} ${label}이 ${formatNumber(Math.abs(change))}${unit} ${change < 0 ? "감소" : "증가"}했습니다.`;
}

function averageSentence(periodLabel: string, label: string, systolic: ChartPoint[], diastolic: ChartPoint[]): string | undefined {
  if (systolic.length === 0 || diastolic.length === 0) return undefined;
  return `${periodLabel} ${label} 평균은 ${formatNumber(average(systolic))}/${formatNumber(average(diastolic))}mmHg입니다.`;
}

function averageValueSentence(periodLabel: string, label: string, points: ChartPoint[], unit: string): string | undefined {
  if (points.length === 0) return undefined;
  return `${periodLabel} ${label} 평균은 ${formatNumber(average(points))}${unit}입니다.`;
}

function average(points: ChartPoint[]): number {
  return points.reduce((sum, point) => sum + point.value, 0) / Math.max(points.length, 1);
}

function sortOldest(a: HealthRecord, b: HealthRecord): number { return new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime(); }
function sortNewest(a: HealthRecord, b: HealthRecord): number { return new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime(); }
function formatNumber(value: number): string { return Number.isInteger(value) ? String(value) : value.toFixed(1); }
function formatDate(value: string): string { return new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "short", day: "numeric" }).format(new Date(value)); }
function formatShortDate(value: Date): string { return new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric" }).format(value); }
