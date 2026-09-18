import { useMemo, useState } from "react";
import {
  Area,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TooltipContentProps } from "recharts";

export type VitalTrendRange = "24h" | "7d" | "30d";
export type VitalTrendCategory = "cardio" | "bp" | "recovery" | "metabolic";

export type VitalTrendPoint = {
  timeLabel: string;
  isPredicted: boolean;
  heartRate: number;
  heartRateUpper?: number;
  heartRateLower?: number;
  hrv: number;
  systolicBP: number;
  diastolicBP: number;
  stress: number;
  recoveryScore: number;
  glucose: number;
  spO2: number;
  anomalyNote?: string;
};

const CATEGORIES: { id: VitalTrendCategory; label: string }[] = [
  { id: "cardio", label: "심박수 & 심박변이도 (HRV)" },
  { id: "bp", label: "혈압 (수축기/이완기)" },
  { id: "recovery", label: "스트레스 & 회복 점수" },
  { id: "metabolic", label: "예측 혈당 & 산소포화도" },
];

const RANGES: { id: VitalTrendRange; label: string }[] = [
  { id: "24h", label: "24시간 예측" },
  { id: "7d", label: "7일 주간 예측" },
  { id: "30d", label: "30일 장기 추세" },
];

const TITLES: Record<VitalTrendCategory, string> = {
  cardio: "심박수(HR) 및 심박변이도(HRV) 예측 트렌드",
  bp: "혈압(BP) 일주기 변동 및 예측 곡선",
  recovery: "스트레스 지수 및 자율신경 회복 점수 추이",
  metabolic: "예측 혈당(mg/dL) 및 혈중 산소포화도(SpO2)",
};

function circadianPoint(hour: number, isPredicted: boolean, index: number): VitalTrendPoint {
  const circadianFactor = Math.sin((hour - 6) * (Math.PI / 12));
  const noise = Math.sin(index * 1.5) * 2;
  const baseHR = 70 + Math.round(circadianFactor * 9 + noise);
  const hrVariance = isPredicted ? Math.min(8, 2 + Math.max(index - 12, 0) * 0.5) : 0;
  const baseHRV = Math.round(58 - circadianFactor * 12 + noise * 1.2);
  const timeLabel = `${String(hour).padStart(2, "0")}:00`;
  let anomalyNote: string | undefined;
  if (isPredicted && hour === 15) anomalyNote = "오후 3시 피로도 누적 및 가벼운 스트레스 스파이크 예측";
  if (!isPredicted && hour === 9) anomalyNote = "오전 안정 구간 · 실측 데이터";
  return {
    timeLabel,
    isPredicted,
    heartRate: baseHR,
    heartRateUpper: isPredicted ? Math.round(baseHR + hrVariance) : undefined,
    heartRateLower: isPredicted ? Math.round(baseHR - hrVariance) : undefined,
    hrv: Math.max(25, baseHRV),
    systolicBP: Math.round(116 + circadianFactor * 8 + noise),
    diastolicBP: Math.round(75 + circadianFactor * 5 + noise * 0.5),
    stress: Math.max(10, Math.min(80, Math.round(35 + circadianFactor * 18))),
    recoveryScore: Math.max(40, Math.min(99, Math.round(82 - circadianFactor * 8))),
    glucose: Math.round(95 + (hour === 13 || hour === 19 ? 35 : circadianFactor * 8)),
    spO2: 98,
    anomalyNote,
  };
}

