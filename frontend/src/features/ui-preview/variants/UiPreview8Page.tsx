/**
 * 시안 8: 전문 건강 데이터 워크스페이스 (/ui-preview8)
 *
 * 서류 원본, OCR 추출값, 일일 바이탈, 판정 결과의 전 과정을
 * 투명하게 가시화하고 출처 연결(Lineage) 및 품질을 검사하는 전문 워크스페이스.
 *
 * 4대 관점 탭:
 * 1. 타임라인: 검진, 바이탈, 투약, 판정 이력 마스터 스트림
 * 2. 지표 탐색기: 혈압/혈당/체중 등 가족 비교 차트 및 [대시보드에 타일 추가] 기능
 * 3. 서류 보관함: 원본 서류 뷰어(좌) ↔ 추출 수치 및 정본 매핑(우) 1:1 대조
 * 4. 데이터 혈통·품질: 원본→OCR→측정값→판정→차트 5단계 연결 상태 감사
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useLocalDomain } from "../../../app/localDomainContext";
import { VariantBar } from "../components/VariantBar";
import { FamilyComparisonChart } from "../../assessment/FamilyComparisonChart";
import { SingleMetricCard } from "../../assessment/SingleMetricCard";
import { useHealthTimeSeries } from "../../data/useHealthTimeSeries";
import { TREND_SERIES } from "../../assessment/snapshots";
import type { HealthRecord, LocalDocument } from "../../../shared/local/domainContracts";
import { recordSummary, recordTypeLabel, recordValues } from "../../../shared/local/recordSummary";
import "../styles/shadcn-preview.css";
import "../styles/shadcn-preview-variants.css";

type WorkspaceTab = "timeline" | "explorer" | "documents" | "lineage";
type PeriodFilter = "1m" | "3m" | "6m" | "1y" | "all";
const SHOW_LEGACY_MOCK = import.meta.env.DEV && new URLSearchParams(window.location.search).has("legacyMock");

export function UiPreview8Page() {
  const { runtime, profiles } = useLocalDomain();

  const [activeTab, setActiveTab] = useState<WorkspaceTab>("explorer");
  const [selectedProfileId, setSelectedProfileId] = useState<string>("");
  const [period, setPeriod] = useState<PeriodFilter>("1y");
  const [selectedMetricKey, setSelectedMetricKey] = useState("sbp");

  // 서류 보관함용 상태
  const [documents, setDocuments] = useState<LocalDocument[]>([]);
  const [selectedDocument, setSelectedDocument] = useState<LocalDocument | null>(null);
  const [records, setRecords] = useState<HealthRecord[]>([]);

  // 알림 토스트 (타일 추가 알림)
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const activeProfile = useMemo(() => {
    return profiles.find((p) => p.id === selectedProfileId) ?? profiles[0];
  }, [profiles, selectedProfileId]);

  const fromDate = useMemo(() => {
    if (period === "all") return undefined;
    const months = period === "1m" ? 1 : period === "3m" ? 3 : period === "6m" ? 6 : 12;
    const date = new Date();
    date.setMonth(date.getMonth() - months);
    return date.toISOString();
  }, [period]);

  useEffect(() => {
    if (activeProfile && !selectedProfileId) {
      setSelectedProfileId(activeProfile.id);
    }
  }, [activeProfile, selectedProfileId]);

  // Phase 2의 통합 시계열 관측 엔진 연동
  const {
    allObservations,
    visibleObservations,
    activeTrendSeries,
    familyComparisonData,
    refresh: refreshTimeSeries,
  } = useHealthTimeSeries({
    runtime,
    profiles,
    activeProfileId: activeProfile?.id,
    fromDate,
  });

  // 서류 목록 및 건강기록 로드
  useEffect(() => {
    if (!runtime || !activeProfile) return;
    let cancelled = false;

    void (async () => {
      try {
        const docsPromise = runtime.documents
          ? runtime.documents.list(activeProfile.id)
          : Promise.resolve({ ok: true as const, value: [] });
        const [docsRes, recsRes] = await Promise.all([
          docsPromise,
          runtime.healthRecords.query({ profileId: activeProfile.id, includeDeleted: false }),
        ]);

        if (!cancelled) {
          if (docsRes.ok) {
            setDocuments(docsRes.value);
            setSelectedDocument((current) =>
              docsRes.value.find((document) => document.id === current?.id) ?? docsRes.value[0] ?? null,
            );
          }
          if (recsRes.ok) {
            setRecords(recsRes.value);
          }
        }
      } catch (err) {
        console.warn("[UiPreview8] Error fetching records/documents:", err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [runtime, activeProfile]);

  // 시안 7 대시보드에 현재 설정된 차트를 타일로 추가하는 액션
  const handleAddTileToDashboard = useCallback(() => {
    try {
      const saved = localStorage.getItem("ieobom:v7-tiles");
      const currentTiles = saved ? JSON.parse(saved) : [];

      const metricSpec = TREND_SERIES.find((s) => s.key === selectedMetricKey) ?? TREND_SERIES[0];
      const newTileId = `singleMetric_${selectedMetricKey}_${Date.now().toString().slice(-4)}`;
      const newTitle = `${activeProfile?.displayName ?? "나"}님의 ${metricSpec.label} 추이`;

      const newTile = {
        id: newTileId,
        type: "singleMetric",
        metricKey: selectedMetricKey,
        profileId: activeProfile?.id,
        period,
        dataSource: "health-record-observations",
        title: newTitle,
        colSpan: 6,
        density: "compact",
        specPreset: "md",
        breakRow: false,
      };

      currentTiles.splice(1, 0, newTile);
      localStorage.setItem("ieobom:v7-tiles", JSON.stringify(currentTiles));

      setToastMessage(`'${newTitle}'이 시안 7 대시보드에 성공적으로 추가되었습니다!`);
      setTimeout(() => setToastMessage(null), 4000);
    } catch {
      setToastMessage("타일 추가 중 오류가 발생했습니다.");
      setTimeout(() => setToastMessage(null), 3000);
    }
  }, [selectedMetricKey, activeProfile, period]);

  const linkedDocumentRecords = useMemo(
    () => records.filter((record) => record.sourceDocumentId === selectedDocument?.id),
    [records, selectedDocument],
  );
  const documentIds = useMemo(() => new Set(documents.map((document) => document.id)), [documents]);
  const danglingDocumentLinks = useMemo(
    () => records.filter((record) => record.sourceDocumentId && !documentIds.has(record.sourceDocumentId)),
    [records, documentIds],
  );
  const verifiedRecords = useMemo(
    () => records.filter((record) => (record.payload as Record<string, unknown>).verified === true),
    [records],
  );

  return (
    <div className="sp-v8-workspace-container" style={{ minHeight: "100vh", backgroundColor: "#f8fafc" }}>
      {/* 43인치 4K 시안 바 */}
      <VariantBar current="v8" />

      {/* 토스트 알림 */}
      {toastMessage && (
        <div
          style={{
            position: "fixed",
            bottom: "24px",
            right: "32px",
            backgroundColor: "#0f172a",
            color: "#ffffff",
            padding: "14px 22px",
            borderRadius: "10px",
            boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.2)",
            display: "flex",
            alignItems: "center",
            gap: "12px",
            zIndex: 9999,
            fontSize: "14px",
            fontWeight: 600,
          }}
        >
          <span>✓ {toastMessage}</span>
          <Link
            to="/ui-preview7"
            style={{
              color: "#60a5fa",
              textDecoration: "underline",
              fontSize: "13px",
              marginLeft: "6px",
            }}
          >
            시안 7 대시보드로 이동 →
          </Link>
        </div>
      )}

      {/* 메인 헤더 */}
      <header
        style={{
          backgroundColor: "#ffffff",
          borderBottom: "1px solid #e2e8f0",
          padding: "20px 32px 14px",
          boxShadow: "0 1px 3px rgba(0, 0, 0, 0.02)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span
                style={{
                  backgroundColor: "#eff6ff",
                  color: "#1d4fb8",
                  padding: "4px 10px",
                  borderRadius: "6px",
                  fontSize: "12px",
                  fontWeight: 700,
                  border: "1px solid #bfdbfe",
                }}
              >
                PRO DATA WORKSPACE
              </span>
              <h1 style={{ fontSize: "22px", fontWeight: 800, color: "#0f172a", margin: 0, letterSpacing: "-0.02em" }}>
                전문 건강 데이터 관리 워크스페이스
              </h1>
            </div>
            <p style={{ fontSize: "13px", color: "#64748b", margin: "6px 0 0" }}>
              병원 서류 원본, OCR 판독문, 정규화된 측정값, 질환 판정 이력 및 대시보드 차트의 연결 혈통(Lineage)을 관리합니다.
            </p>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <Link
              to="/ui-preview7"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "8px 16px",
                backgroundColor: "#f1f5f9",
                color: "#334155",
                borderRadius: "8px",
                fontSize: "13px",
                fontWeight: 600,
                textDecoration: "none",
                border: "1px solid #cbd5e1",
              }}
            >
              ← 시안 7 대시보드로 돌아가기
            </Link>
            <button
              type="button"
              onClick={() => void refreshTimeSeries()}
              style={{
                padding: "8px 14px",
                backgroundColor: "#1d4fb8",
                color: "#ffffff",
                border: "none",
                borderRadius: "8px",
                fontSize: "13px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              실시간 동기화 ↻
            </button>
          </div>
        </div>

        {/* 상단 통합 필터 바 */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "12px",
            marginTop: "18px",
            padding: "10px 14px",
            backgroundColor: "#f8fafc",
            borderRadius: "10px",
            border: "1px solid #e2e8f0",
          }}
        >
          {/* 가족 선택 */}
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ fontSize: "12px", fontWeight: 700, color: "#475569" }}>가족 구성원:</span>
            <select
              value={selectedProfileId}
              onChange={(e) => setSelectedProfileId(e.target.value)}
              style={{
                padding: "5px 10px",
                borderRadius: "6px",
                border: "1px solid #cbd5e1",
                backgroundColor: "#ffffff",
                fontSize: "13px",
                fontWeight: 600,
                color: "#1e293b",
                cursor: "pointer",
              }}
            >
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName} ({p.relationship})
                </option>
              ))}
            </select>
          </div>

          {/* 기간 선택 */}
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ fontSize: "12px", fontWeight: 700, color: "#475569" }}>조회 기간:</span>
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value as PeriodFilter)}
              style={{
                padding: "5px 10px",
                borderRadius: "6px",
                border: "1px solid #cbd5e1",
                backgroundColor: "#ffffff",
                fontSize: "13px",
                color: "#334155",
                cursor: "pointer",
              }}
            >
              <option value="1m">최근 1개월</option>
              <option value="3m">최근 3개월</option>
              <option value="6m">최근 6개월</option>
              <option value="1y">최근 1년</option>
              <option value="all">전체 기록</option>
            </select>
          </div>

          {/* 실측 수치 카운트 배지 */}
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ fontSize: "12px", color: "#64748b" }}>
              조회 기간 관측 데이터: <strong style={{ color: "#1d4fb8" }}>{visibleObservations.length}개</strong>
            </span>
            <span style={{ fontSize: "12px", color: "#64748b" }}>
              보관 서류: <strong style={{ color: "#059669" }}>{documents.length}건</strong>
            </span>
          </div>
        </div>

        {/* 4대 관점 네비게이션 탭 */}
        <div style={{ display: "flex", gap: "8px", marginTop: "14px" }}>
          {[
            { id: "explorer", label: "📊 지표 탐색기 & 차트 빌더 (대시보드 연동)", badge: "핵심" },
            { id: "documents", label: "📑 서류 보관함 & 원본 1:1 대조", badge: `${documents.length}` },
            { id: "timeline", label: "⏱ 건강 타임라인 마스터 피드", badge: `${records.length}` },
            {
              id: "lineage",
              label: "🔗 데이터 혈통 & 품질 검사",
              badge: danglingDocumentLinks.length ? `확인 필요 ${danglingDocumentLinks.length}` : "점검",
            },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id as WorkspaceTab)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
                padding: "10px 18px",
                borderRadius: "8px",
                border: "none",
                backgroundColor: activeTab === tab.id ? "#1d4fb8" : "#f1f5f9",
                color: activeTab === tab.id ? "#ffffff" : "#475569",
                fontSize: "13px",
                fontWeight: 700,
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
            >
              <span>{tab.label}</span>
              {tab.badge && (
                <span
                  style={{
                    fontSize: "11px",
                    padding: "2px 6px",
                    borderRadius: "10px",
                    backgroundColor: activeTab === tab.id ? "rgba(255, 255, 255, 0.2)" : "#e2e8f0",
                    color: activeTab === tab.id ? "#ffffff" : "#64748b",
                  }}
                >
                  {tab.badge}
                </span>
              )}
            </button>
          ))}
        </div>
      </header>

      {/* 본문 콘텐츠 영역 */}
      <main style={{ padding: "28px 32px", boxSizing: "border-box" }}>
        {/* ============================================================
            1. [지표 탐색기 탭] - 원자료 추이, 가족 비교 및 대시보드 타일 추가
            ============================================================ */}
        {activeTab === "explorer" && (
          <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: "24px" }}>
            {/* 좌측: 지표 목록 선택기 */}
            <div
              style={{
                backgroundColor: "#ffffff",
                borderRadius: "14px",
                border: "1px solid #e2e8f0",
                padding: "18px",
                boxShadow: "0 1px 3px rgba(0, 0, 0, 0.03)",
              }}
            >
              <h3 style={{ fontSize: "15px", fontWeight: 700, color: "#1e293b", margin: "0 0 12px" }}>
                10대 표준 건강 지표
              </h3>
              <p style={{ fontSize: "12px", color: "#64748b", margin: "0 0 14px" }}>
                검진표와 측정기기에서 수집된 표준화된 지표를 선택하여 분석합니다.
              </p>

              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {TREND_SERIES.map((spec) => {
                  const isSelected = spec.key === selectedMetricKey;
                  const count = visibleObservations.filter(
                    (o) => o.metricKey === spec.key && o.profileId === activeProfile?.id,
                  ).length;

                  return (
                    <button
                      key={spec.key}
                      type="button"
                      onClick={() => setSelectedMetricKey(spec.key)}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        padding: "10px 14px",
                        borderRadius: "8px",
                        border: `1px solid ${isSelected ? "#1d4fb8" : "#e2e8f0"}`,
                        backgroundColor: isSelected ? "#eff6ff" : "#ffffff",
                        color: isSelected ? "#1d4fb8" : "#334155",
                        fontSize: "13px",
                        fontWeight: isSelected ? 700 : 500,
                        cursor: "pointer",
                        textAlign: "left",
                        transition: "all 0.1s ease",
                      }}
                    >
                      <span>{spec.label}</span>
                      <span style={{ fontSize: "11px", color: isSelected ? "#2563eb" : "#94a3b8" }}>
                        {count > 0 ? `${count}회 측정 (${spec.unit})` : "기록 대기"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 우측: 선택한 지표 상세 비교 차트 & [대시보드 타일 추가] 컨트롤 */}
            <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
              {/* 상단 액션 카드: 대시보드에 타일 추가 */}
              <div
                style={{
                  backgroundColor: "#ffffff",
                  borderRadius: "14px",
                  border: "1px solid #bfdbfe",
                  padding: "16px 22px",
                  background: "linear-gradient(135deg, #ffffff 0%, #eff6ff 100%)",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: "12px",
                }}
              >
                <div>
                  <h4 style={{ fontSize: "15px", fontWeight: 700, color: "#1e3a8a", margin: "0 0 4px" }}>
                    이 지표를 홈 대시보드 타일로 배치하시겠습니까?
                  </h4>
                  <p style={{ fontSize: "12px", color: "#3b82f6", margin: 0 }}>
                    클릭 한 번으로 현재 선택된 지표({TREND_SERIES.find((s) => s.key === selectedMetricKey)?.label})의 실시간 추이 타일을 시안 7 대시보드에 즉시 추가합니다.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleAddTileToDashboard}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "10px 18px",
                    backgroundColor: "#1d4fb8",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: "8px",
                    fontSize: "13px",
                    fontWeight: 700,
                    cursor: "pointer",
                    boxShadow: "0 2px 6px rgba(29, 79, 184, 0.2)",
                  }}
                >
                  <span>⊕ 시안 7 대시보드에 타일 추가</span>
                </button>
              </div>

              {/* 가족 비교 멀티라인 차트 */}
              <div
                style={{
                  backgroundColor: "#ffffff",
                  borderRadius: "14px",
                  border: "1px solid #e2e8f0",
                  padding: "24px",
                  boxShadow: "0 1px 4px rgba(0, 0, 0, 0.03)",
                }}
              >
                <FamilyComparisonChart
                  familyData={familyComparisonData}
                  defaultMetricKey={selectedMetricKey}
                  allowMetricSwitch={false}
                  title={`가족 전체 ${TREND_SERIES.find((s) => s.key === selectedMetricKey)?.label} 시계열 비교 분석`}
                />
              </div>

              {/* 선택된 구성원의 단독 지표 상세 카드 */}
              <div
                style={{
                  backgroundColor: "#ffffff",
                  borderRadius: "14px",
                  border: "1px solid #e2e8f0",
                  padding: "22px",
                  boxShadow: "0 1px 4px rgba(0, 0, 0, 0.03)",
                }}
              >
                <SingleMetricCard
                  seriesList={activeTrendSeries}
                  defaultKey={selectedMetricKey}
                  allowMetricSwitch={false}
                  title={`${activeProfile?.displayName}님의 정밀 시계열 추이`}
                />
              </div>
            </div>
          </div>
        )}

        {/* ============================================================
            2. [서류 보관함 탭] - 원본 서류 뷰어(좌) ↔ 추출값 & 판정 매핑(우)
            ============================================================ */}
        {activeTab === "documents" && (
          <EvidenceDocuments
            documents={documents}
            selectedDocument={selectedDocument}
            onSelectDocument={setSelectedDocument}
            records={linkedDocumentRecords}
            onOpen={async (document) => {
              if (!runtime?.documents) return;
              const result = await runtime.documents.read(document);
              if (!result.ok) {
                setToastMessage(result.error.message);
                return;
              }
              window.open(URL.createObjectURL(result.value), "_blank", "noopener,noreferrer");
            }}
          />
        )}
        {SHOW_LEGACY_MOCK && activeTab === "documents" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
            {/* 좌측: 원본 서류 뷰어 */}
            <div
              style={{
                backgroundColor: "#ffffff",
                borderRadius: "14px",
                border: "1px solid #e2e8f0",
                padding: "20px",
                boxShadow: "0 1px 3px rgba(0, 0, 0, 0.03)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
                <h3 style={{ fontSize: "16px", fontWeight: 700, color: "#0f172a", margin: 0 }}>
                  원본 서류 뷰어 (법적 증빙 원본)
                </h3>
                <span
                  style={{
                    fontSize: "11px",
                    fontWeight: 700,
                    padding: "3px 8px",
                    borderRadius: "4px",
                    backgroundColor: "#fef3c7",
                    color: "#92400e",
                  }}
                >
                  원본 불변 보존
                </span>
              </div>

              {/* 가상 고해상도 검진표 렌더러 시뮬레이션 */}
              <div
                style={{
                  backgroundColor: "#f8fafc",
                  borderRadius: "8px",
                  border: "1px dashed #cbd5e1",
                  padding: "24px",
                  minHeight: "440px",
                  boxSizing: "border-box",
                }}
              >
                <div
                  style={{
                    backgroundColor: "#ffffff",
                    border: "1px solid #e2e8f0",
                    padding: "24px",
                    borderRadius: "6px",
                    boxShadow: "0 4px 12px rgba(0, 0, 0, 0.04)",
                  }}
                >
                  <div style={{ borderBottom: "2px solid #0f172a", paddingBottom: "12px", marginBottom: "16px" }}>
                    <span style={{ fontSize: "11px", color: "#64748b" }}>국민건강보험공단 지정 검진기관</span>
                    <h2 style={{ fontSize: "18px", fontWeight: 800, margin: "4px 0 0", color: "#0f172a" }}>
                      일반건강검진 종합결과표
                    </h2>
                  </div>

                  <table style={{ width: "100%", fontSize: "12px", borderCollapse: "collapse", marginBottom: "16px" }}>
                    <tbody>
                      <tr style={{ borderBottom: "1px solid #f1f5f9" }}>
                        <td style={{ padding: "6px 8px", fontWeight: 700, color: "#475569", width: "90px" }}>수검자명</td>
                        <td style={{ padding: "6px 8px" }}>{activeProfile?.displayName}</td>
                        <td style={{ padding: "6px 8px", fontWeight: 700, color: "#475569", width: "90px" }}>검진일자</td>
                        <td style={{ padding: "6px 8px" }}>2026.09.10</td>
                      </tr>
                      <tr style={{ borderBottom: "1px solid #f1f5f9" }}>
                        <td style={{ padding: "6px 8px", fontWeight: 700, color: "#475569" }}>검진기관</td>
                        <td style={{ padding: "6px 8px" }}>서울대학교병원 강남센터</td>
                        <td style={{ padding: "6px 8px", fontWeight: 700, color: "#475569" }}>검진번호</td>
                        <td style={{ padding: "6px 8px" }}>2026-GH-99120</td>
                      </tr>
                    </tbody>
                  </table>

                  <div style={{ fontSize: "11px", fontWeight: 700, color: "#0f172a", marginBottom: "8px" }}>
                    [계측 및 혈액검사 결과]
                  </div>
                  <table style={{ width: "100%", fontSize: "11px", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ backgroundColor: "#f8fafc", borderBottom: "1px solid #cbd5e1" }}>
                        <th style={{ padding: "6px 8px", textAlign: "left" }}>검사항목</th>
                        <th style={{ padding: "6px 8px", textAlign: "right" }}>측정값</th>
                        <th style={{ padding: "6px 8px", textAlign: "left" }}>단위</th>
                        <th style={{ padding: "6px 8px", textAlign: "left" }}>참고치</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr style={{ borderBottom: "1px solid #f1f5f9" }}>
                        <td style={{ padding: "5px 8px" }}>수축기 혈압</td>
                        <td style={{ padding: "5px 8px", textAlign: "right", fontWeight: 700 }}>128</td>
                        <td style={{ padding: "5px 8px" }}>mmHg</td>
                        <td style={{ padding: "5px 8px", color: "#64748b" }}>120 미만</td>
                      </tr>
                      <tr style={{ borderBottom: "1px solid #f1f5f9" }}>
                        <td style={{ padding: "5px 8px" }}>이완기 혈압</td>
                        <td style={{ padding: "5px 8px", textAlign: "right", fontWeight: 700 }}>82</td>
                        <td style={{ padding: "5px 8px" }}>mmHg</td>
                        <td style={{ padding: "5px 8px", color: "#64748b" }}>80 미만</td>
                      </tr>
                      <tr style={{ borderBottom: "1px solid #f1f5f9" }}>
                        <td style={{ padding: "5px 8px" }}>공복혈당</td>
                        <td style={{ padding: "5px 8px", textAlign: "right", fontWeight: 700 }}>98</td>
                        <td style={{ padding: "5px 8px" }}>mg/dL</td>
                        <td style={{ padding: "5px 8px", color: "#64748b" }}>100 미만</td>
                      </tr>
                      <tr style={{ borderBottom: "1px solid #f1f5f9" }}>
                        <td style={{ padding: "5px 8px" }}>체중</td>
                        <td style={{ padding: "5px 8px", textAlign: "right", fontWeight: 700 }}>84.0</td>
                        <td style={{ padding: "5px 8px" }}>kg</td>
                        <td style={{ padding: "5px 8px", color: "#64748b" }}>-</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* 우측: 추출된 지표 & 연결된 건강기록/판정 결과 */}
            <div
              style={{
                backgroundColor: "#ffffff",
                borderRadius: "14px",
                border: "1px solid #e2e8f0",
                padding: "20px",
                boxShadow: "0 1px 3px rgba(0, 0, 0, 0.03)",
              }}
            >
              <h3 style={{ fontSize: "16px", fontWeight: 700, color: "#0f172a", margin: "0 0 14px" }}>
                추출된 지표 & 출처 검증 (Audit Trail)
              </h3>

              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                {[
                  { key: "sbp", label: "수축기 혈압", ocrVal: "128", finalVal: 128, unit: "mmHg", status: "검증완료" },
                  { key: "dbp", label: "이완기 혈압", ocrVal: "82", finalVal: 82, unit: "mmHg", status: "검증완료" },
                  { key: "fasting_glucose", label: "공복혈당", ocrVal: "98", finalVal: 98, unit: "mg/dL", status: "검증완료" },
                  { key: "weight_kg", label: "체중", ocrVal: "84.0", finalVal: 84.0, unit: "kg", status: "검증완료" },
                ].map((row) => (
                  <div
                    key={row.key}
                    style={{
                      padding: "12px 16px",
                      borderRadius: "8px",
                      border: "1px solid #e2e8f0",
                      backgroundColor: "#f8fafc",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <div>
                      <div style={{ fontSize: "13px", fontWeight: 700, color: "#1e293b" }}>{row.label}</div>
                      <div style={{ fontSize: "11px", color: "#64748b" }}>
                        OCR 원문: &quot;{row.ocrVal}&quot; ➔ 정규화: {row.finalVal} {row.unit}
                      </div>
                    </div>
                    <span
                      style={{
                        fontSize: "11px",
                        fontWeight: 700,
                        padding: "3px 8px",
                        borderRadius: "4px",
                        backgroundColor: "#ecfdf5",
                        color: "#059669",
                        border: "1px solid #a7f3d0",
                      }}
                    >
                      ✓ {row.status}
                    </span>
                  </div>
                ))}
              </div>

              <div
                style={{
                  marginTop: "20px",
                  padding: "16px",
                  backgroundColor: "#eff6ff",
                  borderRadius: "10px",
                  border: "1px solid #bfdbfe",
                }}
              >
                <div style={{ fontSize: "13px", fontWeight: 700, color: "#1e40af", marginBottom: "6px" }}>
                  연결된 AI 질환 예측 판정 (E1 규칙 엔진)
                </div>
                <p style={{ fontSize: "12px", color: "#3b82f6", margin: 0 }}>
                  본 검진 서류에서 추출된 혈압(128/82)과 혈당(98)을 근거로 당시 <strong>고혈압 주의(CAUTION)</strong> 및 <strong>당뇨병 정상(NORMAL)</strong>으로 판정되었습니다.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ============================================================
            3. [타임라인 탭] - 온 가족 건강기록 통합 마스터 피드
            ============================================================ */}
        {activeTab === "timeline" && (
          <div
            style={{
              backgroundColor: "#ffffff",
              borderRadius: "14px",
              border: "1px solid #e2e8f0",
              padding: "24px",
              boxShadow: "0 1px 3px rgba(0, 0, 0, 0.03)",
            }}
          >
            <h3 style={{ fontSize: "16px", fontWeight: 700, color: "#0f172a", margin: "0 0 16px" }}>
              {activeProfile?.displayName}님의 건강 이벤트 타임라인
            </h3>

            <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              {records.length === 0 ? (
                <p style={{ color: "#64748b", fontSize: "13px" }}>등록된 건강기록이 없습니다.</p>
              ) : (
                records.slice(0, 10).map((rec) => (
                  <div
                    key={rec.id}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: "16px",
                      padding: "14px 18px",
                      borderRadius: "10px",
                      border: "1px solid #e2e8f0",
                      backgroundColor: "#f8fafc",
                    }}
                  >
                    <div
                      style={{
                        padding: "6px 10px",
                        borderRadius: "6px",
                        backgroundColor: "#1d4fb8",
                        color: "#ffffff",
                        fontSize: "12px",
                        fontWeight: 700,
                        whiteSpace: "nowrap",
                      }}
                    >
                        {recordTypeLabel(rec.recordType)}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                        <span style={{ fontSize: "13px", fontWeight: 700, color: "#1e293b" }}>
                          기록 ID: {rec.id.slice(0, 12)}...
                        </span>
                        <span style={{ fontSize: "12px", color: "#64748b" }}>
                          {rec.recordedAt.slice(0, 10)}
                        </span>
                      </div>
                      <div style={{ fontSize: "12px", color: "#475569" }}>
                        {recordSummary(rec)}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* ============================================================
            4. [데이터 혈통 & 품질 검사 탭] - 5단계 연결 상태 감사
            ============================================================ */}
        {activeTab === "lineage" && (
          <EvidenceLineage
            records={records}
            documentCount={documents.length}
            verifiedCount={verifiedRecords.length}
            danglingCount={danglingDocumentLinks.length}
            observationCount={allObservations.length}
          />
        )}
        {SHOW_LEGACY_MOCK && activeTab === "lineage" && (
          <div
            style={{
              backgroundColor: "#ffffff",
              borderRadius: "14px",
              border: "1px solid #e2e8f0",
              padding: "24px",
              boxShadow: "0 1px 3px rgba(0, 0, 0, 0.03)",
            }}
          >
            <h3 style={{ fontSize: "16px", fontWeight: 700, color: "#0f172a", margin: "0 0 16px" }}>
              의료 데이터 5단계 혈통(Lineage) 및 무결성 감사
            </h3>

            {/* 5단계 파이프라인 카드 */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "12px", marginBottom: "24px" }}>
              {[
                { step: "1", title: "원본 서류", desc: "검진표 PDF/스캔 보존", status: "100% 보존됨" },
                { step: "2", title: "OCR 텍스트", desc: "원문 판독 분리 보존", status: "검증 완료" },
                { step: "3", title: "표준 측정값", desc: "Observation 계층 정규화", status: "단위 통일" },
                { step: "4", title: "질환 판정", desc: "E1/ML 엔진 버전 연결", status: "추적 가능" },
                { step: "5", title: "대시보드 차트", desc: "시안 7 타일 실시간 주입", status: "동기화 완료" },
              ].map((item) => (
                <div
                  key={item.step}
                  style={{
                    padding: "14px",
                    borderRadius: "8px",
                    border: "1px solid #cbd5e1",
                    backgroundColor: "#f8fafc",
                    textAlign: "center",
                  }}
                >
                  <span
                    style={{
                      display: "inline-block",
                      width: "22px",
                      height: "22px",
                      borderRadius: "50%",
                      backgroundColor: "#1d4fb8",
                      color: "#ffffff",
                      fontSize: "12px",
                      fontWeight: 700,
                      lineHeight: "22px",
                      marginBottom: "6px",
                    }}
                  >
                    {item.step}
                  </span>
                  <div style={{ fontSize: "13px", fontWeight: 700, color: "#1e293b", marginBottom: "2px" }}>
                    {item.title}
                  </div>
                  <div style={{ fontSize: "11px", color: "#64748b", marginBottom: "6px" }}>{item.desc}</div>
                  <span style={{ fontSize: "11px", fontWeight: 700, color: "#059669", backgroundColor: "#ecfdf5", padding: "2px 6px", borderRadius: "4px" }}>
                    ✓ {item.status}
                  </span>
                </div>
              ))}
            </div>

            <div style={{ padding: "16px", borderRadius: "10px", backgroundColor: "#ecfdf5", border: "1px solid #a7f3d0" }}>
              <div style={{ fontSize: "13px", fontWeight: 700, color: "#065f46", marginBottom: "4px" }}>
                데이터 품질 점검 결과: 정상 (오류 0건)
              </div>
              <p style={{ fontSize: "12px", color: "#047857", margin: 0 }}>
                단위 불일치(lb/kg 혼용 등), 비정상 극단값, 출처가 불분명한 고아 데이터(Orphan data)가 감지되지 않았습니다.
              </p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function EvidenceDocuments({
  documents,
  selectedDocument,
  onSelectDocument,
  records,
  onOpen,
}: {
  documents: LocalDocument[];
  selectedDocument: LocalDocument | null;
  onSelectDocument: (document: LocalDocument) => void;
  records: HealthRecord[];
  onOpen: (document: LocalDocument) => Promise<void>;
}) {
  return (
    <section className="sp-v8-evidence-grid" aria-label="원본 서류와 연결 기록">
      <aside className="sp-v8-panel">
        <div className="sp-v8-panel-heading">
          <div><span className="sp-v8-eyebrow">LOCAL VAULT</span><h2>원본 서류</h2></div>
          <span className="sp-v8-count">{documents.length}건</span>
        </div>
        {documents.length === 0 ? (
          <div className="sp-v8-empty">
            <strong>이 구성원의 보관 서류가 없습니다.</strong>
            <span>가상의 검진표를 표시하지 않습니다. 서류를 올리면 암호화된 원본과 연결 기록을 여기서 대조합니다.</span>
          </div>
        ) : (
          <div className="sp-v8-document-list">
            {documents.map((document) => (
              <button key={document.id} type="button" className={document.id === selectedDocument?.id ? "is-active" : ""} onClick={() => onSelectDocument(document)}>
                <strong>{document.fileName}</strong>
                <span>{new Date(document.createdAt).toLocaleString("ko-KR")} · {(document.byteSize / 1024).toFixed(1)} KB</span>
              </button>
            ))}
          </div>
        )}
      </aside>
      <article className="sp-v8-panel sp-v8-document-detail">
        {!selectedDocument ? (
          <div className="sp-v8-empty"><strong>대조할 원본을 선택하세요.</strong><span>원본이 없으면 OCR·검증 완료 상태도 주장하지 않습니다.</span></div>
        ) : (
          <>
            <div className="sp-v8-panel-heading">
              <div><span className="sp-v8-eyebrow">SOURCE DOCUMENT</span><h2>{selectedDocument.fileName}</h2></div>
              <button type="button" className="sp-v8-primary-button" onClick={() => void onOpen(selectedDocument)}>원본 열기</button>
            </div>
            <dl className="sp-v8-metadata">
              <div><dt>형식</dt><dd>{selectedDocument.mimeType}</dd></div>
              <div><dt>크기</dt><dd>{selectedDocument.byteSize.toLocaleString()} bytes</dd></div>
              <div><dt>암호화 조각</dt><dd>{selectedDocument.chunkCount}개</dd></div>
              <div><dt>문서 ID</dt><dd>{selectedDocument.id}</dd></div>
            </dl>
            <h3 className="sp-v8-section-title">이 원본을 명시적으로 참조하는 기록</h3>
            {records.length === 0 ? <div className="sp-v8-warning">연결된 건강기록이 없습니다. 원본만 보관된 상태입니다.</div> : records.map((record) => (
              <div className="sp-v8-linked-record" key={record.id}>
                <div><strong>{recordTypeLabel(record.recordType)}</strong><span>{recordSummary(record)}</span></div>
                <time>{new Date(record.recordedAt).toLocaleString("ko-KR")}</time>
                <div className="sp-v8-values">{recordValues(record).map((value) => <span key={value.field}>{value.label} {value.value}{value.unit}</span>)}</div>
              </div>
            ))}
          </>
        )}
      </article>
    </section>
  );
}

function EvidenceLineage({ records, documentCount, verifiedCount, danglingCount, observationCount }: {
  records: HealthRecord[];
  documentCount: number;
  verifiedCount: number;
  danglingCount: number;
  observationCount: number;
}) {
  const assessmentCount = records.filter((record) => record.recordType === "assessment").length;
  const tiles = (() => {
    try { return JSON.parse(localStorage.getItem("ieobom:v7-tiles") ?? "[]") as unknown[]; } catch { return []; }
  })();
  const stages = [
    ["원본", `${documentCount}건`, documentCount ? "present" : "empty"],
    ["건강기록", `${records.length}건`, records.length ? "present" : "empty"],
    ["표준 관측값", `${observationCount}개`, observationCount ? "derived" : "empty"],
    ["판정 스냅샷", `${assessmentCount}건`, assessmentCount ? "present" : "empty"],
    ["대시보드 설정", `${tiles.length}개`, tiles.length ? "local" : "empty"],
  ];
  return (
    <section className="sp-v8-panel">
      <div className="sp-v8-panel-heading"><div><span className="sp-v8-eyebrow">EVIDENCE, NOT ASSUMPTIONS</span><h2>데이터 혈통과 품질 현황</h2></div></div>
      <p className="sp-v8-note">이 화면은 저장된 감사 로그가 아니라 현재 로컬 정본에서 파생한 연결 현황입니다. 원본 보존·OCR 검증·대시보드 소비를 확인하지 못하면 완료로 표시하지 않습니다.</p>
      <div className="sp-v8-lineage-grid">{stages.map(([title, count, status], index) => <div className="sp-v8-stage" key={title}><span>{index + 1}</span><strong>{title}</strong><b>{count}</b><small>{status}</small></div>)}</div>
      <div className="sp-v8-audit-summary">
        <div><span>명시적 검증 표시 기록</span><strong>{verifiedCount}/{records.length}</strong></div>
        <div><span>원본 참조 끊김</span><strong className={danglingCount ? "is-danger" : ""}>{danglingCount}건</strong></div>
        <div><span>검증 상태 미확인</span><strong>{Math.max(records.length - verifiedCount, 0)}건</strong></div>
      </div>
      {danglingCount > 0 ? <div className="sp-v8-warning">현재 기기에서 찾을 수 없는 원본 문서 참조가 {danglingCount}건 있습니다.</div> : <div className="sp-v8-info">원본 참조 끊김은 발견되지 않았습니다. 이는 OCR 정확도나 의학적 타당성 검증 완료를 뜻하지 않습니다.</div>}
    </section>
  );
}
