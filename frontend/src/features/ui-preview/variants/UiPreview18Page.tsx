import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { useLocalDomain } from "../../../app/localDomainContext";
import { TREND_SERIES } from "../../assessment/snapshots";
import { useHealthTimeSeries } from "../../data/useHealthTimeSeries";
import type { HealthRecord } from "../../../shared/local/domainContracts";
import { VariantBar } from "../components/VariantBar";
import { StitchAppHeader } from "../components/StitchAppHeader";
import { VitalTrendChartPanel } from "../components/VitalTrendChartPanel";
import { Modal } from "../../../shared/ui/Modal";
import { serverApiClient } from "../../../shared/api/serverApiClient";
import { regionRisks, type RegionRisk } from "../../home/bodyRisk";
import { hushBomi, tellBomi } from "../../health-assistant/bomiHint";
import "../styles/shadcn-preview-variants.css";
import "../styles/ui-preview18.css";

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

function Icon({
  name,
}: {
  name: "ghost" | "search" | "bell" | "arrow-right" | "check" | "chevron-right" | "plus" | "send" | "close" | "activity";
}) {
  const paths: Record<string, React.ReactNode> = {
    ghost: (
      <path d="M12 2a8 8 0 0 0-8 8v11l3-2 3 2 2-2 2 2 3-2 3 2V10a8 8 0 0 0-8-8zm-2.5 9a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z" />
    ),
    search: (
      <>
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </>
    ),
    bell: (
      <>
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </>
    ),
    "arrow-right": (
      <>
        <line x1="5" y1="12" x2="19" y2="12" />
        <polyline points="12 5 19 12 12 19" />
      </>
    ),
    check: <polyline points="20 6 9 17 4 12" />,
    "chevron-right": <polyline points="9 18 15 12 9 6" />,
    plus: (
      <>
        <line x1="12" y1="5" x2="12" y2="19" />
        <line x1="5" y1="12" x2="19" y2="12" />
      </>
    ),
    send: (
      <>
        <line x1="22" y1="2" x2="11" y2="13" />
        <polygon points="22 2 15 22 11 13 2 9 22 2" />
      </>
    ),
    close: (
      <>
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </>
    ),
    activity: <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />,
  };

  return (
    <svg
      className="up15-icon"
      viewBox="0 0 24 24"
      fill={name === "ghost" ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={name === "ghost" ? "0" : "1.8"}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

/**
 * 4K 와이드 화면에 최적화된 유체 벡터 시계열 차트 (health-data2 연동)
 * Violet Capsule Minimal 색상 (Aubergine #3c315b, Periwinkle #ab9ff2) 적용
 */
function HealthData2ThemeWideChart({
  systolicValues,
  diastolicValues,
}: {
  systolicValues: number[];
  diastolicValues?: number[];
  label?: string;
}) {
  const points1 = systolicValues.length > 0 ? systolicValues : [120, 122, 126, 128];
  const points2 = diastolicValues && diastolicValues.length > 0 ? diastolicValues : [];

  const allVals = [...points1, ...points2];
  const minVal = Math.min(...allVals, 60);
  const maxVal = Math.max(...allVals, 140);
  const range = maxVal - minVal || 1;

  const w = 480;
  const h = 180;
  const padX = 24;
  const padY = 24;

  const getX = (idx: number, len: number) => {
    if (len <= 1) return w / 2;
    return padX + (idx / (len - 1)) * (w - padX * 2);
  };
  const getY = (val: number) => {
    return h - padY - ((val - minVal) / range) * (h - padY * 2);
  };

  const path1 = points1.map((v, i) => `${i === 0 ? "M" : "L"} ${getX(i, points1.length)} ${getY(v)}`).join(" ");
  const path2 = points2.map((v, i) => `${i === 0 ? "M" : "L"} ${getX(i, points2.length)} ${getY(v)}`).join(" ");

  return (
    <div style={{ position: "relative", width: "100%" }}>
      <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", height: "auto", display: "block" }}>
        {/* 그리드 가이드라인 */}
        {[0, 0.5, 1].map((ratio) => {
          const y = padY + ratio * (h - padY * 2);
          return (
            <line
              key={ratio}
              x1={padX}
              y1={y}
              x2={w - padX}
              y2={y}
              stroke="var(--up15-ash)"
              strokeDasharray="4 4"
              strokeWidth="1"
            />
          );
        })}

        {/* 보조 수치 라인 (이완기 - 연보라) */}
        {points2.length > 0 && (
          <>
            <path d={path2} fill="none" stroke="var(--up15-periwinkle)" strokeWidth="3" strokeLinecap="round" />
            {points2.map((val, idx) => {
              const cx = getX(idx, points2.length);
              const cy = getY(val);
              const isLast = idx === points2.length - 1;
              return (
                <g key={`d-${idx}`}>
                  <circle
                    cx={cx}
                    cy={cy}
                    r={isLast ? 5.5 : 4}
                    fill="var(--up15-periwinkle)"
                    stroke="#ffffff"
                    strokeWidth="2"
                  />
                  {isLast && (
                    <g transform={`translate(${cx - 18}, ${cy - 24})`}>
                      <rect width="36" height="18" rx="9" fill="var(--up15-periwinkle)" />
                      <text x="18" y="13" fontSize="11" fontWeight="600" fill="var(--up15-aubergine)" textAnchor="middle">
                        {val}
                      </text>
                    </g>
                  )}
                </g>
              );
            })}
          </>
        )}

        {/* 주 수치 라인 (수축기 / 단일지표 - 딥 오버진) */}
        <path d={path1} fill="none" stroke="var(--up15-aubergine)" strokeWidth="3.5" strokeLinecap="round" />
        {points1.map((val, idx) => {
          const cx = getX(idx, points1.length);
          const cy = getY(val);
          const isLast = idx === points1.length - 1;
          return (
            <g key={`s-${idx}`}>
              <circle
                cx={cx}
                cy={cy}
                r={isLast ? 6 : 4.5}
                fill="var(--up15-aubergine)"
                stroke="#ffffff"
                strokeWidth="2"
              />
              {isLast && (
                <g transform={`translate(${cx - 20}, ${cy - 26})`}>
                  <rect width="40" height="20" rx="10" fill="var(--up15-aubergine)" />
                  <text x="20" y="14" fontSize="11" fontWeight="600" fill="#ffffff" textAnchor="middle">
                    {val}
                  </text>
                </g>
              )}
            </g>
          );
        })}
      </svg>

      <div style={{ display: "flex", justifyContent: "space-between", padding: "0 24px", fontSize: "11px", color: "var(--up15-fog)", marginTop: "4px" }}>
        <span>첫 측정</span>
        <span style={{ color: "var(--up15-aubergine)", fontWeight: 600 }}>최근 실측</span>
      </div>
    </div>
  );
}

function formatDateTime(value?: string | null) {
  if (!value) return "확인되지 않음";
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function formatDateToLocalKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function UiPreview18Page() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const isPreview = pathname.startsWith("/ui-preview") || pathname === "/";
  const { runtime, profiles } = useLocalDomain();

  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [period, setPeriod] = useState<Period>("1y");
  const [metricKey, setMetricKey] = useState("sbp");
  const [records, setRecords] = useState<HealthRecord[]>([]);
  const [documentSets, setDocumentSets] = useState<MedicalDocumentSet[]>([]);
  const [openDocumentSet, setOpenDocumentSet] = useState<MedicalDocumentSet>();
  const [selectedOrgan] = useState<string>("stomach"); // 컨셉안: 명치/소화기계
  const [isDarkBodyBg, setIsDarkBodyBg] = useState(false);

  // 타임라인 반응형 동적 일수 및 자정 롤오버 상태
  const [dateOffsetDays, setDateOffsetDays] = useState(0);
  const [todayLocalKey, setTodayLocalKey] = useState<string>(() => formatDateToLocalKey(new Date()));
  const [timelineSpanMode] = useState<"auto" | 7 | 10 | 14 | 21 | 28>("auto");
  const [autoSpanDays, setAutoSpanDays] = useState<number>(10);
  const timelineContainerRef = useRef<HTMLDivElement>(null);

  // 컨테이너 너비 기반 반응형 정수 컬럼 자동 계산 (가로 스크롤 완전 방지 & 컬럼 단위 절삭)
  useEffect(() => {
    const el = timelineContainerRef.current;
    if (!el) return;

    const updateSpan = (width: number) => {
      // 좌측 고정 '구성원' 컬럼(약 120px) + 좌우 내부 패딩(약 36px) 공제
      const availableWidth = Math.max(width - 156, 260);
      // 컬럼 1개당 최적 폭: 68px ~ 80px (정수 컬럼으로 딱 맞춤)
      const columnTargetWidth = 72;
      const calculatedDays = Math.max(5, Math.floor(availableWidth / columnTargetWidth));
      setAutoSpanDays(calculatedDays);
    };

    updateSpan(el.clientWidth);

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
          updateSpan(entry.contentRect.width);
        }
      });
      observer.observe(el);
      return () => observer.disconnect();
    }

    const handleResize = () => updateSpan(el.clientWidth);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // 선택된 모드 또는 자동 계산된 컬럼 수 (최소 5일 이상)
  const activeSpanDays = timelineSpanMode === "auto" ? autoSpanDays : timelineSpanMode;

  // 자정 자동 롤오버
  useEffect(() => {
    let timerId: ReturnType<typeof setTimeout> | undefined;
    const scheduleMidnightUpdate = () => {
      const now = new Date();
      const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 50);
      const msUntilMidnight = Math.max(1000, nextMidnight.getTime() - now.getTime());

      timerId = setTimeout(() => {
        setTodayLocalKey(formatDateToLocalKey(new Date()));
        scheduleMidnightUpdate();
      }, msUntilMidnight);
    };

    scheduleMidnightUpdate();
    return () => {
      if (timerId) clearTimeout(timerId);
    };
  }, []);

  // 날짜 범위: 오늘 이후 3일치(미래) 포함 + 창을 줄이면 과거(첫 컬럼)부터 1일씩 감소
  const timelineDates = useMemo(() => {
    const dates: {
      fullDate: string;
      label: string;
      subLabel?: string;
      isToday: boolean;
      isFuture: boolean;
      isPast: boolean;
    }[] = [];
    const today = new Date();
    const todayStr = formatDateToLocalKey(today);

    // 미래 3일치 고정 열
    const FUTURE_DAYS = 3;
    // 과거 표시 일수 (전체 activeSpanDays - 오늘(1) - 미래(3))
    const pastDays = Math.max(1, activeSpanDays - 1 - FUTURE_DAYS);

    // 시작일 계산: 오늘 - pastDays + dateOffsetDays
    // 종료일: 오늘 + FUTURE_DAYS + dateOffsetDays
    for (let offset = -pastDays; offset <= FUTURE_DAYS; offset++) {
      const d = new Date(today);
      d.setDate(today.getDate() + offset + dateOffsetDays);
      const key = formatDateToLocalKey(d);
      const mmdd = key.slice(5);
      const isCurrentToday = key === todayStr;
      const isFutureDate = key > todayStr;
      const isPastDate = key < todayStr;

      let subLabel = "";
      if (isCurrentToday) {
        subLabel = "오늘";
      } else if (offset === 1 && dateOffsetDays === 0) {
        subLabel = "내일";
      } else if (offset === 2 && dateOffsetDays === 0) {
        subLabel = "모레";
      } else if (offset === 3 && dateOffsetDays === 0) {
        subLabel = "글피";
      }

      dates.push({
        fullDate: key,
        label: isCurrentToday ? `${mmdd} (오늘)` : mmdd,
        subLabel,
        isToday: isCurrentToday,
        isFuture: isFutureDate,
        isPast: isPastDate,
      });
    }
    return dates;
  }, [dateOffsetDays, todayLocalKey, activeSpanDays]);

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

  const { activeTrendSeries } = useHealthTimeSeries({
    runtime,
    profiles,
    activeProfileId: activeProfile?.id,
    fromDate,
  });

  // 건강기록 로드
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

  // 검진 서류 세트 로드
  const loadDocumentSets = useCallback(async () => {
    if (!activeProfile) return setDocumentSets([]);
    try {
      const response = await serverApiClient.listMedicalDocumentSets<MedicalDocumentSetList>(activeProfile.id, 20);
      setDocumentSets(response.items ?? []);
    } catch {
      // ignore
    }
  }, [activeProfile]);

  useEffect(() => {
    void loadDocumentSets();
  }, [loadDocumentSets]);

  // 실제 건강데이터2 시계열 차트 포인트 연결
  const sbpSeries = activeTrendSeries.find((s) => s.key === "sbp");
  const dbpSeries = activeTrendSeries.find((s) => s.key === "dbp");
  const glucoseSeries = activeTrendSeries.find((s) => s.key === "fasting_glucose");
  const weightSeries = activeTrendSeries.find((s) => s.key === "weight_kg");

  const sbpVals = sbpSeries?.points.map((p) => p.value) ?? [120, 122, 126, 128];
  const dbpVals = dbpSeries?.points.map((p) => p.value) ?? [78, 80, 82, 84];
  const glucoseVals = glucoseSeries?.points.map((p) => p.value) ?? [98, 102, 110, 118];
  const weightVals = weightSeries?.points.map((p) => p.value) ?? [68, 68.2, 68.5, 68.4];

  const currentMetricSpec = TREND_SERIES.find((s) => s.key === metricKey) ?? TREND_SERIES[0];

  // 3D 인체 모델 위험도
  const bodyRisks: RegionRisk[] = useMemo(() => {
    const assessed = records.filter((r) => r.recordType === "assessment");
    const payload = assessed[0]?.payload as Record<string, unknown> | undefined;
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

  return (
    <div className="up15-root">
      {/* 레이아웃 비교 바 */}
      {isPreview ? <VariantBar current="v18" /> : null}

      <StitchAppHeader displayName={activeProfile?.displayName} />

      {/* Main 4K Ultra-Wide Content */}
      <main className="up15-main">
        {/* 상단 인사말 및 실시간 상태 개요 */}
        <section className="up15-greeting-row">
          <div className="up15-greeting-title">
            <h1>오늘 우리 가족 건강은 이래요</h1>
            <span className="up15-date-pill">2026.09.15 화요일</span>
            <span style={{ fontSize: "13px", color: "var(--up15-fog)" }}>
              가족 4명의 종합 검진 데이터와 오늘의 생활 생체 지표가 4K 와이드 뷰로 동기화되었습니다.
            </span>
          </div>

          <div className="up15-sync-badge">
            <span className="up15-dot-mint" />
            <span>4개 디바이스 실시간 연동 중</span>
          </div>
        </section>

        {/* 상단 3분할: 주의 알림 카드 (폭 360px) + 가족 구성원 레일 (원본 비율 고정) + 실시간 바이탈 상태 요약 (폭 360px) */}
        <section className="up17-top-grid">
          {/* 1. 확인이 필요한 변화 카드 (원본 비율) */}
          <article className="up15-card" style={{ maxWidth: "420px" }}>
            <div>
              <div className="up15-card-head">
                <div className="up15-card-title-group">
                  <span className="up15-badge-blush">주의 2건</span>
                  <strong style={{ fontSize: "15px", color: "var(--up15-aubergine)" }}>확인이 필요한 변화</strong>
                </div>
                <span className="up15-sub-label">AI 사전 감지</span>
              </div>

              <div className="up15-alert-list">
                <div className="up15-alert-item" onClick={() => void navigate("/assessment")}>
                  <div className="up15-alert-item-left">
                    <span className="up15-member-tag">아빠</span>
                    <div>
                      <strong style={{ color: "var(--up15-aubergine)", marginRight: "6px" }}>혈압 상승 추세</strong>
                      <span style={{ color: "var(--up15-fog)" }}>128/84 mmHg · 이전 대비 완만 상승</span>
                    </div>
                  </div>
                  <Icon name="chevron-right" />
                </div>

                <div className="up15-alert-item" onClick={() => void navigate("/health-data")}>
                  <div className="up15-alert-item-left">
                    <span className="up15-member-tag">엄마</span>
                    <div>
                      <strong style={{ color: "var(--up15-aubergine)", marginRight: "6px" }}>공복혈당 경계</strong>
                      <span style={{ color: "var(--up15-fog)" }}>118 mg/dL · 식후 혈당 모니터 권장</span>
                    </div>
                  </div>
                  <Icon name="chevron-right" />
                </div>
              </div>
            </div>

            <div style={{ marginTop: "16px", paddingTop: "14px", borderTop: "1px solid var(--up15-ash)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "11px", color: "var(--up15-fog)" }}>28개 임상 지표 대조 완료</span>
              <button
                type="button"
                className="up15-nav-btn active"
                style={{ padding: "6px 14px", fontSize: "11px" }}
                onClick={() => void navigate("/assessment")}
              >
                변화 자세히 보기 <Icon name="arrow-right" />
              </button>
            </div>
          </article>

          {/* 2. 가족 구성원 선택 레일 (원본 비율 유지) */}
          <article className="up15-card">
            <div>
              <div className="up15-card-head">
                <div>
                  <strong style={{ fontSize: "15px", color: "var(--up15-aubergine)", display: "block" }}>우리 가족 구성원</strong>
                  <span style={{ fontSize: "11px", color: "var(--up15-fog)" }}>카드를 선택해 개별 건강 타임라인으로 즉시 전환합니다.</span>
                </div>
                <button
                  type="button"
                  style={{ background: "none", border: 0, color: "var(--up15-aubergine)", fontSize: "13px", cursor: "pointer", display: "flex", alignItems: "center", gap: "4px" }}
                  onClick={() => void navigate("/account")}
                >
                  가족 관리 <Icon name="chevron-right" />
                </button>
              </div>

              <div className="up17-member-grid">
                {/* 1. 본인 */}
                <div
                  className={`up17-member-cell ${(!selectedProfileId || selectedProfileId === profiles[0]?.id) ? "selected" : ""}`}
                  onClick={() => profiles[0] && setSelectedProfileId(profiles[0].id)}
                >
                  <span className="up15-member-status-dot" style={{ background: "var(--up15-mint-signal)" }} />
                  <div className="up15-cell-avatar">오성</div>
                  <strong style={{ fontSize: "13px", color: "var(--up15-aubergine)", marginTop: "2px" }}>오성민</strong>
                  <span className="up15-cell-desc">본인</span>
                </div>

                {/* 2. 엄마 */}
                <div className="up17-member-cell">
                  <span className="up15-member-status-dot" style={{ background: "var(--up15-mint-signal)" }} />
                  <div className="up15-cell-avatar">김다</div>
                  <strong style={{ fontSize: "13px", color: "var(--up15-aubergine)", marginTop: "2px" }}>김다원</strong>
                  <span className="up15-cell-desc">배우자</span>
                </div>

                {/* 3. 아빠 */}
                <div className="up17-member-cell">
                  <span className="up15-member-status-dot" style={{ background: "var(--up15-buttercream)", border: "1px solid var(--up15-aubergine)" }} />
                  <div className="up15-cell-avatar">오진</div>
                  <strong style={{ fontSize: "13px", color: "var(--up15-aubergine)", marginTop: "2px" }}>오진철</strong>
                  <span className="up15-cell-desc">부모</span>
                </div>

                {/* 4. 자녀 */}
                <div className="up17-member-cell">
                  <span className="up15-member-status-dot" style={{ background: "var(--up15-mint-signal)" }} />
                  <div className="up15-cell-avatar">오민</div>
                  <strong style={{ fontSize: "13px", color: "var(--up15-aubergine)", marginTop: "2px" }}>오민재</strong>
                  <span className="up15-cell-desc">자녀</span>
                </div>

                {/* 구성원 추가 */}
                <button
                  type="button"
                  className="up17-member-add-btn"
                  onClick={() => void navigate("/")}
                >
                  <div style={{ width: "38px", height: "38px", borderRadius: "50%", background: "#fff", border: "1px solid var(--up15-ash)", display: "grid", placeItems: "center", marginBottom: "4px" }}>
                    <Icon name="plus" />
                  </div>
                  <span style={{ fontSize: "11px", fontWeight: 500 }}>구성원 추가</span>
                </button>
              </div>
            </div>
          </article>

          {/* 3. 새로 확보된 공간: 가족 실시간 바이탈 모니터링 퀵 서머리 카드 */}
          <article className="up15-card" style={{ maxWidth: "400px" }}>
            <div>
              <div className="up15-card-head" style={{ marginBottom: "12px" }}>
                <div>
                  <strong style={{ fontSize: "15px", color: "var(--up15-aubergine)", display: "block" }}>가족 바이탈 퀵 스캔</strong>
                  <span style={{ fontSize: "11px", color: "var(--up15-fog)" }}>연동 기기 4대 정상 동기화</span>
                </div>
                <span className="up15-badge-mint">정상 작동</span>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                <div style={{ background: "var(--up15-bone)", borderRadius: "16px", padding: "12px", border: "1px solid var(--up15-ash)" }}>
                  <span style={{ fontSize: "11px", color: "var(--up15-fog)", display: "block" }}>가족 평균 수축기</span>
                  <strong style={{ fontSize: "18px", color: "var(--up15-aubergine)" }}>122 <span style={{ fontSize: "11px", fontWeight: 400 }}>mmHg</span></strong>
                  <div style={{ fontSize: "11px", color: "var(--up15-mint-signal)", marginTop: "4px" }}>● 전원 안정 범위</div>
                </div>
                <div style={{ background: "var(--up15-bone)", borderRadius: "16px", padding: "12px", border: "1px solid var(--up15-ash)" }}>
                  <span style={{ fontSize: "11px", color: "var(--up15-fog)", display: "block" }}>오늘 기록 참여율</span>
                  <strong style={{ fontSize: "18px", color: "var(--up15-aubergine)" }}>3 / 4 <span style={{ fontSize: "11px", fontWeight: 400 }}>명</span></strong>
                  <div style={{ fontSize: "11px", color: "var(--up15-periwinkle)", marginTop: "4px" }}>나 1건 미입력</div>
                </div>
              </div>
            </div>

            <div style={{ marginTop: "12px", paddingTop: "12px", borderTop: "1px solid var(--up15-ash)", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "11px" }}>
              <span style={{ color: "var(--up15-fog)" }}>마지막 자동 동기화 3분 전</span>
              <button
                type="button"
                style={{ background: "none", border: 0, color: "var(--up15-aubergine)", cursor: "pointer", fontWeight: 500 }}
                onClick={() => void navigate("/health-data")}
              >
                전체 수치 일람 →
              </button>
            </div>
          </article>
        </section>

        {/* ==========================================================================
           중단 4K 유체 분할:
           Left (8.5 cols): 가족 통합 모니터링 매트릭스 + 4K 와이드 실측 시계열 차트 & 만성질환 위험도
           Right (3.5 cols): 전체 높이를 시원하게 활용하는 실제 3D 모델 뷰어 (VanatomeBodyMap)
           ========================================================================== */}
        <section className="up15-content-split">
          {/* ================= LEFT COLUMN: 8.5 COLS ================= */}
          <div className="up15-left-col">
            {/* 1. 가족 건강 통합 모니터링 매트릭스 (반응형 타임라인 확장 지원) */}
            <article className="up15-card" ref={timelineContainerRef}>
              <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", paddingBottom: "14px", borderBottom: "1px solid var(--up15-ash)", gap: "10px" }}>
                <div>
                  <strong style={{ fontSize: "16px", color: "var(--up15-aubergine)" }}>가족 건강 통합 모니터링</strong>
                  <p style={{ margin: "4px 0 0", fontSize: "13px", color: "var(--up15-fog)" }}>
                    화면 너비에 맞춰 단일 타임라인에서 정제하여 보여줍니다.
                  </p>
                </div>

                <div className="up16-timeline-controls-group">
                  {/* 날짜 이동 네비게이션 */}
                  <div className="up16-timeline-nav" role="group" aria-label="타임라인 날짜 이동">
                    <button
                      type="button"
                      className="up16-nav-btn"
                      onClick={() => setDateOffsetDays((prev) => prev - activeSpanDays)}
                      title={`과거 ${activeSpanDays}일 이동`}
                    >
                      ◀ 이전 {activeSpanDays}일
                    </button>
                    <button
                      type="button"
                      className={`up16-nav-btn ${dateOffsetDays === 0 ? "active" : ""}`}
                      onClick={() => setDateOffsetDays(0)}
                      title="최신으로 복귀"
                    >
                      오늘
                    </button>
                    <button
                      type="button"
                      className="up16-nav-btn"
                      disabled={dateOffsetDays >= 0}
                      onClick={() => setDateOffsetDays((prev) => Math.min(prev + activeSpanDays, 0))}
                      title={`다음 ${activeSpanDays}일 이동`}
                    >
                      다음 {activeSpanDays}일 ▶
                    </button>
                  </div>
                </div>
              </div>

              {/* Legend Strip */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: "16px", padding: "10px 0", borderBottom: "1px solid var(--up15-ash)", fontSize: "11px", color: "var(--up15-fog)" }}>
                <span style={{ display: "flex", alignItems: "center", gap: "6px" }}><span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "var(--up15-blush-mist)" }} /> 진단 기록 / 주의</span>
                <span style={{ display: "flex", alignItems: "center", gap: "6px" }}><span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "var(--up15-buttercream)" }} /> 자가 증상 / 통증</span>
                <span style={{ display: "flex", alignItems: "center", gap: "6px" }}><span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "var(--up15-ghost-lavender)" }} /> 정량 수치</span>
                <span style={{ display: "flex", alignItems: "center", gap: "6px" }}><span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "var(--up15-bone)", border: "1px solid var(--up15-ash)" }} /> 정상 / 안정</span>
              </div>

              {/* Timeline Matrix Table (가로 스크롤 없음, 첫 열 Sticky 상위 레이어 고정, 정수 단위 컬럼 절삭, 오늘 하이라이트 & 미래 3일 열) */}
              <div className="up17-timeline-table-wrapper">
                <table className="up15-timeline-table up17-timeline-table-fixed">
                  <thead>
                    <tr>
                      <th className="up17-sticky-col up17-sticky-th">구성원</th>
                      {timelineDates.map((item) => {
                        const colClass = [
                          item.isToday ? "is-today" : "",
                          item.isFuture ? "is-future" : "",
                          item.isPast ? "is-past" : "",
                        ]
                          .filter(Boolean)
                          .join(" ");

                        return (
                          <th key={item.fullDate} className={`up17-timeline-th ${colClass}`}>
                            <div className="up17-th-content">
                              <span className="up17-th-date">{item.fullDate.slice(5)}</span>
                              {item.subLabel && <span className="up17-th-badge">{item.subLabel}</span>}
                            </div>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {/* 구성원 1: 나 */}
                    <tr>
                      <td className="up17-sticky-col up17-sticky-td member-self">
                        <div className="up17-member-info">
                          <span className="up17-member-name">나 ({activeProfile?.displayName ?? "오성민"})</span>
                        </div>
                      </td>
                      {timelineDates.map((item, idx) => {
                        if (item.isToday) {
                          return (
                            <td key={item.fullDate} className="up17-timeline-td is-today">
                              <span className="up15-timeline-pill lavender up17-today-pill">
                                오늘 대기
                              </span>
                            </td>
                          );
                        }
                        if (item.isFuture) {
                          return (
                            <td key={item.fullDate} className="up17-timeline-td is-future">
                              <span style={{ color: "var(--up15-fog)", opacity: 0.6 }}>-</span>
                            </td>
                          );
                        }

                        // 과거 기록 매핑
                        const mockPatterns = [
                          { label: "혈압 120", type: "lavender" },
                          { label: "어깨 1", type: "bone" },
                          { label: "혈압주의", type: "blush" },
                          { label: "명치 2", type: "butter" },
                          { label: "혈압 128", type: "lavender" },
                          { label: "정상", type: "bone" },
                          { label: "걸음 8천", type: "bone" },
                          { label: "혈압 122", type: "lavender" },
                          { label: "어깨 통증", type: "butter" },
                          { label: "검진 완료", type: "lavender" },
                          { label: "혈압 118", type: "bone" },
                          { label: "정상", type: "bone" },
                          { label: "소화불량", type: "butter" },
                          { label: "혈압 125", type: "lavender" },
                        ];
                        const sample = mockPatterns[(idx + 3) % mockPatterns.length];
                        return (
                          <td key={item.fullDate} className="up17-timeline-td is-past">
                            <span className={`up15-timeline-pill ${sample.type}`}>{sample.label}</span>
                          </td>
                        );
                      })}
                    </tr>

                    {/* 구성원 2: 엄마 */}
                    <tr>
                      <td className="up17-sticky-col up17-sticky-td">
                        <div className="up17-member-info">
                          <span className="up17-member-name">김다원 (엄마)</span>
                        </div>
                      </td>
                      {timelineDates.map((item, idx) => {
                        if (item.isToday) {
                          return (
                            <td key={item.fullDate} className="up17-timeline-td is-today">
                              <span className="up15-timeline-pill bone up17-today-pill">
                                양호
                              </span>
                            </td>
                          );
                        }
                        if (item.isFuture) {
                          return (
                            <td key={item.fullDate} className="up17-timeline-td is-future">
                              <span style={{ color: "var(--up15-fog)", opacity: 0.6 }}>-</span>
                            </td>
                          );
                        }

                        const mockPatterns = [
                          { label: "혈당 98", type: "bone" },
                          { label: "검진 서류", type: "lavender" },
                          { label: "편두통 2", type: "butter" },
                          { label: "혈당 118", type: "blush" },
                          { label: "정상", type: "bone" },
                          { label: "식후 124", type: "lavender" },
                          { label: "당뇨 체크", type: "blush" },
                          { label: "혈당 102", type: "bone" },
                          { label: "운동 30분", type: "lavender" },
                          { label: "정상", type: "bone" },
                          { label: "식후 130", type: "lavender" },
                          { label: "혈당 안정", type: "bone" },
                        ];
                        const sample = mockPatterns[(idx + 1) % mockPatterns.length];
                        return (
                          <td key={item.fullDate} className="up17-timeline-td is-past">
                            <span className={`up15-timeline-pill ${sample.type}`}>{sample.label}</span>
                          </td>
                        );
                      })}
                    </tr>

                    {/* 구성원 3: 동생 */}
                    <tr>
                      <td className="up17-sticky-col up17-sticky-td">
                        <div className="up17-member-info">
                          <span className="up17-member-name">오민재 (동생)</span>
                        </div>
                      </td>
                      {timelineDates.map((item, idx) => {
                        if (item.isToday) {
                          return (
                            <td key={item.fullDate} className="up17-timeline-td is-today">
                              <span className="up15-timeline-pill bone up17-today-pill">
                                정상
                              </span>
                            </td>
                          );
                        }
                        if (item.isFuture) {
                          return (
                            <td key={item.fullDate} className="up17-timeline-td is-future">
                              <span style={{ color: "var(--up15-fog)", opacity: 0.6 }}>-</span>
                            </td>
                          );
                        }

                        const mockPatterns = [
                          { label: "-", type: "empty" },
                          { label: "체온 36.5°", type: "bone" },
                          { label: "-", type: "empty" },
                          { label: "운동 완료", type: "lavender" },
                          { label: "-", type: "empty" },
                          { label: "줄넘기", type: "bone" },
                          { label: "체온 36.6°", type: "bone" },
                          { label: "-", type: "empty" },
                          { label: "풋살 경기", type: "lavender" },
                          { label: "-", type: "empty" },
                          { label: "정상", type: "bone" },
                        ];
                        const sample = mockPatterns[idx % mockPatterns.length];
                        return (
                          <td key={item.fullDate} className="up17-timeline-td is-past">
                            {sample.type === "empty" ? (
                              <span style={{ color: "var(--up15-fog)" }}>-</span>
                            ) : (
                              <span className={`up15-timeline-pill ${sample.type}`}>{sample.label}</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  </tbody>
                </table>
              </div>

              <div style={{ marginTop: "14px", background: "var(--up15-bone)", border: "1px solid var(--up15-ash)", borderRadius: "14px", padding: "10px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "13px" }}>
                <span>오늘 {activeProfile?.displayName ?? "나"} 님의 미입력 생체 지표(혈압·혈당)가 남아있습니다.</span>
                <button
                  type="button"
                  style={{ padding: "5px 14px", background: "#fff", border: "1px solid var(--up15-ash)", borderRadius: "100px", color: "var(--up15-aubergine)", cursor: "pointer", fontSize: "11px", fontWeight: 500 }}
                  onClick={() => void navigate("/health-data")}
                >
                  + 수치 기록하기
                </button>
              </div>
            </article>

            {/* 2. 중단 3분할: 주요 건강지표 추이(원본 비율) + 만성질환 위험도 판정(원본 비율) + 복약 일정/습관 퀵 위젯 */}
            <div className="up17-mid-subgrid">
              {/* 1. 건강지표 추이 차트 (원본 비율 복원) */}
              <article className="up15-card" style={{ padding: "20px" }}>
                <div>
                  <div className="up15-card-head" style={{ marginBottom: "8px" }}>
                    <div>
                      <strong style={{ fontSize: "15px", color: "var(--up15-aubergine)", display: "block" }}>주요 건강지표 추이</strong>
                      <span style={{ fontSize: "11px", color: "var(--up15-fog)" }}>검진 및 실측 수치 (health-data2 연동)</span>
                    </div>

                    <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                      <div style={{ display: "flex", background: "var(--up15-bone)", borderRadius: "100px", padding: "2px 4px", border: "1px solid var(--up15-ash)" }}>
                        {(["90d", "1y", "all"] as Period[]).map((p) => (
                          <button
                            key={p}
                            type="button"
                            className={`up15-nav-btn ${period === p ? "active" : ""}`}
                            style={{ padding: "2px 7px", fontSize: "11px" }}
                            onClick={() => setPeriod(p)}
                          >
                            {p === "90d" ? "3개월" : p === "1y" ? "1년" : "전체"}
                          </button>
                        ))}
                      </div>
                      <div style={{ display: "flex", background: "var(--up15-bone)", borderRadius: "100px", padding: "2px 4px", border: "1px solid var(--up15-ash)" }}>
                        <button
                          type="button"
                          className={`up15-nav-btn ${metricKey === "weight_kg" ? "active" : ""}`}
                          style={{ padding: "2px 8px", fontSize: "11px" }}
                          onClick={() => setMetricKey("weight_kg")}
                        >
                          체중
                        </button>
                        <button
                          type="button"
                          className={`up15-nav-btn ${metricKey === "sbp" ? "active" : ""}`}
                          style={{ padding: "2px 8px", fontSize: "11px" }}
                          onClick={() => setMetricKey("sbp")}
                        >
                          혈압
                        </button>
                        <button
                          type="button"
                          className={`up15-nav-btn ${metricKey === "fasting_glucose" ? "active" : ""}`}
                          style={{ padding: "2px 8px", fontSize: "11px" }}
                          onClick={() => setMetricKey("fasting_glucose")}
                        >
                          혈당
                        </button>
                      </div>
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "baseline", gap: "8px", margin: "6px 0 10px" }}>
                    <span style={{ fontSize: "28px", fontWeight: 350, color: "var(--up15-aubergine)" }}>
                      {metricKey === "sbp"
                        ? `${sbpVals.at(-1)} / ${dbpVals.at(-1)}`
                        : metricKey === "fasting_glucose"
                        ? `${glucoseVals.at(-1)}`
                        : `${weightVals.at(-1)}`}
                    </span>
                    <span style={{ fontSize: "13px", color: "var(--up15-fog)" }}>{currentMetricSpec.unit}</span>
                    <span className="up15-badge-blush" style={{ padding: "2px 8px", fontSize: "11px" }}>안정적 모니터링</span>
                  </div>

                  {/* 단정한 원본 비율 시계열 차트 본체 */}
                  <div style={{ background: "rgba(244, 242, 244, 0.5)", borderRadius: "18px", padding: "12px", border: "1px solid var(--up15-ash)" }}>
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", fontSize: "11px", marginBottom: "4px" }}>
                      <span style={{ display: "flex", alignItems: "center", gap: "4px", color: "var(--up15-aubergine)" }}>
                        <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: "var(--up15-aubergine)" }} /> 수축기
                      </span>
                      <span style={{ display: "flex", alignItems: "center", gap: "4px", color: "var(--up15-periwinkle)" }}>
                        <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: "var(--up15-periwinkle)" }} /> 이완기
                      </span>
                    </div>

                    <HealthData2ThemeWideChart
                      systolicValues={metricKey === "sbp" ? sbpVals : metricKey === "fasting_glucose" ? glucoseVals : weightVals}
                      diastolicValues={metricKey === "sbp" ? dbpVals : []}
                      label={currentMetricSpec.label}
                    />
                  </div>
                </div>

                <div style={{ marginTop: "12px", paddingTop: "10px", borderTop: "1px solid var(--up15-ash)", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "11px" }}>
                  <span style={{ color: "var(--up15-fog)" }}>신촌세브란스 종합검진 기록 OCR 판독</span>
                  <a
                    href="#documents"
                    style={{ color: "var(--up15-aubergine)", textDecoration: "none", fontWeight: 500 }}
                    onClick={(e) => {
                      e.preventDefault();
                      if (documentSets[0]) setOpenDocumentSet(documentSets[0]);
                    }}
                  >
                    원본 서류 확인 ↗
                  </a>
                </div>
              </article>

              {/* 2. 만성질환 위험도 판정 (원본 비율 복원) */}
              <article className="up15-card" style={{ padding: "20px" }}>
                <div>
                  <div className="up15-card-head" style={{ marginBottom: "14px" }}>
                    <strong style={{ fontSize: "15px", color: "var(--up15-aubergine)" }}>만성질환 위험도 판정</strong>
                    <span style={{ fontSize: "11px", color: "var(--up15-fog)" }}>AI 예측 모델</span>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", background: "var(--up15-bone)", borderRadius: "14px" }}>
                      <span style={{ fontSize: "13px", color: "var(--up15-obsidian)" }}>고혈압 주의군</span>
                      <span className="up15-badge-blush">관찰 필요</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", background: "var(--up15-bone)", borderRadius: "14px" }}>
                      <span style={{ fontSize: "13px", color: "var(--up15-obsidian)" }}>당뇨 발생 예측</span>
                      <span style={{ fontSize: "11px", background: "#fff", border: "1px solid var(--up15-ash)", padding: "2px 8px", borderRadius: "100px", color: "var(--up15-fog)" }}>
                        정상 범위
                      </span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", background: "var(--up15-bone)", borderRadius: "14px" }}>
                      <span style={{ fontSize: "13px", color: "var(--up15-obsidian)" }}>고지혈증 지수</span>
                      <span style={{ fontSize: "11px", background: "var(--up15-ghost-lavender)", padding: "2px 8px", borderRadius: "100px", color: "var(--up15-aubergine)", fontWeight: 500 }}>
                        양호
                      </span>
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  className="up15-nav-btn active"
                  style={{ width: "100%", marginTop: "14px", justifyContent: "center", padding: "8px" }}
                  onClick={() => void navigate("/assessment")}
                >
                  위험도 심층 분석 보기 →
                </button>
              </article>

              {/* 3. 새로 확보된 공간: 오늘의 건강 습관 & 가족 복약 일정 퀵 위젯 */}
              <article className="up15-card" style={{ padding: "20px" }}>
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                    <strong style={{ fontSize: "13px", color: "var(--up15-aubergine)" }}>오늘의 건강 습관 & 복약</strong>
                    <span style={{ fontSize: "11px", color: "var(--up15-fog)", fontWeight: 500 }}>2 / 3 완료</span>
                  </div>

                  <div style={{ width: "100%", background: "var(--up15-ash)", height: "6px", borderRadius: "100px", overflow: "hidden", marginBottom: "12px" }}>
                    <div style={{ width: "66%", height: "100%", background: "var(--up15-aubergine)", borderRadius: "100px" }} />
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: "8px", fontSize: "13px" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: "8px", color: "var(--up15-fog)", textDecoration: "line-through", cursor: "pointer", background: "var(--up15-bone)", padding: "8px 10px", borderRadius: "10px" }}>
                      <input type="checkbox" defaultChecked />
                      <span>아침 식후 혈압약 복용</span>
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: "8px", color: "var(--up15-fog)", textDecoration: "line-through", cursor: "pointer", background: "var(--up15-bone)", padding: "8px 10px", borderRadius: "10px" }}>
                      <input type="checkbox" defaultChecked />
                      <span>미온수 1.5L 수분 보충</span>
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: "8px", color: "var(--up15-obsidian)", cursor: "pointer", background: "#ffffff", border: "1px solid var(--up15-ash)", padding: "8px 10px", borderRadius: "10px" }}>
                      <input type="checkbox" />
                      <span>저녁 20분 가벼운 유산소 걷기</span>
                    </label>
                  </div>
                </div>

                <div style={{ marginTop: "14px", paddingTop: "10px", borderTop: "1px solid var(--up15-ash)", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "11px" }}>
                  <span style={{ color: "var(--up15-fog)" }}>내일 복약 알림 대기</span>
                  <button
                    type="button"
                    style={{ background: "none", border: 0, color: "var(--up15-aubergine)", cursor: "pointer", fontWeight: 500 }}
                    onClick={() => void navigate("/challenge")}
                  >
                    챌린지 관리 →
                  </button>
                </div>
              </article>
            </div>

            <VitalTrendChartPanel />

            <div className="up15-bottom-stats-grid up15-left-footer-stats">
              <div className="up15-stat-card">
                <div>
                  <span className="up15-sub-label">최근 검진 판독일</span>
                  <div className="up15-stat-val">2026.09.11</div>
                </div>
                <span style={{ fontSize: "11px", color: "var(--up15-fog)" }}>신촌세브란스 병원 종합검진</span>
              </div>

              <div className="up15-stat-card">
                <div>
                  <span className="up15-sub-label">이번 주 총 걸음 수</span>
                  <div className="up15-stat-val" style={{ color: "var(--up15-mint-signal)" }}>42,850보</div>
                </div>
                <span style={{ fontSize: "11px", color: "var(--up15-fog)" }}>일일 평균 8,570보 달성</span>
              </div>
            </div>
          </div>

          {/* ================= RIGHT COLUMN: 3.5 COLS (3D 인체 바디맵 뷰어 - 4K 전체 높이 활용) ================= */}
          <div className="up15-right-col">
            <article className="up15-card up15-body-card">
              <div
                className="up15-card-head up15-body-card-head"
                onMouseEnter={() => tellBomi("불편한 부위를 고르면 3D로 자세히 볼 수 있어요.")}
                onMouseLeave={hushBomi}
              >
                <strong>인체 통증 매핑</strong>
              </div>

              {/* 실제 인터랙티브 3D 인체 모델 뷰어 (전체 세로 높이를 시원하게 채움) */}
              <div className="up15-body-viewport">
                <Suspense fallback={<div style={{ height: "100%", display: "grid", placeItems: "center", color: "var(--up15-fog)", fontSize: "13px" }}>3D 인체 뷰어를 준비 중입니다…</div>}>
                  <VanatomeBodyMap
                    key={`${activeProfile?.id}-${activeProfile?.gender}`}
                    profileName={activeProfile?.displayName ?? "오성민"}
                    gender={activeProfile?.gender}
                    risks={bodyRisks}
                    highlightOrganKey={selectedOrgan}
                    isDarkBg={isDarkBodyBg}
                    onDarkBgChange={setIsDarkBodyBg}
                    drawerMode={true}
                  />
                </Suspense>
              </div>
            </article>
          </div>
        </section>
      </main>

      {/* Minimal Phantom Footer */}
      <footer className="up15-footer">
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <strong style={{ color: "var(--up15-aubergine)" }}>이어봄 (Ieobom)</strong>
          <span>•</span>
          <span>4K 유체 와이드 헬스케어 대시보드 (시안 15)</span>
        </div>
        <span>본 서비스는 의료 전문가의 직접 진단을 대체하지 않으며 이상 징후 시 전문 의료기관을 방문하시기 바랍니다.</span>
      </footer>

      {/* 원본 서류 모달 */}
      {openDocumentSet ? (
        <MedicalDocSetModal documentSet={openDocumentSet} onClose={() => setOpenDocumentSet(undefined)} />
      ) : null}
    </div>
  );
}

