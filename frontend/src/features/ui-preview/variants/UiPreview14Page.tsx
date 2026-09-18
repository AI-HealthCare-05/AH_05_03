import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { useLocalDomain } from "../../../app/localDomainContext";
import { TREND_SERIES } from "../../assessment/snapshots";
import { useHealthTimeSeries } from "../../data/useHealthTimeSeries";
import type { HealthRecord } from "../../../shared/local/domainContracts";
import { VariantBar } from "../components/VariantBar";
import { Modal } from "../../../shared/ui/Modal";
import { serverApiClient } from "../../../shared/api/serverApiClient";
import { regionRisks, type RegionRisk } from "../../home/bodyRisk";
import "../styles/shadcn-preview-variants.css";
import "../styles/ui-preview14.css";

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
  name: "ghost" | "search" | "bell" | "arrow-right" | "check" | "chevron-right" | "plus" | "send";
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
  };

  return (
    <svg
      className="up14-icon"
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
 * http://localhost/health-data2 에서 제공하는 것과 동일한 실측 시계열 SVG 차트
 * 컨셉 테마 색상(Aubergine #3c315b, Periwinkle #ab9ff2, Bone #f4f2f4) 적용
 */
function HealthData2ThemeChart({
  systolicValues,
  diastolicValues,
  label,
}: {
  systolicValues: number[];
  diastolicValues: number[];
  label: string;
}) {
  if (systolicValues.length < 2) {
    return (
      <div
        style={{
          height: "170px",
          display: "grid",
          placeItems: "center",
          color: "var(--up14-fog)",
          fontSize: "12px",
          background: "var(--up14-bone)",
          borderRadius: "16px",
        }}
      >
        추이를 계산하려면 두 번 이상의 측정이 필요합니다.
      </div>
    );
  }

  const width = 420;
  const height = 150;
  const allVals = [...systolicValues, ...diastolicValues];
  const min = Math.min(...allVals, 60);
  const max = Math.max(...allVals, 150);
  const span = max - min || 1;

  const toPoints = (arr: number[]) =>
    arr
      .map((val, idx) => {
        const x = 32 + (idx / Math.max(arr.length - 1, 1)) * (width - 64);
        const y = 20 + (1 - (val - min) / span) * (height - 50);
        return `${x},${y}`;
      })
      .join(" ");

  const sysPoints = toPoints(systolicValues);
  const diaPoints = toPoints(diastolicValues);

  return (
    <div style={{ position: "relative", width: "100%", height: "170px" }}>
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height: "100%", overflow: "visible" }} role="img" aria-label={`${label} 추이 차트`}>
        <title>{label} 추이</title>
        {[0, 1, 2].map((i) => (
          <line
            key={i}
            x1="24"
            x2={width - 24}
            y1={24 + i * 48}
            y2={24 + i * 48}
            stroke="var(--up14-ash)"
            strokeDasharray="4 4"
            strokeWidth="1"
          />
        ))}
        {/* Systolic (Aubergine) */}
        <polyline points={sysPoints} fill="none" stroke="var(--up14-aubergine)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        {sysPoints.split(" ").map((pt, i) => {
          const [cx, cy] = pt.split(",");
          const isLatest = i === systolicValues.length - 1;
          return (
            <circle
              key={`s-${i}`}
              cx={cx}
              cy={cy}
              r={isLatest ? 5.5 : 3.5}
              fill={isLatest ? "var(--up14-aubergine)" : "#fff"}
              stroke="var(--up14-aubergine)"
              strokeWidth="2.5"
            />
          );
        })}
        {/* Diastolic (Periwinkle) */}
        <polyline points={diaPoints} fill="none" stroke="var(--up14-periwinkle)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        {diaPoints.split(" ").map((pt, i) => {
          const [cx, cy] = pt.split(",");
          const isLatest = i === diastolicValues.length - 1;
          return (
            <circle
              key={`d-${i}`}
              cx={cx}
              cy={cy}
              r={isLatest ? 5.5 : 3.5}
              fill={isLatest ? "var(--up14-periwinkle)" : "#fff"}
              stroke="var(--up14-periwinkle)"
              strokeWidth="2.5"
            />
          );
        })}
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", padding: "0 28px", fontSize: "11px", color: "var(--up14-fog)" }}>
        <span>첫 측정</span>
        <span style={{ color: "var(--up14-aubergine)", fontWeight: 500 }}>최근 실측</span>
      </div>
    </div>
  );
}

