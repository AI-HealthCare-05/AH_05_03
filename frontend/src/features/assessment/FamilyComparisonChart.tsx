/**
 * 가족 건강 지표 비교 차트 (FamilyComparisonChart)
 *
 * 한 차트 내에 여러 가족 구성원의 시계열 추이를 동일한 세로축과
 * '실제 측정 시간 간격(X축)'을 기준으로 겹쳐서 비교 렌더링합니다.
 *
 * 핵심 안전 원칙:
 * 1. 가로축은 순번이 아닌 실제 시간 타임스탬프(getTime) 비례로 계산합니다.
 * 2. 측정하지 않은 시점을 0으로 보정하지 않고 실제 측정점들 사이만 보간합니다.
 * 3. 각 가족을 고유 색상 및 점/선 스타일로 명확히 구분합니다.
 */

import React, { useEffect, useMemo, useState } from "react";
import { TREND_SERIES } from "./snapshots";

export interface FamilyProfileMetricSeries {
  profileId: string;
  name: string;
  relation?: string;
  color: string;
  dashArray?: string;
  points: { at: string; value: number }[];
}

export interface FamilyComparisonChartProps {
  /** 비교 가능한 모든 가족의 지표별 데이터 */
  familyData: Record<string, {
    name: string;
    relation?: string;
    metrics: Record<string, { at: string; value: number }[]>;
  }>;
  defaultMetricKey?: string;
  metricKey?: string;
  onMetricChange?: (key: string) => void;
  allowMetricSwitch?: boolean;
  className?: string;
  title?: string;
}

const FAMILY_PALETTE = [
  { color: "#1d4fb8", dashArray: "none" },      // 본인: Primary Blue 실선
  { color: "#059669", dashArray: "none" },      // 배우자: Emerald 실선
  { color: "#d97706", dashArray: "4 3" },     // 부모/자녀: Amber 점선
  { color: "#7c3aed", dashArray: "6 3" },     // 기타: Purple 파선
  { color: "#db2777", dashArray: "none" },      // Pink 실선
];

const W = 540;
const H = 180;
const PAD = { top: 24, right: 28, bottom: 26, left: 36 };

function formatDay(iso: string): string {
  return iso.slice(2, 10).replace(/-/g, ".");
}

