/**
 * 단일 건강 지표 추이 카드 (SingleMetricCard)
 *
 * 사용자가 선택한 특정 지표(예: 체중, 혈압, 혈당 등) 하나의 시계열 추이를
 * Bento 타일이나 대시보드 컴팩트 영역에 독립적으로 시각화합니다.
 */

import React, { useEffect, useMemo, useState } from "react";
import type { TrendSeries } from "./snapshots";
import { Sparkline } from "./TrendChart";

export interface SingleMetricCardProps {
  seriesList: TrendSeries[];
  defaultKey?: string;
  metricKey?: string;
  onMetricChange?: (key: string) => void;
  allowMetricSwitch?: boolean;
  className?: string;
  title?: string;
}

export const SingleMetricCard: React.FC<SingleMetricCardProps> = ({
  seriesList,
  defaultKey = "weight_kg",
  metricKey,
  onMetricChange,
  allowMetricSwitch = true,
  className = "",
  title,
}) => {
  const [internalKey, setInternalKey] = useState<string>(metricKey ?? defaultKey);

  useEffect(() => {
    if (metricKey !== undefined) {
      setInternalKey(metricKey);
    }
  }, [metricKey]);

  const activeKey = metricKey ?? internalKey;

  // 현재 선택된 계열 찾기 (없으면 첫 번째 사용 가능한 계열)
  const activeSeries = useMemo(() => {
    const found = seriesList.find((s) => s.key === activeKey);
    return found ?? seriesList[0];
  }, [seriesList, activeKey]);

  const hasEnoughData = Boolean(activeSeries && activeSeries.points.length >= 2);

  const values = activeSeries ? activeSeries.points.map((p) => p.value) : [];
  const first = values[0] ?? 0;
  const last = values[values.length - 1] ?? 0;
  const delta = last - first;
  const deltaPercent = first !== 0 ? ((delta / first) * 100).toFixed(1) : "0";

  const handleSelectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const nextKey = e.target.value;
    setInternalKey(nextKey);
    onMetricChange?.(nextKey);
  };

  return (
    <div className={`single-metric-card-container ${className}`}>
      <div
        className="single-metric-header"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "0.75rem",
        }}
      >
        <div>
          {title && (
            <h4 style={{ margin: 0, fontSize: "0.9375rem", fontWeight: 600, color: "#1e293b" }}>
              {title}
            </h4>
          )}
          <span style={{ fontSize: "0.8125rem", color: "#64748b" }}>
            최근 {activeSeries?.points?.length ?? 0}회 측정 추이
          </span>
        </div>

        {allowMetricSwitch && seriesList.length > 1 && (
          <select
            value={activeKey}
            onChange={handleSelectChange}
            style={{
              padding: "4px 8px",
              fontSize: "0.8125rem",
              borderRadius: "6px",
              border: "1px solid #cbd5e1",
              backgroundColor: "#ffffff",
              color: "#334155",
              cursor: "pointer",
            }}
            aria-label="추이 지표 선택"
          >
            {seriesList.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label} ({s.unit})
              </option>
            ))}
          </select>
        )}
      </div>

      {!hasEnoughData ? (
        <div className="single-metric-empty" style={{ padding: "1.5rem", textAlign: "center", color: "#64748b" }}>
          <p style={{ margin: 0, fontSize: "0.9375rem" }}>
            두 시점 이상의 측정 기록이 있어야 추이 그래프가 표시됩니다. {activeSeries ? `(현재 ${activeSeries.points.length}회 기록됨)` : ""}
          </p>
        </div>
      ) : (
        <>
          <div
            className="single-metric-stat-row"
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: "0.75rem",
              marginBottom: "0.5rem",
            }}
          >
            <span style={{ fontSize: "1.75rem", fontWeight: 700, color: "#0f172a", letterSpacing: "-0.02em" }}>
              {last}
              <span style={{ fontSize: "0.9375rem", fontWeight: 400, color: "#64748b", marginLeft: "4px" }}>
                {activeSeries.unit}
              </span>
            </span>

            <span
              style={{
                fontSize: "0.8125rem",
                fontWeight: 600,
                padding: "2px 8px",
                borderRadius: "4px",
                backgroundColor: delta > 0 ? "#fef2f2" : delta < 0 ? "#f0fdf4" : "#f1f5f9",
                color: delta > 0 ? "#dc2626" : delta < 0 ? "#16a34a" : "#64748b",
              }}
            >
              {delta === 0
                ? "변화 없음"
                : `${delta > 0 ? "+" : ""}${Number(delta.toFixed(1))} ${activeSeries.unit} (${delta > 0 ? "+" : ""}${deltaPercent}%)`}
            </span>
          </div>

          {/* Sparkline 차트 출력 */}
          <div className="single-metric-chart-wrap" style={{ width: "100%" }}>
            <Sparkline series={activeSeries} />
          </div>
        </>
      )}
    </div>
  );
};