function formatDateTime(value?: string | null) {
  if (!value) return "확인되지 않음";
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function UiPreview14Page() {
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

  const [chatInput, setChatInput] = useState("");
  const [chatLogs, setChatLogs] = useState<Array<{ sender: "user" | "ai"; text: string }>>([
    {
      sender: "user",
      text: "명치가 이물감이 들고 체한 것 같아서 잠잘 때 너무 불편해.",
    },
    {
      sender: "ai",
      text: "명치 부근의 압박감과 수면 시 불편감은 위식도 역류 혹은 소화기 부담일 수 있습니다. 다이어리 초안을 준비했어요.",
    },
  ]);

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

  // 원본 문서 로드
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

  const handleSendMessage = () => {
    if (!chatInput.trim()) return;
    const userMsg = chatInput;
    setChatInput("");
    setChatLogs((prev) => [...prev, { sender: "user", text: userMsg }]);
    setTimeout(() => {
      setChatLogs((prev) => [
        ...prev,
        {
          sender: "ai",
          text: `"${userMsg}"에 대한 생체 지표 및 건강기록을 모니터링에 안전하게 동기화했습니다.`,
        },
      ]);
    }, 600);
  };

  return (
    <div className="up14-root">
      {isPreview ? <VariantBar current="v14" /> : null}

      {/* BEGIN: Phantom Pill Global Header */}
      <div className="up14-header-wrapper">
        <header className="up14-header">
          <div style={{ display: "flex", alignItems: "center", gap: "24px" }}>
            <a className="up14-brand" href="#home" onClick={(e) => { e.preventDefault(); void navigate("/"); }}>
              <div className="up14-logo-icon">
                <Icon name="ghost" />
              </div>
              <div className="up14-brand-text">
                <div className="up14-brand-text-row">
                  <strong>이어봄</strong>
                  <span className="up14-brand-dot" />
                </div>
                <span>우리 가족 웰니스 케어</span>
              </div>
            </a>

            <nav className="up14-nav" aria-label="메인 내비게이션">
              <button type="button" className="up14-nav-btn active" onClick={() => void navigate("/")}>
                가족 홈
              </button>
              <button type="button" className="up14-nav-btn" onClick={() => void navigate("/pain-diary")}>
                통증 다이어리
              </button>
              <button type="button" className="up14-nav-btn" onClick={() => void navigate("/assessment")}>
                위험 판정 / 리포트
              </button>
              <button type="button" className="up14-nav-btn" onClick={() => void navigate("/challenge")}>
                데일리 챌린지
              </button>
              <button type="button" className="up14-nav-btn" onClick={() => void navigate("/health-data")}>
                의료 데이터
              </button>
            </nav>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <button
              type="button"
              aria-label="검색"
              style={{ width: "32px", height: "32px", borderRadius: "50%", border: 0, background: "transparent", color: "var(--up14-aubergine)", cursor: "pointer", display: "grid", placeItems: "center" }}
            >
              <Icon name="search" />
            </button>
            <button
              type="button"
              aria-label="알림"
              style={{ position: "relative", width: "32px", height: "32px", borderRadius: "50%", border: 0, background: "transparent", color: "var(--up14-aubergine)", cursor: "pointer", display: "grid", placeItems: "center" }}
            >
              <Icon name="bell" />
              <span style={{ position: "absolute", top: "6px", right: "6px", width: "5px", height: "5px", background: "var(--up14-periwinkle)", borderRadius: "50%" }} />
            </button>
            <div className="up14-user-profile" onClick={() => void navigate("/account")} style={{ cursor: "pointer" }}>
              <div className="up14-user-avatar">
                {activeProfile?.displayName?.slice(0, 2) ?? "성민"}
              </div>
              <span className="up14-user-name">{activeProfile?.displayName ?? "오성민"} (나)</span>
            </div>
          </div>
        </header>
      </div>

      {/* BEGIN: Main Dashboard Content */}
      <main className="up14-main">
        {/* 상단 1: 인사말 & 실시간 상태 개요 */}
        <section className="up14-greeting-row">
          <div className="up14-greeting-title">
            <h1>오늘 우리 가족 건강은 이래요</h1>
            <span className="up14-date-pill">2026.09.15 화요일</span>
          </div>
          <div className="up14-sync-badge">
            <span className="up14-dot-mint" />
            <span>4개 디바이스 실시간 연동 중</span>
          </div>
        </section>

        {/* 상단 2: 확인이 필요한 변화 (알림 5 cols) + 가족 구성원 선택 (7 cols) */}
        <section className="up14-top-grid">
          {/* 알림 카드 */}
          <article className="up14-card">
            <div>
              <div className="up14-card-head">
                <div className="up14-card-title-group">
                  <span className="up14-badge-blush">주의 2건</span>
                  <strong style={{ fontSize: "15px", color: "var(--up14-aubergine)" }}>확인이 필요한 변화</strong>
                </div>
                <span className="up14-sub-label">AI 사전 감지</span>
              </div>

              <div className="up14-alert-list">
                <div className="up14-alert-item" onClick={() => void navigate("/health-data")}>
                  <div className="up14-alert-item-left">
                    <span className="up14-member-tag">아빠</span>
                    <div>
                      <strong style={{ color: "var(--up14-aubergine)", marginRight: "6px" }}>혈압 상승 추세</strong>
                      <span style={{ color: "var(--up14-fog)" }}>128/84 mmHg · 이전 대비 완만 상승</span>
                    </div>
                  </div>
                  <Icon name="chevron-right" />
                </div>

                <div className="up14-alert-item" onClick={() => void navigate("/health-data")}>
                  <div className="up14-alert-item-left">
                    <span className="up14-member-tag">엄마</span>
                    <div>
                      <strong style={{ color: "var(--up14-aubergine)", marginRight: "6px" }}>공복혈당 경계</strong>
                      <span style={{ color: "var(--up14-fog)" }}>118 mg/dL · 식후 혈당 모니터 권장</span>
                    </div>
                  </div>
                  <Icon name="chevron-right" />
                </div>
              </div>
            </div>

            <div style={{ marginTop: "16px", paddingTop: "14px", borderTop: "1px solid var(--up14-ash)", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "11px" }}>
              <span style={{ color: "var(--up14-fog)" }}>28개 임상 지표 대조 완료</span>
              <button
                type="button"
                className="up14-cta-button"
                style={{ width: "auto", padding: "6px 16px" }}
                onClick={() => void navigate("/health-data2")}
              >
                <span>변화 자세히 보기</span>
                <Icon name="arrow-right" />
              </button>
            </div>
          </article>

          {/* 우리 가족 구성원 셀렉터 */}
          <article className="up14-card">
            <div>
              <div className="up14-card-head">
                <div>
                  <strong style={{ fontSize: "15px", color: "var(--up14-aubergine)", display: "block" }}>우리 가족 구성원</strong>
                  <span style={{ fontSize: "11px", color: "var(--up14-fog)" }}>카드를 선택해 개별 건강 타임라인으로 즉시 전환합니다.</span>
                </div>
                <button
                  type="button"
                  style={{ border: 0, background: "transparent", fontSize: "11px", color: "var(--up14-aubergine)", cursor: "pointer" }}
                  onClick={() => void navigate("/members")}
                >
                  가족 관리 &gt;
                </button>
              </div>

              <div className="up14-member-grid">
                {profiles.map((profile) => {
                  const isSelected = profile.id === activeProfile?.id;
                  const isCaution = profile.relationship?.includes("부") || profile.relationship?.includes("모");
                  return (
                    <div
                      key={profile.id}
                      className={`up14-member-cell ${isSelected ? "selected" : ""}`}
                      onClick={() => setSelectedProfileId(profile.id)}
                    >
                      <span
                        className="up14-member-status-dot"
                        style={{
                          background: isCaution ? "var(--up14-blush-mist)" : "var(--up14-mint-signal)",
                          border: isCaution ? "1px solid rgba(60, 49, 91, 0.2)" : "none",
                        }}
                      />
                      <div className="up14-cell-avatar">
                        {profile.displayName.slice(0, 2)}
                      </div>
                      <span className="up14-cell-name">{profile.displayName}</span>
                      <span className="up14-cell-desc">{profile.relationship || "가족"}</span>
                    </div>
                  );
                })}

                <button
                  type="button"
                  style={{
                    padding: "14px 10px",
                    border: "1px dashed var(--up14-ash)",
                    borderRadius: "18px",
                    background: "transparent",
                    color: "var(--up14-fog)",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                  }}
                  onClick={() => void navigate("/")}
                >
                  <div style={{ width: "32px", height: "32px", borderRadius: "50%", background: "#fff", display: "grid", placeItems: "center", marginBottom: "4px" }}>
                    <Icon name="plus" />
                  </div>
                  <span style={{ fontSize: "11px" }}>구성원 추가</span>
                </button>
              </div>
            </div>
          </article>
        </section>

        {/* 중단 분할: 8 cols (통합 모니터링, 추이 차트, 위험도) vs 4 cols (3D 인체 바디맵 & AI 비서) */}
        <section className="up14-content-split">
          {/* ================= LEFT COLUMN: 8 COLS ================= */}
          <div className="up14-left-col">
            {/* 1. 가족 건강 통합 모니터링 매트릭스 */}
            <article className="up14-card">
              <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", paddingBottom: "14px", borderBottom: "1px solid var(--up14-ash)", gap: "10px" }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <strong style={{ fontSize: "15px", color: "var(--up14-aubergine)" }}>가족 건강 통합 모니터링</strong>
                    <span style={{ padding: "2px 8px", background: "var(--up14-bone)", border: "1px solid var(--up14-ash)", borderRadius: "100px", fontSize: "11px", color: "var(--up14-aubergine)" }}>
                      실시간 기록
                    </span>
                  </div>
                  <p style={{ margin: "4px 0 0", fontSize: "11px", color: "var(--up14-fog)" }}>
                    가족 구성원의 정량 검사, 자가 통증 기록을 단일 타임라인에서 정제하여 보여줍니다.
                  </p>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <div style={{ display: "flex", background: "var(--up14-bone)", borderRadius: "100px", padding: "3px", border: "1px solid var(--up14-ash)" }}>
                    <button type="button" className="up14-nav-btn active" style={{ padding: "3px 10px", fontSize: "11px" }}>
                      기록 기반
                    </button>
                    <button type="button" className="up14-nav-btn" style={{ padding: "3px 10px", fontSize: "11px" }} onClick={() => void navigate("/assessment")}>
                      예측 뷰
                    </button>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", background: "var(--up14-bone)", borderRadius: "100px", padding: "4px 10px", border: "1px solid var(--up14-ash)", fontSize: "11px" }}>
                    <span>오늘</span>
                  </div>
                </div>
              </div>

              {/* Legend Strip */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: "14px", padding: "10px 0", borderBottom: "1px solid var(--up14-ash)", fontSize: "11px", color: "var(--up14-fog)" }}>
                <span style={{ display: "flex", alignItems: "center", gap: "6px" }}><span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "var(--up14-blush-mist)" }} /> 진단 기록 / 주의</span>
                <span style={{ display: "flex", alignItems: "center", gap: "6px" }}><span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "var(--up14-buttercream)" }} /> 자가 증상 / 통증</span>
                <span style={{ display: "flex", alignItems: "center", gap: "6px" }}><span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "var(--up14-ghost-lavender)" }} /> 정량 수치</span>
                <span style={{ display: "flex", alignItems: "center", gap: "6px" }}><span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "var(--up14-bone)", border: "1px solid var(--up14-ash)" }} /> 정상 / 안정</span>
              </div>

              {/* Timeline Matrix Table */}
              <div style={{ overflowX: "auto" }}>
                <table className="up14-timeline-table">
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left", width: "90px" }}>구성원</th>
                      <th>09-10</th>
                      <th>09-11</th>
                      <th>09-12</th>
                      <th>09-13</th>
                      <th>09-14</th>
                      <th style={{ color: "var(--up14-aubergine)", background: "rgba(226, 223, 254, 0.3)", borderRadius: "10px 10px 0 0", fontWeight: 500 }}>09-15 (오늘)</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td style={{ textAlign: "left", fontWeight: 500, color: "var(--up14-aubergine)" }}>
                        나 ({activeProfile?.displayName ?? "성민"})
                      </td>
                      <td><span className="up14-timeline-pill lavender">혈압 122</span></td>
                      <td><span className="up14-timeline-pill bone">어깨 1</span></td>
                      <td><span className="up14-timeline-pill blush">혈압주의</span></td>
                      <td><span className="up14-timeline-pill butter">명치 2</span></td>
                      <td><span className="up14-timeline-pill lavender">혈압 128</span></td>
                      <td style={{ background: "rgba(226, 223, 254, 0.3)" }}>
                        <span className="up14-timeline-pill lavender" style={{ background: "#fff", border: "1px dashed var(--up14-aubergine)" }}>
                          오늘 대기
                        </span>
                      </td>
                    </tr>
                    <tr>
                      <td style={{ textAlign: "left", color: "var(--up14-obsidian)" }}>김다원 (엄마)</td>
                      <td><span className="up14-timeline-pill bone">혈당 98</span></td>
                      <td><span className="up14-timeline-pill lavender">검진 서류</span></td>
                      <td><span className="up14-timeline-pill butter">편두통 2</span></td>
                      <td><span className="up14-timeline-pill blush">혈당 118</span></td>
                      <td><span className="up14-timeline-pill bone">정상</span></td>
                      <td style={{ background: "rgba(226, 223, 254, 0.3)" }}>
                        <span className="up14-timeline-pill bone" style={{ background: "#fff" }}>양호</span>
                      </td>
                    </tr>
                    <tr>
                      <td style={{ textAlign: "left", color: "var(--up14-obsidian)" }}>오민재 (동생)</td>
                      <td><span style={{ color: "var(--up14-fog)" }}>-</span></td>
                      <td><span className="up14-timeline-pill bone">체온 36.5°</span></td>
                      <td><span style={{ color: "var(--up14-fog)" }}>-</span></td>
                      <td><span className="up14-timeline-pill lavender">운동 완료</span></td>
                      <td><span style={{ color: "var(--up14-fog)" }}>-</span></td>
                      <td style={{ background: "rgba(226, 223, 254, 0.3)" }}>
                        <span className="up14-timeline-pill bone" style={{ background: "#fff" }}>정상</span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div style={{ marginTop: "14px", background: "var(--up14-bone)", border: "1px solid var(--up14-ash)", borderRadius: "14px", padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "11px" }}>
                <span>오늘 {activeProfile?.displayName ?? "나"} 님의 미입력 생체 지표(혈압·혈당)가 남아있습니다.</span>
                <button
                  type="button"
                  style={{ padding: "4px 12px", background: "#fff", border: "1px solid var(--up14-ash)", borderRadius: "100px", color: "var(--up14-aubergine)", cursor: "pointer", fontSize: "11px" }}
                  onClick={() => void navigate("/health-data")}
                >
                  + 수치 기록하기
                </button>
              </div>
            </article>

            {/* 2. 주요 건강지표 추이 (7 cols) + 만성질환 위험도 & 습관 (5 cols) */}
            <div className="up14-mid-subgrid">
              {/* health-data2 실제 차트 연동 카드 */}
              <article className="up14-card">
                <div>
                  <div className="up14-card-head">
                    <div>
                      <strong style={{ fontSize: "15px", color: "var(--up14-aubergine)", display: "block" }}>주요 건강지표 추이</strong>
                      <span style={{ fontSize: "11px", color: "var(--up14-fog)" }}>검진 및 실측 수치 (health-data2 연동)</span>
                    </div>

                    <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                      <div style={{ display: "flex", background: "var(--up14-bone)", borderRadius: "100px", padding: "2px", border: "1px solid var(--up14-ash)" }}>
                        {(["90d", "1y", "all"] as Period[]).map((p) => (
                          <button
                            key={p}
                            type="button"
                            className={`up14-nav-btn ${period === p ? "active" : ""}`}
                            style={{ padding: "2px 6px", fontSize: "11px" }}
                            onClick={() => setPeriod(p)}
                          >
                            {p === "90d" ? "3개월" : p === "1y" ? "1년" : "전체"}
                          </button>
                        ))}
                      </div>
                      <div style={{ display: "flex", background: "var(--up14-bone)", borderRadius: "100px", padding: "3px", border: "1px solid var(--up14-ash)" }}>
                        <button
                          type="button"
                          className={`up14-nav-btn ${metricKey === "weight_kg" ? "active" : ""}`}
                          style={{ padding: "3px 8px", fontSize: "11px" }}
                          onClick={() => setMetricKey("weight_kg")}
                        >
                          체중
                        </button>
                        <button
                          type="button"
                          className={`up14-nav-btn ${metricKey === "sbp" ? "active" : ""}`}
                          style={{ padding: "3px 8px", fontSize: "11px" }}
                          onClick={() => setMetricKey("sbp")}
                        >
                          혈압
                        </button>
                        <button
                          type="button"
                          className={`up14-nav-btn ${metricKey === "fasting_glucose" ? "active" : ""}`}
                          style={{ padding: "3px 8px", fontSize: "11px" }}
                          onClick={() => setMetricKey("fasting_glucose")}
                        >
                          혈당
                        </button>
                      </div>
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "baseline", gap: "8px", margin: "8px 0" }}>
                    <span style={{ fontSize: "28px", fontWeight: 350, color: "var(--up14-aubergine)" }}>
                      {metricKey === "sbp"
                        ? `${sbpVals.at(-1)} / ${dbpVals.at(-1)}`
                        : metricKey === "fasting_glucose"
                        ? `${glucoseVals.at(-1)}`
                        : `${weightVals.at(-1)}`}
                    </span>
                    <span style={{ fontSize: "11px", color: "var(--up14-fog)" }}>{currentMetricSpec.unit}</span>
                    <span className="up14-badge-blush">안정적 모니터링</span>
                  </div>

                  {/* 실제 건강데이터2 스타일 시계열 차트 */}
                  <div style={{ background: "rgba(244, 242, 244, 0.5)", borderRadius: "16px", padding: "12px", border: "1px solid var(--up14-ash)" }}>
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", fontSize: "11px", marginBottom: "4px" }}>
                      <span style={{ display: "flex", alignItems: "center", gap: "4px", color: "var(--up14-aubergine)" }}>
                        <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "var(--up14-aubergine)" }} /> 수축기
                      </span>
                      <span style={{ display: "flex", alignItems: "center", gap: "4px", color: "var(--up14-periwinkle)" }}>
                        <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "var(--up14-periwinkle)" }} /> 이완기
                      </span>
                    </div>

                    <HealthData2ThemeChart
                      systolicValues={metricKey === "sbp" ? sbpVals : metricKey === "fasting_glucose" ? glucoseVals : weightVals}
                      diastolicValues={metricKey === "sbp" ? dbpVals : []}
                      label={currentMetricSpec.label}
                    />
                  </div>
                </div>

                <div style={{ marginTop: "12px", paddingTop: "10px", borderTop: "1px solid var(--up14-ash)", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "11px" }}>
                  <span style={{ color: "var(--up14-fog)" }}>신촌세브란스 종합검진 기록 OCR 판독</span>
                  <a
                    href="#documents"
                    style={{ color: "var(--up14-aubergine)", textDecoration: "none", fontWeight: 500 }}
                    onClick={(e) => {
                      e.preventDefault();
                      if (documentSets[0]) setOpenDocumentSet(documentSets[0]);
                    }}
                  >
                    원본 서류 확인 ↗
                  </a>
                </div>
              </article>

              {/* 만성질환 위험도 판정 및 데일리 습관 */}
              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                <article className="up14-card" style={{ padding: "20px" }}>
                  <div className="up14-card-head" style={{ marginBottom: "10px" }}>
                    <strong style={{ fontSize: "13px", color: "var(--up14-aubergine)" }}>만성질환 위험도 판정</strong>
                    <span className="up14-sub-label">AI 예측 모델</span>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", background: "var(--up14-bone)", borderRadius: "12px", fontSize: "12px" }}>
                      <span>고혈압 주의군</span>
                      <span className="up14-badge-blush">관찰 필요</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", background: "var(--up14-bone)", borderRadius: "12px", fontSize: "12px" }}>
                      <span>당뇨 발생 예측</span>
                      <span style={{ padding: "2px 8px", background: "#fff", border: "1px solid var(--up14-ash)", borderRadius: "100px", fontSize: "11px", color: "var(--up14-fog)" }}>
                        정상 범위
                      </span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", background: "var(--up14-bone)", borderRadius: "12px", fontSize: "12px" }}>
                      <span>고지혈증 지수</span>
                      <span style={{ padding: "2px 8px", background: "var(--up14-ghost-lavender)", color: "var(--up14-aubergine)", borderRadius: "100px", fontSize: "11px" }}>
                        양호
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    className="up14-cta-button"
                    style={{ marginTop: "12px", padding: "8px" }}
                    onClick={() => void navigate("/assessment")}
                  >
                    위험도 심층 분석 보기 →
                  </button>
                </article>

                <article className="up14-card" style={{ padding: "18px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                    <strong style={{ fontSize: "12px", color: "var(--up14-aubergine)" }}>오늘의 건강 습관</strong>
                    <span style={{ fontSize: "11px", color: "var(--up14-fog)" }}>2 / 3 완료</span>
                  </div>
                  <div style={{ width: "100%", height: "4px", background: "var(--up14-ash)", borderRadius: "100px", overflow: "hidden", marginBottom: "10px" }}>
                    <div style={{ width: "66%", height: "100%", background: "var(--up14-aubergine)", borderRadius: "100px" }} />
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "11px", color: "var(--up14-fog)" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <input type="checkbox" defaultChecked />
                      <span style={{ textDecoration: "line-through" }}>아침 식후 혈압약 복용</span>
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <input type="checkbox" defaultChecked />
                      <span style={{ textDecoration: "line-through" }}>미온수 1.5L 수분 보충</span>
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: "6px", color: "var(--up14-obsidian)" }}>
                      <input type="checkbox" />
                      <span>저녁 20분 가벼운 유산소 걷기</span>
                    </label>
                  </div>
                </article>
              </div>
            </div>
          </div>

          {/* ================= RIGHT COLUMN: 4 COLS (3D Body Map & AI Bom-i) ================= */}
          <div className="up14-right-col">
            {/* 3D Anatomical Body Map (컨셉안 인체 매핑 위치를 실제 3D 모델로 고도화) */}
            <article className="up14-body-card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", paddingBottom: "8px", borderBottom: "1px solid var(--up14-ash)" }}>
                <div>
                  <strong style={{ fontSize: "15px", color: "var(--up14-aubergine)", display: "block" }}>인체 통증 및 장기 매핑</strong>
                  <span style={{ fontSize: "11px", color: "var(--up14-fog)" }}>3D 디지털 트윈으로 신체 상태를 직관적으로 확인합니다.</span>
                </div>
                <span className="up14-badge-blush">위/명치 관심</span>
              </div>

              {/* 계통 선택 캡슐 버튼 */}
              <div className="up14-layer-pills" style={{ margin: "10px 0" }}>
                <button
                  type="button"
                  className={`up14-layer-btn ${selectedOrgan === "stomach" ? "active" : ""}`}
                  onClick={() => setSelectedOrgan("stomach")}
                >
                  소화기계 (위·간)
                </button>
                <button
                  type="button"
                  className={`up14-layer-btn ${selectedOrgan === "heart" ? "active" : ""}`}
                  onClick={() => setSelectedOrgan("heart")}
                >
                  심혈관계 (심장)
                </button>
                <button
                  type="button"
                  className={`up14-layer-btn ${selectedOrgan === "kidneys" ? "active" : ""}`}
                  onClick={() => setSelectedOrgan("kidneys")}
                >
                  비뇨기계 (콩팥)
                </button>
              </div>

              {/* 실제 인터랙티브 3D 인체 모델 뷰어 */}
              <div className="up14-body-viewport">
                <div className="up14-body-overlay-tag">
                  <strong>명치 이물감</strong>
                  <span style={{ marginLeft: "4px", color: "var(--up14-fog)" }}>통증 5단계</span>
                </div>

                <Suspense fallback={<div style={{ height: "100%", display: "grid", placeItems: "center", color: "var(--up14-fog)", fontSize: "12px" }}>3D 인체 뷰어를 준비 중입니다…</div>}>
                  <VanatomeBodyMap
                    key={`${activeProfile?.id}-${activeProfile?.gender}`}
                    profileName={activeProfile?.displayName ?? "오성민"}
                    gender={activeProfile?.gender}
                    risks={bodyRisks}
                    highlightOrganKey={selectedOrgan}
                  />
                </Suspense>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "11px" }}>
                <span style={{ color: "var(--up14-fog)" }}>3D 회전 및 줌으로 정밀 관찰 가능</span>
                <button
                  type="button"
                  style={{ padding: "4px 12px", background: "var(--up14-paper-white)", border: "1px solid var(--up14-ash)", borderRadius: "100px", color: "var(--up14-aubergine)", cursor: "pointer", fontSize: "11px" }}
                  onClick={() => void navigate("/pain-diary")}
                >
                  통증 기록 편집
                </button>
              </div>
            </article>

            {/* AI 어시스턴트 봄이 위젯 */}
            <article className="up14-ai-card">
              <div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingBottom: "10px", borderBottom: "1px solid var(--up14-ash)", marginBottom: "12px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <div style={{ width: "28px", height: "28px", borderRadius: "50%", background: "var(--up14-ghost-lavender)", color: "var(--up14-aubergine)", display: "grid", placeItems: "center" }}>
                      <Icon name="ghost" />
                    </div>
                    <div>
                      <strong style={{ fontSize: "12px", color: "var(--up14-aubergine)", display: "block" }}>봄이 · 건강 비서</strong>
                      <span style={{ fontSize: "11px", color: "var(--up14-fog)" }}>맞춤 웰니스 어시스턴트</span>
                    </div>
                  </div>
                  <span className="up14-badge-mint">연동 활성</span>
                </div>

                {/* 대화 히스토리 */}
                <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "12px" }}>
                  {chatLogs.map((log, idx) => (
                    <div key={idx} className={log.sender === "user" ? "up14-chat-bubble-user" : "up14-chat-bubble-ai"}>
                      {log.text}
                    </div>
                  ))}

                  {/* AI 제안 액션 박스 */}
                  <div className="up14-action-box">
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "11px", color: "var(--up14-aubergine)" }}>
                      <strong>통증 다이어리 등록 제안</strong>
                      <span style={{ background: "var(--up14-ghost-lavender)", padding: "2px 6px", borderRadius: "100px", fontSize: "11px" }}>초안 생성</span>
                    </div>

                    <div style={{ background: "var(--up14-bone)", borderRadius: "10px", padding: "8px 10px", fontSize: "11px", display: "flex", flexDirection: "column", gap: "4px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span style={{ color: "var(--up14-fog)" }}>부위:</span>
                        <span style={{ color: "var(--up14-aubergine)", fontWeight: 500 }}>명치 (상복부)</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span style={{ color: "var(--up14-fog)" }}>강도:</span>
                        <span style={{ color: "var(--up14-aubergine)", fontWeight: 500 }}>5 / 10 (중등도)</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span style={{ color: "var(--up14-fog)" }}>양상:</span>
                        <span style={{ color: "var(--up14-obsidian)" }}>이물감, 수면 시 악화</span>
                      </div>
                    </div>

                    <button
                      type="button"
                      className="up14-cta-button"
                      onClick={() => void navigate("/pain-diary")}
                    >
                      <Icon name="check" />
                      <span>통증 다이어리에 바로 기록하기</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* 채팅 입력 */}
              <div style={{ borderTop: "1px solid var(--up14-ash)", paddingTop: "10px" }}>
                <div style={{ display: "flex", gap: "6px", overflowX: "auto", paddingBottom: "6px", fontSize: "11px" }}>
                  <button
                    type="button"
                    style={{ padding: "4px 10px", background: "var(--up14-bone)", border: "1px solid var(--up14-ash)", borderRadius: "100px", color: "var(--up14-fog)", cursor: "pointer", whiteSpace: "nowrap" }}
                    onClick={() => setChatInput("소화제 먹어도 될까?")}
                  >
                    소화제 먹어도 될까?
                  </button>
                  <button
                    type="button"
                    style={{ padding: "4px 10px", background: "var(--up14-bone)", border: "1px solid var(--up14-ash)", borderRadius: "100px", color: "var(--up14-fog)", cursor: "pointer", whiteSpace: "nowrap" }}
                    onClick={() => setChatInput("병원 가야 해?")}
                  >
                    병원 가야 해?
                  </button>
                </div>

                <div className="up14-chat-input-row">
                  <input
                    type="text"
                    className="up14-chat-input"
                    placeholder="봄이에게 증상이나 궁금한 점을 물어보세요..."
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSendMessage();
                    }}
                  />
                  <button type="button" className="up14-chat-send-btn" onClick={handleSendMessage}>
                    <Icon name="send" />
                  </button>
                </div>
              </div>
            </article>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="up14-footer">
        <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "var(--up14-aubergine)" }}>
          <strong style={{ fontWeight: 500 }}>이어봄 (Ieobom)</strong>
          <span>•</span>
          <span style={{ color: "var(--up14-fog)" }}>가족 건강 모니터링 & AI 어시스턴트</span>
        </div>
        <p style={{ margin: 0, fontSize: "11px", color: "var(--up14-fog)" }}>
          본 서비스는 의료 전문가의 직접 진단을 대체하지 않으며 이상 징후 시 전문 의료기관을 방문하시기 바랍니다.
        </p>
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
        <div style={{ padding: "12px", border: "1px solid var(--up14-ash)", borderRadius: "12px", background: "#fff" }}>
          <span style={{ fontSize: "11px", color: "var(--up14-fog)" }}>실제 검사일</span>
          <strong style={{ display: "block", fontSize: "15px", marginTop: "4px", color: "var(--up14-aubergine)" }}>
            {formatDateTime(documentSet.examined_at)}
          </strong>
        </div>
        <div style={{ padding: "12px", border: "1px solid var(--up14-ash)", borderRadius: "12px", background: "#fff" }}>
          <span style={{ fontSize: "11px", color: "var(--up14-fog)" }}>보관 상태</span>
          <strong style={{ display: "block", fontSize: "15px", marginTop: "4px", color: "var(--up14-mint-signal)" }}>
            AES-256 암호화 보관 완료
          </strong>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: "30px", textAlign: "center", color: "var(--up14-fog)" }}>서류를 복호화 중입니다…</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "14px" }}>
          {documentSet.pages.map((page) => {
            const url = pageUrls[page.id];
            return (
              <div key={page.id} style={{ border: "1px solid var(--up14-ash)", borderRadius: "12px", overflow: "hidden", background: "#fff" }}>
                <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--up14-ash)", fontSize: "12px" }}>
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