function MedicalDocSetModal({
  documentSet,
  onClose,
}: {
  documentSet: MedicalDocumentSet;
  onClose: () => void;
}) {
  const [pageUrls, setPageUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

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
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [documentSet]);

  return (
    <Modal kicker="원본 서류 대조" title="건강검진 공인 원본 서류" className="up13-doc-modal" onClose={onClose}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "10px", margin: "0 0 16px" }}>
        <div style={{ padding: "12px", border: "1px solid var(--up15-ash)", borderRadius: "12px", background: "#fff" }}>
          <span style={{ fontSize: "11px", color: "var(--up15-fog)" }}>실제 검사일</span>
          <strong style={{ display: "block", fontSize: "15px", marginTop: "4px", color: "var(--up15-aubergine)" }}>
            {formatDateTime(documentSet.examined_at)}
          </strong>
        </div>
        <div style={{ padding: "12px", border: "1px solid var(--up15-ash)", borderRadius: "12px", background: "#fff" }}>
          <span style={{ fontSize: "11px", color: "var(--up15-fog)" }}>보관 상태</span>
          <strong style={{ display: "block", fontSize: "15px", marginTop: "4px", color: "var(--up15-mint-signal)" }}>
            AES-256 암호화 보관 완료
          </strong>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: "30px", textAlign: "center", color: "var(--up15-fog)" }}>서류를 복호화 중입니다…</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "14px" }}>
          {documentSet.pages.map((page) => {
            const url = pageUrls[page.id];
            return (
              <div key={page.id} style={{ border: "1px solid var(--up15-ash)", borderRadius: "12px", overflow: "hidden", background: "#fff" }}>
                <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--up15-ash)", fontSize: "13px" }}>
                  <strong>{page.page_order}쪽 · {page.original_filename}</strong>
                </div>
                {url ? <img src={url} alt="원본 페이지" style={{ width: "100%", maxHeight: "500px", objectFit: "contain" }} /> : null}
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}

export default UiPreview18Page;