/** 미리보기용 고정 시계열. 렌더마다 Date.now()를 쓰지 않는다. */
export function buildVitalTrendData(range: VitalTrendRange): VitalTrendPoint[] {
  if (range === "7d") {
    return [
      { timeLabel: "월", isPredicted: false, heartRate: 71, hrv: 58, systolicBP: 118, diastolicBP: 76, stress: 30, recoveryScore: 89, glucose: 95, spO2: 98 },
      { timeLabel: "화", isPredicted: false, heartRate: 74, hrv: 52, systolicBP: 120, diastolicBP: 78, stress: 42, recoveryScore: 80, glucose: 102, spO2: 98 },
      { timeLabel: "수", isPredicted: false, heartRate: 76, hrv: 49, systolicBP: 122, diastolicBP: 80, stress: 50, recoveryScore: 73, glucose: 106, spO2: 97, anomalyNote: "야근으로 인한 수면 부족 및 HRV 저하" },
      { timeLabel: "오늘", isPredicted: false, heartRate: 72, hrv: 56, systolicBP: 118, diastolicBP: 76, stress: 32, recoveryScore: 88, glucose: 98, spO2: 98 },
      { timeLabel: "금", isPredicted: true, heartRate: 69, heartRateUpper: 74, heartRateLower: 65, hrv: 62, systolicBP: 116, diastolicBP: 75, stress: 26, recoveryScore: 92, glucose: 94, spO2: 99 },
      { timeLabel: "토", isPredicted: true, heartRate: 67, heartRateUpper: 73, heartRateLower: 63, hrv: 66, systolicBP: 114, diastolicBP: 74, stress: 20, recoveryScore: 95, glucose: 92, spO2: 99 },
      { timeLabel: "일", isPredicted: true, heartRate: 68, heartRateUpper: 75, heartRateLower: 63, hrv: 64, systolicBP: 115, diastolicBP: 75, stress: 24, recoveryScore: 93, glucose: 93, spO2: 98 },
    ];
  }
  if (range === "30d") {
    return Array.from({ length: 30 }, (_, i) => {
      const d = i + 1;
      const isPredicted = d > 21;
      const p = d / 30;
      const heartRate = Math.round(75 - p * 5 + Math.sin(d * 0.8) * 2.5);
      return {
        timeLabel: `${d}일`,
        isPredicted,
        heartRate,
        heartRateUpper: isPredicted ? heartRate + 4 : undefined,
        heartRateLower: isPredicted ? heartRate - 4 : undefined,
        hrv: Math.round(48 + p * 15 + Math.cos(d * 0.8) * 3),
        systolicBP: Math.round(123 - p * 6),
        diastolicBP: Math.round(80 - p * 4),
        stress: Math.max(15, Math.round(48 - p * 16)),
        recoveryScore: Math.round(72 + p * 18),
        glucose: Math.round(102 - p * 5),
        spO2: 98,
      };
    });
  }
  const startHour = 21;
  return Array.from({ length: 25 }, (_, i) => {
    const hour = (startHour + i) % 24;
    return circadianPoint(hour, i > 12, i);
  });
}

function seriesFor(category: VitalTrendCategory): { a: { key: keyof VitalTrendPoint; name: string }; b: { key: keyof VitalTrendPoint; name: string } } {
  if (category === "bp") {
    return {
      a: { key: "systolicBP", name: "수축기 (mmHg)" },
      b: { key: "diastolicBP", name: "이완기 (mmHg)" },
    };
  }
  if (category === "recovery") {
    return {
      a: { key: "recoveryScore", name: "회복 점수" },
      b: { key: "stress", name: "스트레스" },
    };
  }
  if (category === "metabolic") {
    return {
      a: { key: "glucose", name: "혈당 (mg/dL)" },
      b: { key: "spO2", name: "SpO2 (%)" },
    };
  }
  return {
    a: { key: "heartRate", name: "심박수 (bpm)" },
    b: { key: "hrv", name: "심박변이도 HRV (ms)" },
  };
}

const COLOR_A = "#3c315b";
const COLOR_B = "#ab9ff2";
const COLOR_BAND = "#e2dffe";
const COLOR_GRID = "#e9e8ea";
const COLOR_AXIS = "#86848d";
const COLOR_MINT = "#2ec08b";
const COLOR_BLUSH = "#ffdadc";

function VitalTooltip({ active, payload, label }: TooltipContentProps) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload as VitalTrendPoint | undefined;
  const rows = payload.filter((entry) => entry.dataKey !== "heartRateUpper" && entry.dataKey !== "heartRateLower");
  return (
    <div className="up18-vital-tooltip">
      <div className="up18-vital-tooltip-row">
        <strong>{String(label ?? "")}</strong>
        <span className={point?.isPredicted ? "is-pred" : "is-live"}>{point?.isPredicted ? "AI 예측 구간" : "실측 데이터"}</span>
      </div>
      {rows.map((entry) => (
        <div key={String(entry.dataKey)}>
          {entry.name}: {entry.value}
        </div>
      ))}
      {point?.anomalyNote ? <p>{point.anomalyNote}</p> : null}
    </div>
  );
}