export const FamilyComparisonChart: React.FC<FamilyComparisonChartProps> = ({
  familyData,
  defaultMetricKey = "sbp",
  metricKey,
  onMetricChange,
  allowMetricSwitch = true,
  className = "",
  title,
}) => {
  const [internalMetric, setInternalMetric] = useState<string>(metricKey ?? defaultMetricKey);

  useEffect(() => {
    if (metricKey !== undefined) {
      setInternalMetric(metricKey);
    }
  }, [metricKey]);

  const selectedMetric = metricKey ?? internalMetric;
  const [hiddenProfileIds, setHiddenProfileIds] = useState<Set<string>>(new Set());
  const [activePoint, setActivePoint] = useState<{
    profileName: string;
    date: string;
    value: number;
    unit: string;
    x: number;
    y: number;
  } | null>(null);

  const currentMetricSpec = useMemo(
    () => TREND_SERIES.find((s) => s.key === selectedMetric) ?? TREND_SERIES[0],
    [selectedMetric],
  );

  // 가족별 시리즈 구축
  const allSeries = useMemo(() => {
    const list: FamilyProfileMetricSeries[] = [];
    let paletteIdx = 0;

    Object.entries(familyData).forEach(([profileId, info]) => {
      const rawPoints = info.metrics[currentMetricSpec.key] || [];
      const validPoints = rawPoints
        .filter((p) => typeof p.value === "number" && Number.isFinite(p.value))
        .sort((a, b) => a.at.localeCompare(b.at));

      const palette = FAMILY_PALETTE[paletteIdx % FAMILY_PALETTE.length];
      paletteIdx += 1;

      list.push({
        profileId,
        name: info.name,
        relation: info.relation,
        color: palette.color,
        dashArray: palette.dashArray,
        points: validPoints,
      });
    });

    return list;
  }, [familyData, currentMetricSpec]);

  // 화면에 표시할 활성 시리즈 (숨겨지지 않은 것)
  const visibleSeries = useMemo(
    () => allSeries.filter((s) => !hiddenProfileIds.has(s.profileId)),
    [allSeries, hiddenProfileIds],
  );

  // 전체 시간 범위(Min/Max) 및 수치 범위(Min/Max) 계산
  const { minTime, maxTime, minVal, maxVal, hasData } = useMemo(() => {
    let minT = Infinity;
    let maxT = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    let totalPoints = 0;

    visibleSeries.forEach((s) => {
      s.points.forEach((p) => {
        const t = new Date(p.at).getTime();
        if (t < minT) minT = t;
        if (t > maxT) maxT = t;
        if (p.value < minV) minV = p.value;
        if (p.value > maxV) maxV = p.value;
        totalPoints += 1;
      });
    });

    if (totalPoints === 0 || !Number.isFinite(minT)) {
      return { minTime: 0, maxTime: 0, minVal: 0, maxVal: 100, hasData: false };
    }

    // 시간 간격이 0이면 하루 범위로 확장
    if (minT === maxT) {
      minT -= 86400000;
      maxT += 86400000;
    }

    // 상하 여백 10%
    const span = maxV - minV || 10;
    minV = Math.floor(minV - span * 0.1);
    maxV = Math.ceil(maxV + span * 0.1);

    return { minTime: minT, maxTime: maxT, minVal: minV, maxVal: maxV, hasData: true };
  }, [visibleSeries]);

  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const timeSpan = maxTime - minTime || 1;
  const valSpan = maxVal - minVal || 1;

  // 가족별 SVG 패스 및 점 좌표 계산
  const renderedLines = useMemo(() => {
    if (!hasData) return [];

    return visibleSeries.map((s) => {
      const coords = s.points.map((p) => {
        const t = new Date(p.at).getTime();
        const x = PAD.left + ((t - minTime) / timeSpan) * innerW;
        const y = PAD.top + innerH - ((p.value - minVal) / valSpan) * innerH;
        return { x, y, at: p.at, value: p.value };
      });

      const path = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");

      return {
        ...s,
        coords,
        path,
        latestPoint: coords.length > 0 ? coords[coords.length - 1] : null,
      };
    });
  }, [visibleSeries, hasData, minTime, timeSpan, innerW, innerH, minVal, valSpan]);

  const toggleProfile = (profileId: string) => {
    setHiddenProfileIds((prev) => {
      const next = new Set(prev);
      if (next.has(profileId)) {
        next.delete(profileId);
      } else {
        // 최소 1명은 남아있어야 함
        if (next.size < allSeries.length - 1) {
          next.add(profileId);
        }
      }
      return next;
    });
  };

  return (
    <div className={`family-comparison-chart-container ${className}`} style={{ width: "100%" }}>
      {/* 상단 툴바: 제목, 지표 셀렉트, 안내 */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "0.5rem",
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
            실제 측정 일자 기준 가족 수치 중첩 비교 ({currentMetricSpec.label})
          </span>
        </div>

        {allowMetricSwitch && (
          <select
            value={currentMetricSpec.key}
            onChange={(e) => {
              const nextKey = e.target.value;
              setInternalMetric(nextKey);
              onMetricChange?.(nextKey);
            }}
            style={{
              padding: "4px 8px",
              fontSize: "0.8125rem",
              borderRadius: "6px",
              border: "1px solid #cbd5e1",
              backgroundColor: "#ffffff",
              color: "#334155",
              cursor: "pointer",
            }}
            aria-label="비교할 지표 선택"
          >
            {TREND_SERIES.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label} ({s.unit})
              </option>
            ))}
          </select>
        )}
      </div>

      {/* 가족 범례(Legend) 및 토글 칩 */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.5rem",
          alignItems: "center",
          marginBottom: "0.75rem",
          padding: "6px 10px",
          backgroundColor: "#f8fafc",
          borderRadius: "8px",
          border: "1px solid #e2e8f0",
        }}
      >
        <span style={{ fontSize: "0.8125rem", fontWeight: 600, color: "#475569", marginRight: "4px" }}>
          비교 가족:
        </span>
        {allSeries.map((s) => {
          const isHidden = hiddenProfileIds.has(s.profileId);
          const latest = s.points.length > 0 ? s.points[s.points.length - 1].value : null;

          return (
            <button
              key={s.profileId}
              type="button"
              onClick={() => toggleProfile(s.profileId)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "3px 8px",
                borderRadius: "14px",
                border: `1px solid ${isHidden ? "#cbd5e1" : s.color}`,
                backgroundColor: isHidden ? "#ffffff" : `${s.color}10`,
                color: isHidden ? "#94a3b8" : s.color,
                fontSize: "0.8125rem",
                fontWeight: 600,
                cursor: "pointer",
                transition: "all 0.15s ease",
                opacity: isHidden ? 0.5 : 1,
              }}
              title={`${s.name} ${isHidden ? "표시하기" : "숨기기"}`}
            >
              <span
                style={{
                  display: "inline-block",
                  width: "8px",
                  height: "8px",
                  borderRadius: "50%",
                  backgroundColor: isHidden ? "#cbd5e1" : s.color,
                }}
              />
              <span>{s.name}</span>
              {latest !== null && !isHidden && (
                <span style={{ fontSize: "0.8125rem", opacity: 0.85 }}>
                  {latest}
                  <span style={{ fontSize: "0.8125rem" }}>{currentMetricSpec.unit}</span>
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* SVG 차트 렌더링 영역 */}
      {!hasData ? (
        <div style={{ padding: "2rem", textAlign: "center", color: "#64748b", fontSize: "0.9375rem" }}>
          선택한 가족 중 해당 지표({currentMetricSpec.label})의 측정 데이터가 없습니다.
        </div>
      ) : (
        <div style={{ position: "relative", width: "100%", overflow: "hidden" }}>
          <svg
            viewBox={`0 0 ${W} ${H}`}
            style={{ width: "100%", height: "auto", display: "block" }}
            role="img"
            aria-label={`가족 ${currentMetricSpec.label} 비교 차트`}
          >
            {/* 배경 수평 가이드선 (3개) */}
            {[0, 0.5, 1].map((ratio) => {
              const y = PAD.top + innerH * ratio;
              const val = Math.round(maxVal - ratio * valSpan);
              return (
                <g key={ratio}>
                  <line
                    x1={PAD.left}
                    y1={y}
                    x2={W - PAD.right}
                    y2={y}
                    stroke="#e2e8f0"
                    strokeDasharray="2 2"
                    strokeWidth="1"
                  />
                  <text
                    x={PAD.left - 6}
                    y={y + 3}
                    textAnchor="end"
                    fontSize="11"
                    fill="#94a3b8"
                  >
                    {val}
                  </text>
                </g>
              );
            })}

            {/* X축 날짜 축 레이블 */}
            <text x={PAD.left} y={H - 6} fontSize="11" fill="#94a3b8">
              {formatDay(new Date(minTime).toISOString())}
            </text>
            <text x={W - PAD.right} y={H - 6} textAnchor="end" fontSize="11" fill="#94a3b8">
              {formatDay(new Date(maxTime).toISOString())}
            </text>

            {/* 각 가족별 라인 및 점 그리기 */}
            {renderedLines.map((line) => (
              <g key={line.profileId}>
                {line.coords.length > 1 && (
                  <polyline
                    points={line.path}
                    fill="none"
                    stroke={line.color}
                    strokeWidth="2.2"
                    strokeDasharray={line.dashArray}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                )}
                {line.coords.map((c, idx) => (
                  <circle
                    key={idx}
                    cx={c.x}
                    cy={c.y}
                    r={c === line.latestPoint ? "4" : "3"}
                    fill={c === line.latestPoint ? line.color : "#ffffff"}
                    stroke={line.color}
                    strokeWidth="2"
                    style={{ cursor: "pointer" }}
                    onMouseEnter={() =>
                      setActivePoint({
                        profileName: line.name,
                        date: c.at,
                        value: c.value,
                        unit: currentMetricSpec.unit,
                        x: c.x,
                        y: c.y,
                      })
                    }
                    onMouseLeave={() => setActivePoint(null)}
                  />
                ))}
              </g>
            ))}
          </svg>

          {/* 호버 툴팁 */}
          {activePoint && (
            <div
              style={{
                position: "absolute",
                left: `${(activePoint.x / W) * 100}%`,
                top: `${(activePoint.y / H) * 100}%`,
                transform: "translate(-50%, -120%)",
                backgroundColor: "#0f172a",
                color: "#ffffff",
                padding: "4px 8px",
                borderRadius: "4px",
                fontSize: "0.8125rem",
                pointerEvents: "none",
                whiteSpace: "nowrap",
                zIndex: 10,
                boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
              }}
            >
              <strong>{activePoint.profileName}</strong>: {activePoint.value} {activePoint.unit}
              <div style={{ fontSize: "0.8125rem", color: "#94a3b8" }}>{formatDay(activePoint.date)}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
