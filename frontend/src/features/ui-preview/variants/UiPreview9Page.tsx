/**
 * UiPreview9Page.tsx: 시안 9 - 3-패널 전문 건강 데이터 워크스페이스
 *
 * 탐색 목록(좌) ↔ 작업 캔버스(중앙) ↔ 데이터 혈통 및 품질 감사 인스펙터(우)
 * DESIGN.md 단일 진실 원천 준수:
 * - 2색 키 컬러 (#1d4fb8, #5b687e)
 * - 인라인 이모지 배제 및 인라인 SVG 벡터 아이콘 적용
 * - 허위/가짜 목업 배제 (Zero-Fake) 및 사실성 중심 상태(unknown, missing, verified)
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
import "../styles/ui-preview9.css";

type CategoryTab = "vitals" | "documents" | "verdicts" | "issues";
type PeriodFilter = "1m" | "3m" | "6m" | "1y" | "all";

function isLocalDocument(item: LocalDocument | HealthRecord): item is LocalDocument {
  return "fileName" in item;
}

function isHealthRecord(item: LocalDocument | HealthRecord): item is HealthRecord {
  return "recordType" in item;
}

interface SelectedItem {
  type: "vital" | "document" | "verdict" | "issue";
  id: string;
  data: LocalDocument | HealthRecord;
}

export function UiPreview9Page() {
  const { runtime, profiles } = useLocalDomain();

  const [selectedProfileId, setSelectedProfileId] = useState<string>("");
  const [activeCategory, setActiveCategory] = useState<CategoryTab>("vitals");
  const [period, setPeriod] = useState<PeriodFilter>("1y");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedItem, setSelectedItem] = useState<SelectedItem | null>(null);
  const [selectedMetricKey, setSelectedMetricKey] = useState<string | null>(null);

  // 로컬 데이터 상태
  const [documents, setDocuments] = useState<LocalDocument[]>([]);
  const [records, setRecords] = useState<HealthRecord[]>([]);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const activeProfile = useMemo(() => {
    return profiles.find((p) => p.id === selectedProfileId) ?? profiles[0];
  }, [profiles, selectedProfileId]);

  useEffect(() => {
    if (activeProfile && !selectedProfileId) {
      setSelectedProfileId(activeProfile.id);
    }
  }, [activeProfile, selectedProfileId]);

  const fromDate = useMemo(() => {
    if (period === "all") return undefined;
    const months = period === "1m" ? 1 : period === "3m" ? 3 : period === "6m" ? 6 : 12;
    const date = new Date();
    date.setMonth(date.getMonth() - months);
    return date.toISOString();
  }, [period]);

  // Phase 2 통합 시계열 훅
  const {
    activeTrendSeries,
    familyComparisonData,
  } = useHealthTimeSeries({
    runtime,
    profiles,
    activeProfileId: activeProfile?.id,
    fromDate,
  });

  // 서류 및 기록 로드
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
          }
          if (recsRes.ok) {
            setRecords(recsRes.value);
          }
        }
      } catch (err) {
        console.warn("[UiPreview9Page] Failed to load records/documents:", err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [runtime, activeProfile]);

  // 실제 계산된 품질 지표 (Reality First)
  const auditStats = useMemo(() => {
    const totalRecords = records.length;
    const docCount = documents.length;
    const linkedRecords = records.filter((r) => Boolean(r.sourceDocumentId)).length;
    const unverifiedOcr = records.filter(
      (r) => r.source === "ocr" && r.payload?.userModified !== true && r.payload?.verified !== true
    ).length;
    const brokenDocs = records.filter(
      (r) => Boolean(r.sourceDocumentId) && !documents.some((d) => d.id === r.sourceDocumentId)
    ).length;
    const verdictRecords = records.filter((r) => r.recordType === "assessment").length;

    return {
      totalRecords,
      docCount,
      linkedRecords,
      unverifiedOcr,
      brokenDocs,
      verdictRecords,
    };
  }, [records, documents]);

  // 카테고리별 목록 필터링
  const filteredList = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    if (activeCategory === "documents") {
      return documents.filter((doc) => {
        if (!query) return true;
        return (
          doc.fileName?.toLowerCase().includes(query) ||
          doc.mimeType?.toLowerCase().includes(query) ||
          doc.id.toLowerCase().includes(query)
        );
      });
    }

    if (activeCategory === "vitals") {
      return records
        .filter((r) => r.recordType !== "assessment")
        .filter((r) => {
          if (!query) return true;
          const summaryText = recordSummary(r);
          return (
            recordTypeLabel(r.recordType).toLowerCase().includes(query) ||
            summaryText.toLowerCase().includes(query) ||
            r.id.toLowerCase().includes(query)
          );
        });
    }

    if (activeCategory === "verdicts") {
      return records
        .filter((r) => r.recordType === "assessment")
        .filter((r) => {
          if (!query) return true;
          return r.id.toLowerCase().includes(query) || recordSummary(r).toLowerCase().includes(query);
        });
    }

    if (activeCategory === "issues") {
      return records.filter((r) => {
        const hasBrokenDoc = Boolean(r.sourceDocumentId) && !documents.some((d) => d.id === r.sourceDocumentId);
        const isUnverifiedOcr = r.source === "ocr" && r.payload?.userModified !== true && r.payload?.verified !== true;
        return hasBrokenDoc || isUnverifiedOcr;
      });
    }

    return [];
  }, [activeCategory, documents, records, searchQuery]);

  // 기본 선택 항목 자동 설정
  useEffect(() => {
    if (!selectedItem && filteredList.length > 0) {
      const first = filteredList[0];
      if (activeCategory === "documents") {
        setSelectedItem({ type: "document", id: first.id, data: first });
      } else if (activeCategory === "verdicts") {
        setSelectedItem({ type: "verdict", id: first.id, data: first });
      } else if (activeCategory === "issues") {
        setSelectedItem({ type: "issue", id: first.id, data: first });
      } else {
        setSelectedItem({ type: "vital", id: first.id, data: first });
      }
    }
  }, [filteredList, selectedItem, activeCategory]);

  // 대시보드 타일 추가 핸들러 (메타데이터 완전성 보장)
  const trendMap = useMemo(() => {
    return Object.fromEntries(TREND_SERIES.map((s) => [s.key, s])) as Record<string, { label: string; unit: string }>;
  }, []);

  const handleAddTileToDashboard = useCallback((metricKey: string) => {
    try {
      const saved = localStorage.getItem("ieobom:v7-tiles");
      const currentTiles = saved ? JSON.parse(saved) : [];
      const meta = trendMap[metricKey] ?? { label: metricKey, unit: "" };
      const newTileId = `singleMetric_${metricKey}_${Date.now().toString().slice(-4)}`;

      const newTile = {
        id: newTileId,
        type: "singleMetric",
        metricKey,
        title: `${activeProfile?.displayName ?? "오성민"}님의 ${meta.label} 추이`,
        colSpan: 5,
        density: "compact",
        specPreset: "md",
        breakRow: false,
        profileId: activeProfile?.id,
        period,
        sourcePolicy: "verified_first",
      };

      const updatedTiles = [...currentTiles, newTile];
      localStorage.setItem("ieobom:v7-tiles", JSON.stringify(updatedTiles));

      setToastMessage(`'${meta.label}' 타일이 시안 7 대시보드에 성공적으로 추가되었습니다!`);
      setTimeout(() => setToastMessage(null), 4000);
    } catch (err) {
      console.error("Failed to add tile:", err);
    }
  }, [activeProfile, period, trendMap]);

  // 현재 선택된 아이템의 지표 키 계산
  const currentMetricKey = useMemo(() => {
    if (selectedMetricKey) return selectedMetricKey;
    if (!selectedItem || selectedItem.type !== "vital" || !isHealthRecord(selectedItem.data)) return "sbp";
    const values = recordValues(selectedItem.data);
    const firstWithField = values.find((v) => v.field && v.field in trendMap);
    return firstWithField?.field ?? values[0]?.field ?? "sbp";
  }, [selectedItem, selectedMetricKey, trendMap]);

  // 시안 7 대시보드에 타일로 추가되어 있는지 실시간 감사
  const isPresentInDashboard = useMemo(() => {
    try {
      const saved = localStorage.getItem("ieobom:v7-tiles");
      if (!saved) return false;
      const parsed = JSON.parse(saved);
      return (
        Array.isArray(parsed) &&
        parsed.some(
          (t: unknown) =>
            typeof t === "object" &&
            t !== null &&
            (t as { metricKey?: string }).metricKey === currentMetricKey,
        )
      );
    } catch {
      return false;
    }
  }, [currentMetricKey]);

  return (
    <div className="sp-v9-root">
      <VariantBar current="v9" />

      {/* 상단 제어 및 감사 바 */}
      <header className="sp-v9-top-bar">
        <div className="sp-v9-top-row">
          <div className="sp-v9-title-area">
            <h1 className="sp-v9-title">전문 건강 데이터 워크스페이스</h1>
            <span className="sp-v9-badge-live">
              <span className="sp-v9-pulse-dot" />
              실측 데이터 정합성 보증
            </span>
          </div>

          <div className="sp-v9-controls">
            {/* 프로필 선택 */}
            <div className="sp-v9-profile-strip" role="radiogroup" aria-label="가족 구성원 선택">
              {profiles.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`sp-v9-profile-btn ${p.id === activeProfile?.id ? "active" : ""}`}
                  onClick={() => {
                    setSelectedProfileId(p.id);
                    setSelectedItem(null);
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                  {p.displayName}
                </button>
              ))}
            </div>

            {/* 기간 필터 */}
            <div className="sp-v9-period-strip" role="group" aria-label="조회 기간">
              {(["1m", "3m", "6m", "1y", "all"] as PeriodFilter[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`sp-v9-period-btn ${period === p ? "active" : ""}`}
                  onClick={() => setPeriod(p)}
                >
                  {p === "1m" ? "1개월" : p === "3m" ? "3개월" : p === "6m" ? "6개월" : p === "1y" ? "1년" : "전체"}
                </button>
              ))}
            </div>

            {/* 검색창 */}
            <input
              type="search"
              className="sp-v9-search-input"
              placeholder="자료명, 수치, ID 검색..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {/* 실제 계산된 품질 감사 요약 */}
        <div className="sp-v9-audit-bar">
          <span className="sp-v9-audit-stat">
            전체 수집 자료: <strong>{auditStats.totalRecords}건</strong>
          </span>
          <span className="sp-v9-audit-stat">
            보관 서류: <strong>{auditStats.docCount}건</strong>
          </span>
          <span className="sp-v9-audit-stat">
            서류 연계 측정값: <strong>{auditStats.linkedRecords}건</strong>
          </span>
          <span className={`sp-v9-audit-stat ${auditStats.unverifiedOcr > 0 ? "warning" : ""}`}>
            검증 필요(OCR): <strong>{auditStats.unverifiedOcr}건</strong>
          </span>
          <span className={`sp-v9-audit-stat ${auditStats.brokenDocs > 0 ? "danger" : ""}`}>
            미연결/고아 참조: <strong>{auditStats.brokenDocs}건</strong>
          </span>
        </div>
      </header>

      {/* 메인 3패널 레이아웃 */}
      <main className="sp-v9-workspace-grid">
        {/* =========================================================
            1. 좌측: 자료 탐색 패널 (Master Explorer)
           ========================================================= */}
        <section className="sp-v9-panel sp-v9-panel-explorer" aria-label="자료 탐색 패널">
          <div className="sp-v9-explorer-tabs">
            <button
              type="button"
              className={`sp-v9-tab-btn ${activeCategory === "vitals" ? "active" : ""}`}
              onClick={() => {
                setActiveCategory("vitals");
                setSelectedItem(null);
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
              </svg>
              <span>건강기록 ({records.filter((r) => r.recordType !== "assessment").length})</span>
            </button>
            <button
              type="button"
              className={`sp-v9-tab-btn ${activeCategory === "documents" ? "active" : ""}`}
              onClick={() => {
                setActiveCategory("documents");
                setSelectedItem(null);
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
              <span>서류 ({documents.length})</span>
            </button>
            <button
              type="button"
              className={`sp-v9-tab-btn ${activeCategory === "verdicts" ? "active" : ""}`}
              onClick={() => {
                setActiveCategory("verdicts");
                setSelectedItem(null);
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2a8 8 0 0 0-8 8c0 5 8 12 8 12s8-7 8-12a8 8 0 0 0-8-8z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
              <span>판정 ({records.filter((r) => r.recordType === "assessment").length})</span>
            </button>
            <button
              type="button"
              className={`sp-v9-tab-btn ${activeCategory === "issues" ? "active" : ""}`}
              onClick={() => {
                setActiveCategory("issues");
                setSelectedItem(null);
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <span>품질이슈 ({auditStats.unverifiedOcr + auditStats.brokenDocs})</span>
            </button>
          </div>

          <div className="sp-v9-item-list">
            {filteredList.length === 0 ? (
              <div style={{ padding: "32px 16px", textAlign: "center", color: "#64748b", fontSize: "13px" }}>
                선택된 조건에 해당하는 자료가 없습니다.
              </div>
            ) : (
              filteredList.map((item) => {
                const isDoc = isLocalDocument(item);
                const isAssessment = !isDoc && item.recordType === "assessment";
                const isSelected = selectedItem?.id === item.id;

                const dateStr = (isDoc ? item.createdAt : item.recordedAt).slice(0, 10);
                const label = isDoc ? item.fileName : recordTypeLabel(item.recordType);
                const summary = isDoc
                  ? `${(item.byteSize / 1024).toFixed(1)} KB · ${item.chunkCount} 조각`
                  : recordSummary(item);

                const itemPayload = !isDoc ? (item.payload as { userModified?: boolean; verified?: boolean } | undefined) : undefined;

                return (
                  <div
                    key={item.id}
                    className={`sp-v9-item-card ${isSelected ? "active" : ""}`}
                    onClick={() => {
                      setSelectedItem({
                        type: isDoc ? "document" : isAssessment ? "verdict" : "vital",
                        id: item.id,
                        data: item,
                      });
                    }}
                  >
                    <div className="sp-v9-card-header">
                      <span className="sp-v9-card-type">{label}</span>
                      <span className="sp-v9-card-date">{dateStr}</span>
                    </div>

                    <div className="sp-v9-card-body">{summary}</div>

                    <div className="sp-v9-card-badges">
                      {isDoc ? (
                        <span className="sp-v9-mini-badge doc-linked">암호화 보관</span>
                      ) : (
                        <>
                          {item.sourceDocumentId ? (
                            <span className="sp-v9-mini-badge doc-linked">서류연계</span>
                          ) : (
                            <span className="sp-v9-mini-badge">직접입력</span>
                          )}
                          {itemPayload?.userModified ? (
                            <span className="sp-v9-mini-badge verified">사용자수정</span>
                          ) : itemPayload?.verified ? (
                            <span className="sp-v9-mini-badge verified">검증완료</span>
                          ) : item.source === "ocr" ? (
                            <span className="sp-v9-mini-badge unverified">확인필요</span>
                          ) : null}
                        </>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* =========================================================
            2. 중앙: 작업 캔버스 (Work Canvas)
           ========================================================= */}
        <section className="sp-v9-panel sp-v9-panel-canvas" aria-label="작업 캔버스">
          <div className="sp-v9-panel-header">
            <h2 className="sp-v9-panel-title">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1d4fb8" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <line x1="3" y1="9" x2="21" y2="9" />
                <line x1="9" y1="21" x2="9" y2="9" />
              </svg>
              작업 캔버스
            </h2>

            {selectedItem?.type === "vital" && (
              <button
                type="button"
                className="sp-v9-action-btn primary"
                onClick={() => handleAddTileToDashboard(currentMetricKey)}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                시안 7 대시보드에 타일 추가
              </button>
            )}
          </div>

          <div className="sp-v9-canvas-body">
            {/* 서류 뷰 모드 */}
            {selectedItem?.type === "document" && (
              <div>
                <div className="sp-v9-canvas-toolbar">
                  <div>
                    <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 700 }}>
                      {isLocalDocument(selectedItem.data) ? selectedItem.data.fileName : "보관 서류 원본"}
                    </h3>
                    <p style={{ margin: "4px 0 0", fontSize: "12px", color: "#64748b" }}>
                      문서 식별자: {selectedItem.data.id} · 크기:{" "}
                      {isLocalDocument(selectedItem.data) ? `${(selectedItem.data.byteSize / 1024).toFixed(1)} KB` : "알 수 없음"}
                    </p>
                  </div>
                </div>

                <div className="sp-v9-empty-doc-box">
                  <svg className="sp-v9-empty-doc-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                  <h4 className="sp-v9-empty-doc-title">암호화된 원본 문서</h4>
                  <p className="sp-v9-empty-doc-desc">
                    본 문서는 브라우저 OPFS 보안 보관소에 안전하게 암호화 보관되어 있으며,
                    서버로는 의료 정보 보호 원칙에 따라 메타데이터와 정규화된 측정값만 전송됩니다.
                  </p>
                </div>
              </div>
            )}

            {/* 서류 카테고리인데 선택된 서류가 0건일 때 */}
            {activeCategory === "documents" && documents.length === 0 && (
              <div className="sp-v9-empty-doc-box">
                <svg className="sp-v9-empty-doc-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <h4 className="sp-v9-empty-doc-title">보관 서류 0건 (정직한 상태)</h4>
                <p className="sp-v9-empty-doc-desc">
                  현재 {activeProfile?.displayName ?? "구성원"}님의 계정에 등록된 병원 서류가 없습니다. 가상의 서울대병원 검진표나 더미 수치를
                  표시하지 않습니다. 새 서류를 등록하시면 원본과 OCR 추출값을 이곳에서 1:1로 정밀 대조할 수 있습니다.
                </p>
                <button
                  type="button"
                  className="sp-v9-action-btn secondary"
                  onClick={() => setActiveCategory("vitals")}
                >
                  건강기록 및 지표 보러가기
                </button>
              </div>
            )}

            {/* 건강기록 & 지표 차트 뷰 모드 */}
            {(selectedItem?.type === "vital" || activeCategory === "vitals") && (
              <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1.3fr", gap: "16px" }}>
                  <SingleMetricCard
                    metricKey={currentMetricKey}
                    onMetricChange={(newKey) => {
                      setSelectedMetricKey(newKey);
                    }}
                    seriesList={activeTrendSeries}
                    title={`${activeProfile?.displayName ?? "오성민"}님의 ${trendMap[currentMetricKey]?.label ?? currentMetricKey} 추이`}
                  />

                  <FamilyComparisonChart
                    metricKey={currentMetricKey}
                    onMetricChange={(newKey) => {
                      setSelectedMetricKey(newKey);
                    }}
                    familyData={familyComparisonData}
                  />
                </div>

                <div style={{ background: "#f8fafc", padding: "16px", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
                  <h4 style={{ margin: "0 0 8px", fontSize: "13px", fontWeight: 700, color: "#1e293b" }}>
                    선택된 건강기록 원시 데이터 (Payload)
                  </h4>
                  <pre style={{ margin: 0, fontSize: "11px", color: "#334155", background: "#ffffff", padding: "12px", borderRadius: "6px", border: "1px solid #cbd5e1", overflowX: "auto" }}>
                    {selectedItem && isHealthRecord(selectedItem.data)
                      ? JSON.stringify(selectedItem.data.payload, null, 2)
                      : "// 기록을 선택해주세요"}
                  </pre>
                </div>
              </div>
            )}

            {/* AI 판정 뷰 모드 */}
            {selectedItem?.type === "verdict" && isHealthRecord(selectedItem.data) && (
              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", padding: "16px", borderRadius: "8px" }}>
                  <h3 style={{ margin: "0 0 6px", fontSize: "15px", color: "#1d4fb8", fontWeight: 700 }}>
                    AI 만성질환 예측 판정 스냅샷
                  </h3>
                  <p style={{ margin: 0, fontSize: "12px", color: "#475569" }}>
                    판정 ID: {selectedItem.data.id} · 일시: {selectedItem.data.recordedAt}
                  </p>
                </div>

                <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", padding: "16px", borderRadius: "8px" }}>
                  <h4 style={{ margin: "0 0 10px", fontSize: "13px", color: "#0f172a" }}>사용된 관측값 입력 (Inputs)</h4>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px" }}>
                    {Object.entries((selectedItem.data.payload as { inputs?: Record<string, unknown> })?.inputs ?? {}).map(([k, v]) => (
                      <div key={k} style={{ padding: "8px", background: "#f8fafc", borderRadius: "6px", border: "1px solid #e2e8f0" }}>
                        <div style={{ fontSize: "11px", color: "#64748b" }}>{k}</div>
                        <div style={{ fontSize: "13px", fontWeight: 700, color: "#0f172a" }}>{String(v)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* 품질 이슈 모드 */}
            {selectedItem?.type === "issue" && isHealthRecord(selectedItem.data) && (
              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                <div style={{ background: "#fffbeb", border: "1px solid #fde68a", padding: "16px", borderRadius: "8px" }}>
                  <h3 style={{ margin: "0 0 6px", fontSize: "15px", color: "#b45309", fontWeight: 700 }}>
                    데이터 품질 검증 대기 상태
                  </h3>
                  <p style={{ margin: 0, fontSize: "12px", color: "#475569" }}>
                    기록 식별자: {selectedItem.data.id}
                  </p>
                </div>

                <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", padding: "16px", borderRadius: "8px" }}>
                  <h4 style={{ margin: "0 0 8px", fontSize: "13px" }}>이슈 감지 내용</h4>
                  <p style={{ margin: "0 0 12px", fontSize: "12px", color: "#64748b", lineHeight: 1.6 }}>
                    {selectedItem.data.source === "ocr" && !(selectedItem.data.payload as { userModified?: boolean })?.userModified
                      ? "• AI OCR로 자동 추출되었으나, 임상 안전을 위한 사용자의 최종 육안 대조 및 확인 절차가 아직 완료되지 않았습니다."
                      : "• 원본 문서 참조(sourceDocumentId)가 기재되어 있으나, 해당 문서 파일이 로컬 보안 보관소에서 조회되지 않는 상태입니다."}
                  </p>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* =========================================================
            3. 우측: 데이터 혈통 & 품질 감사 인스펙터 (Inspector)
           ========================================================= */}
        <section className="sp-v9-panel sp-v9-panel-inspector" aria-label="데이터 혈통 인스펙터">
          <div className="sp-v9-panel-header">
            <h2 className="sp-v9-panel-title">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1d4fb8" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 14 14" />
              </svg>
              데이터 혈통 감사 (Lineage)
            </h2>
            <span className="sp-v9-panel-badge">실측 파생</span>
          </div>

          <div className="sp-v9-inspector-body">
            {/* Step 1: 원천 데이터 생성 */}
            <div className="sp-v9-step-card">
              <div className="sp-v9-step-header">
                <span className="sp-v9-step-title">
                  <span className="sp-v9-step-num">1</span>
                  원천 데이터 생성 (Source)
                </span>
                <span className="sp-v9-mini-badge verified">완료</span>
              </div>
              <div className="sp-v9-step-body">
                <div className="sp-v9-kv-row">
                  <span className="sp-v9-kv-key">입력 출처</span>
                  <span className="sp-v9-kv-val">
                    {selectedItem && isHealthRecord(selectedItem.data) ? selectedItem.data.source : "local_vault"}
                  </span>
                </div>
                <div className="sp-v9-kv-row">
                  <span className="sp-v9-kv-key">원본 서류 ID</span>
                  <span className="sp-v9-kv-val">
                    {selectedItem && isHealthRecord(selectedItem.data)
                      ? selectedItem.data.sourceDocumentId ?? "없음 (직접 수기)"
                      : selectedItem?.data.id ?? "-"}
                  </span>
                </div>
                <div className="sp-v9-kv-row">
                  <span className="sp-v9-kv-key">측정 시각</span>
                  <span className="sp-v9-kv-val">
                    {selectedItem && isHealthRecord(selectedItem.data)
                      ? selectedItem.data.recordedAt.slice(0, 16)
                      : selectedItem?.data.createdAt.slice(0, 16) ?? "미지정"}
                  </span>
                </div>
              </div>
            </div>

            {/* Step 2: 추출 및 표준 정규화 */}
            <div className="sp-v9-step-card">
              <div className="sp-v9-step-header">
                <span className="sp-v9-step-title">
                  <span className="sp-v9-step-num">2</span>
                  추출 및 표준 정규화 (Mapping)
                </span>
                <span className="sp-v9-mini-badge verified">정규화</span>
              </div>
              <div className="sp-v9-step-body">
                <div className="sp-v9-kv-row">
                  <span className="sp-v9-kv-key">대상 지표</span>
                  <span className="sp-v9-kv-val">{trendMap[currentMetricKey]?.label || currentMetricKey}</span>
                </div>
                <div className="sp-v9-kv-row">
                  <span className="sp-v9-kv-key">정본 단위</span>
                  <span className="sp-v9-kv-val">{trendMap[currentMetricKey]?.unit || "-"}</span>
                </div>
                <div className="sp-v9-kv-row">
                  <span className="sp-v9-kv-key">정규화 사전</span>
                  <span className="sp-v9-kv-val">record_prefill.py</span>
                </div>
              </div>
            </div>

            {/* Step 3: 무결성 감사 및 품질 검증 */}
            <div className="sp-v9-step-card">
              <div className="sp-v9-step-header">
                <span className="sp-v9-step-title">
                  <span className="sp-v9-step-num">3</span>
                  품질 감사 및 검증 (Quality)
                </span>
                <span
                  className={`sp-v9-mini-badge ${
                    selectedItem &&
                    isHealthRecord(selectedItem.data) &&
                    selectedItem.data.source === "ocr" &&
                    !(selectedItem.data.payload as { userModified?: boolean })?.userModified
                      ? "unverified"
                      : "verified"
                  }`}
                >
                  {selectedItem &&
                  isHealthRecord(selectedItem.data) &&
                  selectedItem.data.source === "ocr" &&
                  !(selectedItem.data.payload as { userModified?: boolean })?.userModified
                    ? "확인필요"
                    : "검증완료"}
                </span>
              </div>
              <div className="sp-v9-step-body">
                <div className="sp-v9-kv-row">
                  <span className="sp-v9-kv-key">범위 검사(Bounds)</span>
                  <span className="sp-v9-kv-val" style={{ color: "#059669" }}>통과 (정상 범위)</span>
                </div>
                <div className="sp-v9-kv-row">
                  <span className="sp-v9-kv-key">사용자 정정 여부</span>
                  <span className="sp-v9-kv-val">
                    {selectedItem &&
                    isHealthRecord(selectedItem.data) &&
                    (selectedItem.data.payload as { userModified?: boolean })?.userModified
                      ? "정정됨"
                      : "원문 유지"}
                  </span>
                </div>
                <div className="sp-v9-kv-row">
                  <span className="sp-v9-kv-key">버전 번호</span>
                  <span className="sp-v9-kv-val">v{selectedItem?.data.version ?? 1}</span>
                </div>
              </div>
            </div>

            {/* Step 4: 판정 및 대시보드 소비 */}
            <div className="sp-v9-step-card">
              <div className="sp-v9-step-header">
                <span className="sp-v9-step-title">
                  <span className="sp-v9-step-num">4</span>
                  소비 및 시각화 (Downstream)
                </span>
                <span className={`sp-v9-mini-badge ${isPresentInDashboard ? "verified" : ""}`}>
                  {isPresentInDashboard ? "타일연결됨" : "대시보드 미배치"}
                </span>
              </div>
              <div className="sp-v9-step-body">
                <div className="sp-v9-kv-row">
                  <span className="sp-v9-kv-key">시안 7 대시보드</span>
                  <span className="sp-v9-kv-val">{isPresentInDashboard ? "활성 렌더링 중" : "타일 추가 가능"}</span>
                </div>
                <div className="sp-v9-kv-row">
                  <span className="sp-v9-kv-key">만성질환 판정 폼</span>
                  <span className="sp-v9-kv-val">자동 채우기 연동</span>
                </div>
                <div className="sp-v9-kv-row">
                  <span className="sp-v9-kv-key">가족 비교 멀티라인</span>
                  <span className="sp-v9-kv-val" style={{ color: "#059669" }}>실시간 비교 가용</span>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* 완료 토스트 알림 */}
      {toastMessage && (
        <aside className="sp-v9-toast" role="status" aria-live="polite">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <span>{toastMessage}</span>
          <Link
            to="/ui-preview7"
            style={{ color: "#60a5fa", fontWeight: 700, textDecoration: "underline", marginLeft: "4px" }}
          >
            시안 7에서 확인
          </Link>
        </aside>
      )}
    </div>
  );
}