export function VitalTrendChartPanel() {
  const [range, setRange] = useState<VitalTrendRange>("24h");
  const [category, setCategory] = useState<VitalTrendCategory>("cardio");
  const data = useMemo(() => buildVitalTrendData(range), [range]);
  const series = seriesFor(category);

  return (
    <article className="up15-card up18-vital-trend-panel">
      <div className="up18-vital-trend-toolbar">
        <div className="up18-vital-trend-tabs" role="tablist" aria-label="바이탈 지표">
          {CATEGORIES.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={category === item.id}
              className={`up18-vital-trend-tab ${category === item.id ? "is-active" : ""}`}
              onClick={() => setCategory(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="up18-vital-trend-ranges" role="group" aria-label="예측 구간">
          {RANGES.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`up18-vital-trend-range ${range === item.id ? "is-active" : ""}`}
              onClick={() => setRange(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="up18-vital-trend-head">
        <div>
          <strong>{TITLES[category]}</strong>
          <span className="up18-vital-trend-badge">AI 예측 신뢰도 95%</span>
          <p>실선은 실측, 점선과 음영은 예측 구간입니다. 미리보기 시계열입니다.</p>
        </div>
        <div className="up18-vital-trend-legend" aria-hidden="true">
          <span>
            <i className="up18-vital-swatch is-a" /> {series.a.name}
          </span>
          <span>
            <i className="up18-vital-swatch is-b" /> {series.b.name}
          </span>
          <span>
            <i className="up18-vital-swatch is-band" /> 신뢰 밴드
          </span>
        </div>
      </div>

      <div className="up18-vital-trend-chart" role="img" aria-label={TITLES[category]}>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart key={`${category}-${range}`} data={data} margin={{ top: 12, right: 16, left: 4, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={COLOR_GRID} vertical={false} />
            <XAxis dataKey="timeLabel" stroke={COLOR_AXIS} fontSize={11} tickLine={false} axisLine={{ stroke: COLOR_GRID }} />
            <YAxis stroke={COLOR_AXIS} fontSize={11} tickLine={false} axisLine={{ stroke: COLOR_GRID }} domain={["auto", "auto"]} width={40} />
            <Tooltip content={VitalTooltip} cursor={{ stroke: COLOR_AXIS, strokeDasharray: "2 3" }} />
            {category === "cardio" ? (
              <>
                <ReferenceLine y={60} stroke={COLOR_MINT} strokeDasharray="3 3" />
                <ReferenceLine y={90} stroke={COLOR_BLUSH} strokeDasharray="3 3" />
                <Area type="monotone" dataKey="heartRateUpper" stroke="none" fill={COLOR_BAND} fillOpacity={0.7} legendType="none" tooltipType="none" />
                <Area type="monotone" dataKey="heartRateLower" stroke="none" fill="#fdfcfe" fillOpacity={0.9} legendType="none" tooltipType="none" />
              </>
            ) : null}
            <Line
              type="monotone"
              dataKey={String(series.a.key)}
              name={series.a.name}
              stroke={COLOR_A}
              strokeWidth={2.5}
              dot={{ r: 3, fill: COLOR_A, strokeWidth: 1, stroke: "#fdfcfe" }}
              activeDot={{ r: 6 }}
              animationDuration={1500}
              animationEasing="ease"
            />
            <Line
              type="monotone"
              dataKey={String(series.b.key)}
              name={series.b.name}
              stroke={COLOR_B}
              strokeWidth={2}
              strokeDasharray="4 4"
              dot={{ r: 3, fill: COLOR_B, strokeWidth: 1, stroke: "#fdfcfe" }}
              activeDot={{ r: 6 }}
              animationDuration={1500}
              animationEasing="ease"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </article>
  );
}
