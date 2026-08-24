import { useMemo, useState } from "react";
import type { HealthRecord } from "../../shared/local/domainContracts";
import { analyzeExamTrends, type MetricTrendSeries } from "./examTrendAnalyzer";

interface Props {
  records: HealthRecord[];
  profileName: string;
}

export function ExamTrendSection({ records, profileName }: Props) {
  const trendData = useMemo(() => analyzeExamTrends(records), [records]);
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [selectedMetricName, setSelectedMetricName] = useState<string | null>(null);

  const filteredMetrics = useMemo(() => {
    if (selectedCategory === "all") return trendData.metrics;
    return trendData.metrics.filter((m) => m.category === selectedCategory);
  }, [trendData, selectedCategory]);

  const activeMetric = useMemo(() => {
    if (selectedMetricName) {
      const found = trendData.metrics.find((m) => m.canonicalName === selectedMetricName);
      if (found) return found;
    }
    return filteredMetrics[0] || trendData.metrics[0];
  }, [trendData, selectedMetricName, filteredMetrics]);

  if (trendData.metrics.length === 0) {
    return (
      <section className="exam-trend-section" aria-labelledby="exam-trend-heading">
        <div className="trend-header">
          <div>
            <p className="section-kicker">시계열 분석</p>
            <h3 id="exam-trend-heading">검사 수치 변화 추이 (트렌드)</h3>
          </div>
        </div>
        <div className="trend-empty-card">
          <span className="trend-empty-icon" aria-hidden="true">📊</span>
          <strong>아직 비교할 검사 수치가 충분하지 않아요.</strong>
          <p>건강검진 결과서(OCR)나 혈당·혈압 수치가 2회 이상 등록되면, 같은 항목의 과거 대비 변화를 자동으로 분석해 드립니다.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="exam-trend-section" aria-labelledby="exam-trend-heading">
      <div className="trend-header">
        <div>
          <p className="section-kicker">시계열 데이터 비교</p>
          <h3 id="exam-trend-heading">{profileName}님의 검사 수치 변화 추이</h3>
          <p className="trend-subtext">로컬에 저장된 과거 기록에서 동일한 검사 항목을 매칭하여 변화를 보여줍니다.</p>
        </div>
        <div className="trend-badge">
          <span>기록된 검사일: {trendData.dates.length}회</span>
        </div>
      </div>

      {/* 카테고리 필터 탭 */}
      <div className="trend-category-tabs" role="tablist" aria-label="검사 항목 분류">
        {[
          { key: "all", label: "전체 항목" },
          { key: "blood_glucose", label: "혈당" },
          { key: "blood_pressure", label: "혈압" },
          { key: "liver", label: "간기능" },
          { key: "lipid", label: "지질·콜레스테롤" },
          { key: "kidney", label: "신장·소변" },
          { key: "other", label: "기타" },
        ].map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={selectedCategory === tab.key ? "trend-tab is-active" : "trend-tab"}
            onClick={() => setSelectedCategory(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 주요 지표 요약 카드 그리드 */}
      <div className="trend-card-grid">
        {filteredMetrics.slice(0, 6).map((metric) => {
          const isSelected = activeMetric?.canonicalName === metric.canonicalName;
          const diff = metric.latest.diffFromPrev;
          return (
            <button
              key={metric.canonicalName}
              type="button"
              className={isSelected ? "trend-summary-card is-selected" : "trend-summary-card"}
              onClick={() => setSelectedMetricName(metric.canonicalName)}
            >
              <div className="trend-card-top">
                <span className="trend-metric-name">{metric.canonicalName}</span>
                <span className="trend-data-count">{metric.dataPoints.length}회 측정</span>
              </div>
              <div className="trend-card-value">
                <strong>{metric.latest.value}</strong>
                <small>{metric.unit}</small>
              </div>
              <div className="trend-card-bottom">
                <span className="trend-latest-date">{metric.latest.date}</span>
                {diff ? (
                  <span className={`trend-delta-chip delta-${diff.direction}`}>
                    {diff.direction === "increased" ? "▲" : diff.direction === "decreased" ? "▼" : "•"}{" "}
                    {diff.text} {metric.unit}
                  </span>
                ) : (
                  <span className="trend-delta-chip delta-first">첫 기록</span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* 선택된 항목의 인터랙티브 트렌드 차트 */}
      {activeMetric && (
        <div className="trend-detail-box">
          <div className="trend-detail-header">
            <h4>
              <strong>{activeMetric.canonicalName}</strong> 시계열 추이
            </h4>
            {activeMetric.overallChange ? (
              <span className={`overall-change-badge delta-${activeMetric.overallChange.direction}`}>
                첫 검사({activeMetric.earliest.date}) 대비: {activeMetric.overallChange.text} {activeMetric.unit}
              </span>
            ) : null}
          </div>

          <TrendSvgChart metric={activeMetric} />

          {/* 타임라인 포인트 목록 */}
          <div className="trend-timeline-list">
            {activeMetric.dataPoints.map((pt, idx) => (
              <div key={pt.dateTime + idx} className="trend-timeline-item">
                <span className="timeline-date">{pt.date}</span>
                <span className="timeline-value">
                  <strong>{pt.value}</strong> {pt.unit}
                </span>
                {pt.judgment ? <span className="timeline-judgment">{pt.judgment}</span> : null}
                {pt.diffFromPrev ? (
                  <span className={`timeline-diff delta-${pt.diffFromPrev.direction}`}>
                    (직전 대비 {pt.diffFromPrev.text})
                  </span>
                ) : (
                  <span className="timeline-diff initial-mark">(기준점)</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 종합 시계열 비교 테이블 */}
      <div className="trend-table-wrapper">
        <h4>연도 및 날짜별 전체 항목 비교표</h4>
        <div className="trend-table-scroll">
          <table className="trend-comparison-table">
            <thead>
              <tr>
                <th className="sticky-col">검사 항목</th>
                {trendData.dates.map((d) => (
                  <th key={d}>{d}</th>
                ))}
                <th>최근 변화</th>
              </tr>
            </thead>
            <tbody>
              {filteredMetrics.map((m) => {
                const pointsMap = new Map(m.dataPoints.map((p) => [p.date, p]));
                const diff = m.latest.diffFromPrev;
                return (
                  <tr key={m.canonicalName}>
                    <td className="sticky-col font-semibold">{m.canonicalName}</td>
                    {trendData.dates.map((d) => {
                      const pt = pointsMap.get(d);
                      return (
                        <td key={d} className="tabular-value">
                          {pt ? (
                            <span>
                              {pt.value} <small className="unit-label">{pt.unit}</small>
                            </span>
                          ) : (
                            <span className="no-data">-</span>
                          )}
                        </td>
                      );
                    })}
                    <td className="trend-cell">
                      {diff ? (
                        <span className={`delta-text delta-${diff.direction}`}>
                          {diff.direction === "increased" ? "▲" : diff.direction === "decreased" ? "▼" : "•"} {diff.text}
                        </span>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p className="trend-disclaimer">
        ※ 본 비교표는 사용자가 저장한 검사 결과의 단순 수치 변화 기록이며, 의학적 진단이나 권고가 아닙니다. 이상 수치가 관찰될 경우 전문 의료기관과 상담하세요.
      </p>
    </section>
  );
}

function TrendSvgChart({ metric }: { metric: MetricTrendSeries }) {
  const points = metric.dataPoints.filter((p) => p.numericValue !== undefined);
  if (points.length < 2) {
    return <p className="chart-insufficient-note">2회 이상 측정된 수치 데이터가 있어 차트가 활성화됩니다. (현재 1회 등록됨)</p>;
  }

  const values = points.map((p) => p.numericValue as number);
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const valRange = maxVal - minVal === 0 ? 1 : maxVal - minVal;

  const width = 580;
  const height = 160;
  const paddingX = 50;
  const paddingY = 30;

  const chartWidth = width - paddingX * 2;
  const chartHeight = height - paddingY * 2;

  const coords = points.map((p, index) => {
    const x = paddingX + (index / (points.length - 1)) * chartWidth;
    const y = height - paddingY - (((p.numericValue as number) - minVal) / valRange) * chartHeight;
    return { x, y, point: p };
  });

  const pathD = coords.reduce((acc, curr, index) => {
    return `${acc} ${index === 0 ? "M" : "L"} ${curr.x} ${curr.y}`;
  }, "");

  return (
    <div className="trend-svg-container">
      <svg viewBox={`0 0 ${width} ${height}`} className="trend-svg-chart" aria-label="수치 변화 그래프">
        {/* 가로 가이드라인 */}
        <line x1={paddingX} y1={paddingY} x2={width - paddingX} y2={paddingY} stroke="#e5e7eb" strokeDasharray="3 3" />
        <line x1={paddingX} y1={height - paddingY} x2={width - paddingX} y2={height - paddingY} stroke="#e5e7eb" />

        {/* 꺾은선 경로 */}
        <path d={pathD} fill="none" stroke="#2563eb" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />

        {/* 데이터 포인트 점 & 수치 라벨 */}
        {coords.map((c, i) => (
          <g key={i}>
            <circle cx={c.x} cy={c.y} r="5" fill="#2563eb" stroke="#ffffff" strokeWidth="2" />
            <text x={c.x} y={c.y - 10} textAnchor="middle" fontSize="11" fontWeight="600" fill="#1e293b">
              {c.point.numericValue}
            </text>
            <text x={c.x} y={height - 10} textAnchor="middle" fontSize="10" fill="#64748b">
              {c.point.date.slice(5)}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
