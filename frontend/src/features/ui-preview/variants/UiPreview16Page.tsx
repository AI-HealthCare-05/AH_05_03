import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { useLocalDomain } from "../../../app/localDomainContext";
import { TREND_SERIES } from "../../assessment/snapshots";
import { useHealthTimeSeries } from "../../data/useHealthTimeSeries";
import type { HealthRecord } from "../../../shared/local/domainContracts";
import { VariantBar } from "../components/VariantBar";
import { StitchAccountChip } from "../components/StitchAccountChip";
import { Modal } from "../../../shared/ui/Modal";
import { serverApiClient } from "../../../shared/api/serverApiClient";
import { regionRisks, type RegionRisk } from "../../home/bodyRisk";
import { HealthAssistantDrawer } from "../../health-assistant/HealthAssistantDrawer";
import { ChatLoadingSkeleton } from "../../../shared/ui/Skeleton";
import bomiChickIcon from "../../health-assistant/assets/bomi-chick.png";
import "../styles/shadcn-preview-variants.css";
import "../styles/ui-preview16.css";

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
    "arrow-right": <path d="M5 12h14M12 5l7 7-7 7" />,
    check: <polyline points="20 6 9 17 4 12" />,
    "chevron-right": <path d="M9 5l7 7-7 7" />,
    plus: <path d="M12 5v14M5 12h14" />,
    send: <path d="M14 5l7 7m0 0l-7 7m7-7H3" />,
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
  label = "수치 추이",
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
  const valRange = maxVal - minVal || 1;

  const width = 800;
  const height = 180;
  const paddingX = 40;
  const paddingY = 24;

  const getX = (idx: number, total: number) => {
    if (total <= 1) return width / 2;
    return paddingX + (idx / (total - 1)) * (width - paddingX * 2);
  };

  const getY = (val: number) => {
    const norm = (val - minVal) / valRange;
    return height - paddingY - norm * (height - paddingY * 2);
  };

  const makeSmoothPath = (pts: number[]) => {
    if (pts.length === 0) return "";
    const coords = pts.map((val, idx) => ({ x: getX(idx, pts.length), y: getY(val) }));
    if (coords.length === 1) return `M ${coords[0].x},${coords[0].y}`;

    let d = `M ${coords[0].x},${coords[0].y}`;
    for (let i = 0; i < coords.length - 1; i++) {
      const p0 = coords[i];
      const p1 = coords[i + 1];
      const mx = (p0.x + p1.x) / 2;
      d += ` C ${mx},${p0.y} ${mx},${p1.y} ${p1.x},${p1.y}`;
    }
    return d;
  };

  const path1 = makeSmoothPath(points1);
  const path2 = makeSmoothPath(points2);

  return (
    <div style={{ position: "relative", width: "100%" }}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        style={{ width: "100%", height: "180px", overflow: "visible" }}
        preserveAspectRatio="none"
      >
        {/* 가이드 수평선 */}
        {[0.2, 0.5, 0.8].map((ratio, idx) => {
          const yPos = paddingY + ratio * (height - paddingY * 2);
          const valMark = Math.round(maxVal - ratio * valRange);
          return (
            <g key={idx}>
              <line
                x1={paddingX}
                x2={width - paddingX}
                y1={yPos}
                y2={yPos}
                stroke="var(--up15-ash)"
                strokeDasharray="4 4"
                strokeWidth="1"
              />
              <text x={paddingX - 10} y={yPos + 4} fontSize="11" fill="var(--up15-fog)" textAnchor="end">
                {valMark}
              </text>
            </g>
          );
        })}

        {/* 이완기 보조 라인 (연보라/페리윙클) */}
        {path2 && (
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

      <div style={{ display: "flex", justifyContent: "space-between", padding: "0 36px", fontSize: "11px", color: "var(--up15-fog)", marginTop: "4px" }}>
        <span>측정 시작 (이전 분기)</span>
        <span style={{ color: "var(--up15-aubergine)", fontWeight: 600 }}>최근 실측 데이터 ({label})</span>
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

export function UiPreview16Page() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const isPreview = pathname.startsWith("/ui-preview");
  const { runtime, profiles } = useLocalDomain();

  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [period, setPeriod] = useState<Period>("1y");
  const [metricKey, setMetricKey] = useState("sbp");
  const [records, setRecords] = useState<HealthRecord[]>([]);
  const [documentSets, setDocumentSets] = useState<MedicalDocumentSet[]>([]);
  const [openDocumentSet, setOpenDocumentSet] = useState<MedicalDocumentSet>();
  const [selectedOrgan, setSelectedOrgan] = useState<string>("stomach"); // 컨셉안: 명치/소화기계

  // 타임라인 반응형 동적 일수 및 자정 롤오버 상태
  const [dateOffsetDays, setDateOffsetDays] = useState(0);
  const [todayLocalKey, setTodayLocalKey] = useState<string>(() => formatDateToLocalKey(new Date()));
  const [timelineSpanMode, setTimelineSpanMode] = useState<"auto" | 7 | 14 | 21 | 28>("auto");
  const [autoSpanDays, setAutoSpanDays] = useState<number>(7);
  const timelineContainerRef = useRef<HTMLDivElement>(null);

  // 컨테이너 너비 기반 반응형 일수 자동 계산 (최소 60px~75px/일 확보)
  useEffect(() => {
    const el = timelineContainerRef.current;
    if (!el) return;

    const updateSpan = (width: number) => {
      const availableWidth = Math.max(width - 150, 300);
      if (availableWidth >= 1700) {
        setAutoSpanDays(28); // 4K / 울트라와이드 (4주)
      } else if (availableWidth >= 1150) {
        setAutoSpanDays(21); // 대형 와이드 / QHD (3주)
      } else if (availableWidth >= 700) {
        setAutoSpanDays(14); // 일반 데스크톱 와이드 (2주)
      } else {
        setAutoSpanDays(7);  // 기본 (1주)
      }
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

  // 날짜 범위: 로컬 타임존 기준 activeSpanDays 동적 타임라인 블록
  const timelineDates = useMemo(() => {
    const dates: { fullDate: string; label: string; isToday: boolean }[] = [];
    const base = new Date();
    base.setDate(base.getDate() + dateOffsetDays);
    const todayStr = formatDateToLocalKey(new Date());

    for (let i = activeSpanDays - 1; i >= 0; i--) {
      const d = new Date(base);
      d.setDate(d.getDate() - i);
      const key = formatDateToLocalKey(d);
      const mmdd = key.slice(5);
      dates.push({
        fullDate: key,
        label: key === todayStr ? `${mmdd} (오늘)` : mmdd,
        isToday: key === todayStr,
      });
    }
    return dates;
  }, [dateOffsetDays, todayLocalKey, activeSpanDays]);

  // 전역 플로팅 비서(봄이) 열림/닫힘 상태 (채널톡 스타일)
  const [isAssistantOpen, setIsAssistantOpen] = useState(false);
  const [showTooltip, setShowTooltip] = useState(true);

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
      {isPreview ? <VariantBar current="v16" /> : null}

      {/* 4K Ultra-Wide Header: Stitch Violet Capsule Minimal */}
      <div className="up15-header-wrapper">
        <header className="up15-header">
          {/* Brand */}
          <div className="up15-brand">
            <div className="up15-logo-icon">
              <Icon name="ghost" />
            </div>
            <div className="up15-brand-text">
              <div className="up15-brand-text-row">
                <strong>이어봄</strong>
                <span className="up15-brand-dot" />
              </div>
              <span>우리 가족 웰니스 케어</span>
            </div>

            {/* Nav Items */}
            <nav className="up15-nav" aria-label="메인 메뉴">
              <button type="button" className="up15-nav-btn active">가족 홈</button>
              <button type="button" className="up15-nav-btn" onClick={() => void navigate("/pain-diary")}>통증 다이어리</button>
              <button type="button" className="up15-nav-btn" onClick={() => void navigate("/assessment")}>위험 판정 / 리포트</button>
              <button type="button" className="up15-nav-btn" onClick={() => void navigate("/health-data3")}>건강 데이터 3</button>
            </nav>
          </div>

          {/* Header Actions */}
          <div className="up15-actions">
            <button type="button" className="up15-icon-btn" aria-label="기록 검색">
              <Icon name="search" />
            </button>
            <button type="button" className="up15-icon-btn" aria-label="알림">
              <Icon name="bell" />
              <span style={{ position: "absolute", top: "7px", right: "7px", width: "6px", height: "6px", borderRadius: "50%", background: "var(--up15-periwinkle)" }} />
            </button>

            <StitchAccountChip displayName={activeProfile?.displayName} />
          </div>
        </header>
      </div>

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

        {/* 상단 분할: 주의 알림 카드 (4.5 cols) + 가족 구성원 선택 레일 (7.5 cols) */}
        <section className="up15-top-grid">
          {/* 확인이 필요한 변화 카드 */}
          <article className="up15-card">
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

          {/* 가족 구성원 선택 레일 */}
          <article className="up15-card">
            <div>
              <div className="up15-card-head">
                <div>
                  <strong style={{ fontSize: "15px", color: "var(--up15-aubergine)", display: "block" }}>우리 가족 구성원</strong>
                  <span style={{ fontSize: "11px", color: "var(--up15-fog)" }}>카드를 선택해 개별 건강 타임라인으로 즉시 전환합니다.</span>
                </div>
                <button
                  type="button"
                  style={{ background: "none", border: 0, color: "var(--up15-aubergine)", fontSize: "12px", cursor: "pointer", display: "flex", alignItems: "center", gap: "4px" }}
                  onClick={() => void navigate("/account")}
                >
                  가족 관리 <Icon name="chevron-right" />
                </button>
              </div>

              <div className="up15-member-grid">
                {/* 1. 본인 */}
                <div
                  className={`up15-member-cell ${(!selectedProfileId || selectedProfileId === profiles[0]?.id) ? "selected" : ""}`}
                  onClick={() => profiles[0] && setSelectedProfileId(profiles[0].id)}
                >
                  <span className="up15-member-status-dot" style={{ background: "var(--up15-mint-signal)" }} />
                  <div className="up15-cell-avatar">나</div>
                  <span className="up15-cell-name">오성민 (본인)</span>
                  <span style={{ fontSize: "11px", color: "var(--up15-mint-signal)", fontWeight: 500, marginTop: "2px" }}>안정</span>
                  <span className="up15-cell-desc">44세 · 남</span>
                </div>

                {/* 2. 아빠 */}
                <div className="up15-member-cell">
                  <span className="up15-member-status-dot" style={{ background: "var(--up15-buttercream)", border: "1px solid var(--up15-aubergine)" }} />
                  <div className="up15-cell-avatar">아빠</div>
                  <span className="up15-cell-name">오진철</span>
                  <span style={{ fontSize: "11px", color: "var(--up15-aubergine)", marginTop: "2px" }}>주의 필요</span>
                  <span className="up15-cell-desc">72세 · 남</span>
                </div>

                {/* 3. 엄마 */}
                <div className="up15-member-cell">
                  <span className="up15-member-status-dot" style={{ background: "var(--up15-blush-mist)", border: "1px solid var(--up15-aubergine)" }} />
                  <div className="up15-cell-avatar">엄마</div>
                  <span className="up15-cell-name">김다원</span>
                  <span style={{ fontSize: "11px", color: "var(--up15-aubergine)", marginTop: "2px" }}>주의 필요</span>
                  <span className="up15-cell-desc">42세 · 여</span>
                </div>

                {/* 4. 동생 */}
                <div className="up15-member-cell">
                  <span className="up15-member-status-dot" style={{ background: "var(--up15-mint-signal)" }} />
                  <div className="up15-cell-avatar">동생</div>
                  <span className="up15-cell-name">오민재</span>
                  <span style={{ fontSize: "11px", color: "var(--up15-mint-signal)", fontWeight: 500, marginTop: "2px" }}>안정</span>
                  <span className="up15-cell-desc">14세 · 자녀</span>
                </div>

                {/* 구성원 추가 */}
                <button
                  type="button"
                  style={{ border: "1px dashed var(--up15-ash)", borderRadius: "20px", background: "transparent", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "var(--up15-fog)", padding: "12px" }}
                  onClick={() => void navigate("/")}
                >
                  <div style={{ width: "34px", height: "34px", borderRadius: "50%", background: "#fff", display: "grid", placeItems: "center", marginBottom: "4px" }}>
                    <Icon name="plus" />
                  </div>
                  <span style={{ fontSize: "11px" }}>구성원 추가</span>
                </button>
              </div>
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
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <strong style={{ fontSize: "16px", color: "var(--up15-aubergine)" }}>가족 건강 통합 모니터링</strong>
                    <span style={{ padding: "3px 10px", background: "var(--up15-bone)", border: "1px solid var(--up15-ash)", borderRadius: "100px", fontSize: "11px", color: "var(--up15-aubergine)" }}>
                      실시간 기록
                    </span>
                    <span style={{ padding: "3px 10px", background: "rgba(226, 223, 254, 0.4)", borderRadius: "100px", fontSize: "11px", color: "var(--up15-aubergine)", fontWeight: 500 }}>
                      {activeSpanDays}일 연속 추이
                    </span>
                  </div>
                  <p style={{ margin: "4px 0 0", fontSize: "12px", color: "var(--up15-fog)" }}>
                    화면 너비에 맞춰 7일/14일/21일/28일로 유연하게 확장되며, 단일 타임라인에서 정제하여 보여줍니다.
                  </p>
                </div>

                <div className="up16-timeline-controls-group">
                  {/* 기간 범위 선택기 */}
                  <div className="up16-timeline-span-controls" role="group" aria-label="표시 기간 선택">
                    <span className="up16-span-label">기간:</span>
                    <button
                      type="button"
                      className={`up16-span-pill ${timelineSpanMode === "auto" ? "active" : ""}`}
                      onClick={() => setTimelineSpanMode("auto")}
                      title={`화면 너비에 맞춰 자동 조절 (현재 ${activeSpanDays}일)`}
                    >
                      자동({activeSpanDays}일)
                    </button>
                    {([7, 14, 21, 28] as const).map((days) => (
                      <button
                        key={days}
                        type="button"
                        className={`up16-span-pill ${timelineSpanMode === days ? "active" : ""}`}
                        onClick={() => setTimelineSpanMode(days)}
                      >
                        {days}일
                      </button>
                    ))}
                  </div>

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

              {/* Timeline Matrix Table (반응형 컬럼 동적 렌더링) */}
              <div style={{ overflowX: "auto" }}>
                <table className="up15-timeline-table">
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left", width: "130px", minWidth: "120px" }}>구성원</th>
                      {timelineDates.map((item) => (
                        <th
                          key={item.fullDate}
                          style={
                            item.isToday
                              ? {
                                  color: "var(--up15-aubergine)",
                                  background: "rgba(226, 223, 254, 0.35)",
                                  borderRadius: "10px 10px 0 0",
                                  fontWeight: 600,
                                }
                              : {}
                          }
                        >
                          {item.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {/* 구성원 1: 나 */}
                    <tr>
                      <td style={{ textAlign: "left", fontWeight: 500, color: "var(--up15-aubergine)" }}>
                        나 ({activeProfile?.displayName ?? "성민"})
                      </td>
                      {timelineDates.map((item, idx) => {
                        if (item.isToday) {
                          return (
                            <td key={item.fullDate} style={{ background: "rgba(226, 223, 254, 0.35)" }}>
                              <span className="up15-timeline-pill lavender" style={{ background: "#fff", border: "1px dashed var(--up15-aubergine)" }}>
                                오늘 대기
                              </span>
                            </td>
                          );
                        }
                        // 날짜별 샘플 데이터 매핑
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
                          <td key={item.fullDate}>
                            <span className={`up15-timeline-pill ${sample.type}`}>{sample.label}</span>
                          </td>
                        );
                      })}
                    </tr>

                    {/* 구성원 2: 엄마 */}
                    <tr>
                      <td style={{ textAlign: "left", color: "var(--up15-obsidian)" }}>김다원 (엄마)</td>
                      {timelineDates.map((item, idx) => {
                        if (item.isToday) {
                          return (
                            <td key={item.fullDate} style={{ background: "rgba(226, 223, 254, 0.35)" }}>
                              <span className="up15-timeline-pill bone" style={{ background: "#fff" }}>
                                양호
                              </span>
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
                          <td key={item.fullDate}>
                            <span className={`up15-timeline-pill ${sample.type}`}>{sample.label}</span>
                          </td>
                        );
                      })}
                    </tr>

                    {/* 구성원 3: 동생 */}
                    <tr>
                      <td style={{ textAlign: "left", color: "var(--up15-obsidian)" }}>오민재 (동생)</td>
                      {timelineDates.map((item, idx) => {
                        if (item.isToday) {
                          return (
                            <td key={item.fullDate} style={{ background: "rgba(226, 223, 254, 0.35)" }}>
                              <span className="up15-timeline-pill bone" style={{ background: "#fff" }}>
                                정상
                              </span>
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
                          <td key={item.fullDate}>
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

              <div style={{ marginTop: "14px", background: "var(--up15-bone)", border: "1px solid var(--up15-ash)", borderRadius: "14px", padding: "10px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "12px" }}>
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

            {/* 2. 주요 건강지표 추이 (7 cols) + 만성질환 위험도 & 습관 (5 cols) */}
            <div className="up15-mid-subgrid">
              {/* 4K 와이드 실측 차트 (health-data2 연동) */}
              <article className="up15-card">
                <div>
                  <div className="up15-card-head">
                    <div>
                      <strong style={{ fontSize: "15px", color: "var(--up15-aubergine)", display: "block" }}>주요 건강지표 추이</strong>
                      <span style={{ fontSize: "11px", color: "var(--up15-fog)" }}>실측 시계열 데이터 (health-data2 연동)</span>
                    </div>

                    <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                      <div style={{ display: "flex", background: "var(--up15-bone)", borderRadius: "100px", padding: "3px", border: "1px solid var(--up15-ash)" }}>
                        {(["90d", "1y", "all"] as Period[]).map((p) => (
                          <button
                            key={p}
                            type="button"
                            className={`up15-nav-btn ${period === p ? "active" : ""}`}
                            style={{ padding: "3px 8px", fontSize: "11px" }}
                            onClick={() => setPeriod(p)}
                          >
                            {p === "90d" ? "3개월" : p === "1y" ? "1년" : "전체"}
                          </button>
                        ))}
                      </div>
                      <div style={{ display: "flex", background: "var(--up15-bone)", borderRadius: "100px", padding: "3px", border: "1px solid var(--up15-ash)" }}>
                        <button
                          type="button"
                          className={`up15-nav-btn ${metricKey === "weight_kg" ? "active" : ""}`}
                          style={{ padding: "3px 10px", fontSize: "11px" }}
                          onClick={() => setMetricKey("weight_kg")}
                        >
                          체중
                        </button>
                        <button
                          type="button"
                          className={`up15-nav-btn ${metricKey === "sbp" ? "active" : ""}`}
                          style={{ padding: "3px 10px", fontSize: "11px" }}
                          onClick={() => setMetricKey("sbp")}
                        >
                          혈압
                        </button>
                        <button
                          type="button"
                          className={`up15-nav-btn ${metricKey === "fasting_glucose" ? "active" : ""}`}
                          style={{ padding: "3px 10px", fontSize: "11px" }}
                          onClick={() => setMetricKey("fasting_glucose")}
                        >
                          혈당
                        </button>
                      </div>
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "baseline", gap: "10px", margin: "8px 0" }}>
                    <span style={{ fontSize: "32px", fontWeight: 350, color: "var(--up15-aubergine)" }}>
                      {metricKey === "sbp"
                        ? `${sbpVals.at(-1)} / ${dbpVals.at(-1)}`
                        : metricKey === "fasting_glucose"
                        ? `${glucoseVals.at(-1)}`
                        : `${weightVals.at(-1)}`}
                    </span>
                    <span style={{ fontSize: "12px", color: "var(--up15-fog)" }}>{currentMetricSpec.unit}</span>
                    <span className="up15-badge-blush">안정적 모니터링</span>
                  </div>

                  {/* 4K 와이드 시계열 차트 본체 */}
                  <div style={{ background: "rgba(244, 242, 244, 0.5)", borderRadius: "18px", padding: "14px", border: "1px solid var(--up15-ash)" }}>
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: "12px", fontSize: "11px", marginBottom: "6px" }}>
                      <span style={{ display: "flex", alignItems: "center", gap: "4px", color: "var(--up15-aubergine)" }}>
                        <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "var(--up15-aubergine)" }} /> 수축기
                      </span>
                      <span style={{ display: "flex", alignItems: "center", gap: "4px", color: "var(--up15-periwinkle)" }}>
                        <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "var(--up15-periwinkle)" }} /> 이완기
                      </span>
                    </div>

                    <HealthData2ThemeWideChart
                      systolicValues={metricKey === "sbp" ? sbpVals : metricKey === "fasting_glucose" ? glucoseVals : weightVals}
                      diastolicValues={metricKey === "sbp" ? dbpVals : []}
                      label={currentMetricSpec.label}
                    />
                  </div>
                </div>

                <div style={{ marginTop: "14px", paddingTop: "12px", borderTop: "1px solid var(--up15-ash)", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "12px" }}>
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

              {/* 만성질환 위험도 판정 및 오늘의 건강 습관 */}
              <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                <article className="up15-card" style={{ padding: "20px" }}>
                  <div className="up15-card-head" style={{ marginBottom: "12px" }}>
                    <strong style={{ fontSize: "15px", color: "var(--up15-aubergine)" }}>만성질환 위험도 판정</strong>
                    <span style={{ fontSize: "11px", color: "var(--up15-fog)" }}>AI 예측 모델</span>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", background: "var(--up15-bone)", borderRadius: "14px" }}>
                      <span style={{ fontSize: "12px", color: "var(--up15-obsidian)" }}>고혈압 주의군</span>
                      <span className="up15-badge-blush">관찰 필요</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", background: "var(--up15-bone)", borderRadius: "14px" }}>
                      <span style={{ fontSize: "12px", color: "var(--up15-obsidian)" }}>당뇨 발생 예측</span>
                      <span style={{ fontSize: "11px", background: "#fff", border: "1px solid var(--up15-ash)", padding: "2px 8px", borderRadius: "100px", color: "var(--up15-fog)" }}>
                        정상 범위
                      </span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", background: "var(--up15-bone)", borderRadius: "14px" }}>
                      <span style={{ fontSize: "12px", color: "var(--up15-obsidian)" }}>고지혈증 지수</span>
                      <span style={{ fontSize: "11px", background: "var(--up15-ghost-lavender)", padding: "2px 8px", borderRadius: "100px", color: "var(--up15-aubergine)", fontWeight: 500 }}>
                        양호
                      </span>
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

                <article className="up15-card" style={{ padding: "20px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                    <strong style={{ fontSize: "13px", color: "var(--up15-aubergine)" }}>오늘의 건강 습관</strong>
                    <span style={{ fontSize: "12px", color: "var(--up15-fog)" }}>2 / 3 완료</span>
                  </div>

                  <div style={{ width: "100%", background: "var(--up15-ash)", height: "6px", borderRadius: "100px", overflow: "hidden", marginBottom: "12px" }}>
                    <div style={{ width: "66%", height: "100%", background: "var(--up15-aubergine)", borderRadius: "100px" }} />
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: "8px", fontSize: "12px" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: "8px", color: "var(--up15-fog)", textDecoration: "line-through", cursor: "pointer" }}>
                      <input type="checkbox" defaultChecked />
                      <span>아침 식후 혈압약 복용</span>
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: "8px", color: "var(--up15-fog)", textDecoration: "line-through", cursor: "pointer" }}>
                      <input type="checkbox" defaultChecked />
                      <span>미온수 1.5L 수분 보충</span>
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: "8px", color: "var(--up15-obsidian)", cursor: "pointer" }}>
                      <input type="checkbox" />
                      <span>저녁 20분 가벼운 유산소 걷기</span>
                    </label>
                  </div>
                </article>
              </div>
            </div>
          </div>

          {/* ================= RIGHT COLUMN: 3.5 COLS (3D 인체 바디맵 뷰어 - 4K 전체 높이 활용) ================= */}
          <div className="up15-right-col">
            <article className="up15-card up15-body-card">
              <div className="up15-card-head" style={{ paddingBottom: "10px", borderBottom: "1px solid var(--up15-ash)", flexShrink: 0 }}>
                <div>
                  <strong style={{ fontSize: "16px", color: "var(--up15-aubergine)", display: "block" }}>인체 통증 매핑 (3D 바디맵)</strong>
                  <span style={{ fontSize: "11px", color: "var(--up15-fog)" }}>불편한 부위를 선택해 3D 모델로 정밀 관찰합니다</span>
                </div>
              </div>

              {/* 해부학적 레이어 선택 버튼 */}
              <div className="up15-layer-pills" style={{ marginTop: "10px", flexShrink: 0 }}>
                <button
                  type="button"
                  className={`up15-layer-btn ${selectedOrgan === "stomach" ? "active" : ""}`}
                  onClick={() => setSelectedOrgan("stomach")}
                >
                  소화기계 (위·명치)
                </button>
                <button
                  type="button"
                  className={`up15-layer-btn ${selectedOrgan === "heart" ? "active" : ""}`}
                  onClick={() => setSelectedOrgan("heart")}
                >
                  심혈관계 (심장)
                </button>
                <button
                  type="button"
                  className={`up15-layer-btn ${selectedOrgan === "kidney" ? "active" : ""}`}
                  onClick={() => setSelectedOrgan("kidney")}
                >
                  비뇨기계 (신장)
                </button>
                <button
                  type="button"
                  className={`up15-layer-btn ${selectedOrgan === "all" ? "active" : ""}`}
                  onClick={() => setSelectedOrgan("all")}
                >
                  전체 보기
                </button>
              </div>

              {/* 실제 인터랙티브 3D 인체 모델 뷰어 (전체 세로 높이를 시원하게 채움) */}
              <div className="up15-body-viewport">
                <Suspense fallback={<div style={{ height: "100%", display: "grid", placeItems: "center", color: "var(--up15-fog)", fontSize: "12px" }}>3D 인체 뷰어를 준비 중입니다…</div>}>
                  <VanatomeBodyMap
                    key={`${activeProfile?.id}-${activeProfile?.gender}`}
                    profileName={activeProfile?.displayName ?? "오성민"}
                    gender={activeProfile?.gender}
                    risks={bodyRisks}
                    highlightOrganKey={selectedOrgan}
                  />
                </Suspense>
              </div>
            </article>
          </div>
        </section>

        {/* 4K 와이드 하단 요약 그리드 (시안 2의 4열 스탯 & 기능 카드 연계) */}
        <section className="up15-bottom-stats-grid">
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

          <div className="up15-stat-card">
            <div>
              <span className="up15-sub-label">복약 순응도</span>
              <div className="up15-stat-val">94.2%</div>
            </div>
            <span style={{ fontSize: "11px", color: "var(--up15-fog)" }}>30일간 총 28회 정시 복용</span>
          </div>

          <div className="up15-stat-card" style={{ background: "rgba(226, 223, 254, 0.4)", border: "1px solid var(--up15-periwinkle)" }}>
            <div>
              <span className="up15-sub-label" style={{ color: "var(--up15-aubergine)" }}>인공지능 비서 연동</span>
              <div className="up15-stat-val" style={{ fontSize: "20px", marginTop: "12px", color: "var(--up15-aubergine)" }}>
                봄이 실시간 상담 활성
              </div>
            </div>
            <button
              type="button"
              className="up15-nav-btn active"
              style={{ width: "100%", justifyContent: "center", marginTop: "8px", fontSize: "11px" }}
              onClick={() => setIsAssistantOpen(true)}
            >
              봄이와 상담창 열기
            </button>
          </div>
        </section>
      </main>

      {/* ==========================================================================
         봄이 - 건강비서 채널톡 스타일 플로팅 메신저 인터페이스 (http://localhost/ 홈 스타일)
         ========================================================================== */}
      <div className="up15-floating-assistant-launcher">
        {showTooltip && !isAssistantOpen && (
          <div className="up15-floating-tooltip" role="status">
            <span>오늘 수치나 몸의 불편한 점이 있다면 봄이에게 편하게 말씀해주세요!</span>
            <button
              type="button"
              style={{ background: "none", border: 0, cursor: "pointer", color: "var(--up15-fog)", marginLeft: "4px" }}
              onClick={() => setShowTooltip(false)}
            >
              ✕
            </button>
          </div>
        )}

        <button
          type="button"
          className={`up15-floating-launcher-btn ${isAssistantOpen ? "is-open" : ""}`}
          onClick={() => setIsAssistantOpen((prev) => !prev)}
          aria-label={isAssistantOpen ? "건강 비서 닫기" : "건강 비서 봄이와 대화하기"}
          title={isAssistantOpen ? "닫기" : "봄이 · 건강 비서"}
        >
          {isAssistantOpen ? (
            <Icon name="close" />
          ) : (
            <img src={bomiChickIcon} alt="" style={{ width: "34px", height: "34px", objectFit: "contain" }} />
          )}
        </button>
      </div>

      {/* 플로팅 챗봇 팝오버 메신저 드로어 (실제 대화목록·세션관리·다이어리연동 탑재) */}
      {isAssistantOpen && activeProfile && runtime && (
        <aside
          className="channel-talk-popover up15-assistant-scope"
          role="dialog"
          aria-label="봄이 건강 비서"
          aria-modal="false"
        >
          {/* 상단 맥락 바 */}
          <div className="channel-talk-context-bar">
            <span>
              <strong>{activeProfile.displayName}</strong>님 대화 중
            </span>
            <span className="channel-talk-context-tag">
              <span style={{ fontSize: "0.8125rem" }}>●</span> 대시보드 연동
            </span>
          </div>

          {/* 챗봇 메신저 본체 */}
          <Suspense fallback={<ChatLoadingSkeleton />}>
            <HealthAssistantDrawer
              key={activeProfile.id}
              profile={activeProfile}
              runtime={runtime}
              isOpen={isAssistantOpen}
              variant="popover"
              contextLabel="4K 홈"
              onClose={() => setIsAssistantOpen(false)}
              onMinimize={() => setIsAssistantOpen(false)}
              onRecordSaved={() => {
                window.dispatchEvent(
                  new CustomEvent("ieobom:record-saved", { detail: { profileId: activeProfile.id } }),
                );
                try {
                  const channel = new BroadcastChannel("ieobom-sync");
                  channel.postMessage({ type: "record-saved", profileId: activeProfile.id });
                  channel.close();
                } catch {
                  // BroadcastChannel 미지원 환경 무시
                }
              }}
              onNavigateToRecords={() => navigate("/health-data")}
              onNavigateToDiary={(dateKey) => navigate(`/pain-diary?date=${dateKey}`)}
            />
          </Suspense>
        </aside>
      )}

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
                <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--up15-ash)", fontSize: "12px" }}>
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

export default UiPreview16Page;
