import { useState } from "react";
import type { ExamDataPoint, LongitudinalTrendSummary, MetricTrendSeries } from "./examTrendAnalyzer";

interface Props {
  trendData: LongitudinalTrendSummary;
  activeMetric?: MetricTrendSeries;
  onSelectPoint: (point: ExamDataPoint) => void;
  onClose: () => void;
}

function shouldShowUnit(value?: string, unit?: string): boolean {
  if (!unit || !value) return false;
  const cleanVal = value.trim().toLowerCase();
  const cleanUnit = unit.trim().toLowerCase();
  if (!cleanUnit) return false;
  if (cleanVal === cleanUnit) return false;
  if (
    cleanVal === "비해당" ||
    cleanVal === "비대상" ||
    cleanVal === "-" ||
    cleanVal === "정상" ||
    cleanVal === "음성" ||
    cleanVal === "양성"
  ) {
    return false;
  }
  return true;
}

export function ComparisonTableModal({ trendData, activeMetric, onSelectPoint, onClose }: Props) {
  const [selectedCategory, setSelectedCategory] = useState<string>("all");

  const filteredMetrics =
    selectedCategory === "all"
      ? trendData.metrics
      : trendData.metrics.filter((m) => m.category === selectedCategory);

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section
        className="modal-panel comparison-table-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="comparison-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-heading">
          <div>
            <p className="section-kicker">종합 비교표</p>
            <h2 id="comparison-modal-title">연도 및 날짜별 전체 항목 비교표</h2>
            <p className="modal-subtext">과거 검진 및 측정 기록을 날짜순으로 한눈에 비교합니다. 셀을 클릭하면 근거 상세를 확인합니다.</p>
          </div>
          <button className="modal-close" type="button" onClick={onClose} aria-label="닫기">
            ×
          </button>
        </div>

        {/* 카테고리 필터 탭 */}
        <div className="trend-category-tabs modal-tabs" role="tablist" aria-label="검사 항목 분류">
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

        <div className="trend-table-scroll modal-table-scroll">
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
                const isMetricActive = activeMetric?.canonicalName === m.canonicalName;
                return (
                  <tr
                    key={m.canonicalName}
                    className={isMetricActive ? "row-selected" : ""}
                  >
                    <td className="sticky-col font-semibold">{m.canonicalName}</td>
                    {trendData.dates.map((d) => {
                      const pt = pointsMap.get(d);
                      return (
                        <td
                          key={d}
                          className="tabular-value"
                          onClick={() => {
                            if (pt) {
                              onSelectPoint(pt);
                              onClose();
                            }
                          }}
                        >
                          {pt ? (
                            <span className="clickable-cell" title="클릭하여 근거 상세 확인 및 차트 선택">
                              {pt.value}{" "}
                              {shouldShowUnit(pt.value, pt.unit) ? (
                                <small className="unit-label">{pt.unit}</small>
                              ) : null}
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

        <div className="modal-footer">
          <p className="trend-disclaimer">
            ※ 본 비교표는 사용자가 확인하고 브라우저 로컬에 저장한 기록의 수치 정리이며, 의학적 진단/처방이 아닙니다.
          </p>
          <button className="primary-button" type="button" onClick={onClose}>
            닫기
          </button>
        </div>
      </section>
    </div>
  );
}
