import { useEffect, useMemo, useState } from "react";
import type { HealthRecord } from "../../shared/local/domainContracts";
import type { LocalDomainRuntime } from "../../shared/local/localDomainRuntime";
import { analyzeExamTrends, type ExamDataPoint, type MetricTrendSeries } from "./examTrendAnalyzer";

interface Props {
  records: HealthRecord[];
  profileName: string;
  runtime?: LocalDomainRuntime;
}

export function ExamTrendSection({ records, profileName, runtime }: Props) {
  const trendData = useMemo(() => analyzeExamTrends(records), [records]);
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [selectedMetricName, setSelectedMetricName] = useState<string | null>(null);
  const [selectedPoint, setSelectedPoint] = useState<ExamDataPoint | null>(null);

  // 원본 서류 열람 상태
  const [previewDoc, setPreviewDoc] = useState<{ name: string; url: string; mimeType: string } | null>(null);
  const [docError, setDocError] = useState<string | null>(null);
  const [readingDoc, setReadingDoc] = useState(false);

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

  // 활성 메트릭이 변경되면 최신 포인트를 기본 선택 포인트로 지정
  useEffect(() => {
    if (activeMetric) {
      // 이전에 선택된 포인트가 현재 메트릭에 속해있는지 확인
      const matching = activeMetric.dataPoints.find(
        (p) => selectedPoint && p.date === selectedPoint.date && p.recordId === selectedPoint.recordId
      );
      setSelectedPoint(matching || activeMetric.latest);
    } else {
      setSelectedPoint(null);
    }
    setDocError(null);
  }, [activeMetric]);

  // 원본 서류 열람 핸들러
  async function handleOpenDocument(documentId: string) {
    if (!runtime?.documents) {
      setDocError("로컬 문서 저장소가 지원되지 않는 환경입니다.");
      return;
    }
    setReadingDoc(true);
    setDocError(null);
    try {
      const listResult = await runtime.documents.list();
      if (!listResult.ok) throw new Error(listResult.error.message);

      const targetDoc = listResult.value.find((d) => d.id === documentId);
      if (!targetDoc) {
        setDocError("⚠️ 연결된 원본 서류가 삭제되어 열 수 없습니다. (건강기록 자체는 안전하게 유지됩니다)");
        return;
      }

      const readResult = await runtime.documents.read(targetDoc);
      if (!readResult.ok) {
        setDocError("⚠️ 연결된 원본 서류가 삭제되어 열 수 없습니다. (건강기록 자체는 안전하게 유지됩니다)");
        return;
      }

      const url = URL.createObjectURL(readResult.value);
      setPreviewDoc({
        name: targetDoc.fileName,
        url,
        mimeType: targetDoc.mimeType,
      });
    } catch (caught) {
      setDocError(caught instanceof Error ? caught.message : "원본 서류를 열람하지 못했습니다.");
    } finally {
      setReadingDoc(false);
    }
  }

  function handleCloseDocPreview() {
    if (previewDoc) {
      URL.revokeObjectURL(previewDoc.url);
      setPreviewDoc(null);
    }
  }

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
              onClick={() => {
                setSelectedMetricName(metric.canonicalName);
                setSelectedPoint(metric.latest);
              }}
            >
              <div className="trend-card-top">
                <span className="trend-metric-name">{metric.canonicalName}</span>
                <span className="trend-data-count">{metric.dataPoints.length}회 측정</span>
              </div>
              <div className="trend-card-value">
                <strong>{metric.latest.value}</strong>
                {shouldShowUnit(metric.latest.value, metric.unit) ? <small>{metric.unit}</small> : null}
              </div>
              <div className="trend-card-bottom">
                <span className="trend-latest-date">{metric.latest.date}</span>
                {diff ? (
                  <span className={`trend-delta-chip delta-${diff.direction}`}>
                    {diff.direction === "increased" ? "▲" : diff.direction === "decreased" ? "▼" : "•"}{" "}
                    {diff.text} {shouldShowUnit(metric.latest.value, metric.unit) ? metric.unit : ""}
                  </span>
                ) : (
                  <span className="trend-delta-chip delta-first">첫 기록</span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* 선택된 항목의 인터랙티브 트렌드 차트 및 타임라인 */}
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

          <TrendSvgChart
            metric={activeMetric}
            selectedPoint={selectedPoint}
            onSelectPoint={(pt) => setSelectedPoint(pt)}
          />

          {/* 타임라인 포인트 목록 (클릭 시 선택) */}
          <div className="trend-timeline-list">
            {activeMetric.dataPoints.map((pt, idx) => {
              const isPtSelected = selectedPoint?.dateTime === pt.dateTime && selectedPoint?.recordId === pt.recordId;
              return (
                <button
                  key={pt.dateTime + idx}
                  type="button"
                  className={isPtSelected ? "trend-timeline-item is-selected" : "trend-timeline-item"}
                  onClick={() => setSelectedPoint(pt)}
                >
                  <span className="timeline-date">{pt.date}</span>
                  <span className="timeline-value">
                    <strong>{pt.value}</strong> {pt.unit}
                  </span>
                  {pt.judgment ? <span className="timeline-judgment">{pt.judgment}</span> : null}
                  {pt.diffFromPrev ? (
                    <span className={`timeline-diff delta-${pt.diffFromPrev.direction}`}>
                      ({pt.diffFromPrev.text})
                    </span>
                  ) : (
                    <span className="timeline-diff initial-mark">(기준점)</span>
                  )}
                </button>
              );
            })}
          </div>

          {/* 그래프 값의 근거 추적 (Provenance & Traceability Panel) */}
          {selectedPoint && (
            <div className="trend-provenance-panel" aria-labelledby="provenance-heading">
              <div className="provenance-header">
                <h5 id="provenance-heading">
                  🔍 <strong>{selectedPoint.canonicalName}</strong> 측정값 근거 및 이력 추적
                </h5>
                <span className={`provenance-source-tag source-${selectedPoint.source}`}>
                  {selectedPoint.source === "ocr"
                    ? "🛡️ OCR 인식 후 사용자 확인 완료"
                    : selectedPoint.source === "local_ai"
                    ? "💬 AI 대화 입력 확인 완료"
                    : "✍️ 수기 직접 입력"}
                </span>
              </div>

              <div className="provenance-grid">
                <div className="provenance-item">
                  <span className="provenance-label">검사 일자</span>
                  <strong>{selectedPoint.date}</strong>
                </div>
                <div className="provenance-item">
                  <span className="provenance-label">최종 확정 수치</span>
                  <strong className="provenance-value-highlight">
                    {selectedPoint.value} {selectedPoint.unit}
                  </strong>
                </div>
                <div className="provenance-item">
                  <span className="provenance-label">문서 원본 검사명</span>
                  <span>{selectedPoint.rawName}</span>
                </div>
                <div className="provenance-item">
                  <span className="provenance-label">판정 / 참고치</span>
                  <span>{selectedPoint.judgment || "기록 없음"}</span>
                </div>
                <div className="provenance-item">
                  <span className="provenance-label">매핑 신뢰도/방식</span>
                  <span className="provenance-match-type">
                    {selectedPoint.matchType === "exact"
                      ? "완전 일치 (Exact)"
                      : selectedPoint.matchType === "alias"
                      ? "동의어 매핑 (Alias)"
                      : selectedPoint.matchType === "fuzzy"
                      ? "키워드 매핑 (Fuzzy)"
                      : "원문 보존 (Unrecognized)"}
                  </span>
                </div>
                <div className="provenance-item">
                  <span className="provenance-label">기록 생성일</span>
                  <span>{new Date(selectedPoint.recordCreatedAt).toLocaleDateString("ko-KR")}</span>
                </div>
              </div>

              {selectedPoint.rawOcrText ? (
                <div className="provenance-ocr-block">
                  <span className="provenance-label">OCR 원문 추출 행</span>
                  <code>{selectedPoint.rawOcrText}</code>
                </div>
              ) : null}

              <div className="provenance-doc-footer">
                {selectedPoint.sourceDocumentId ? (
                  <div className="provenance-doc-row">
                    <span className="provenance-doc-info">📄 연결된 원본 건강 서류</span>
                    <button
                      type="button"
                      className="secondary-button view-source-doc-btn"
                      disabled={readingDoc}
                      onClick={() => void handleOpenDocument(selectedPoint.sourceDocumentId!)}
                    >
                      {readingDoc ? "서류 여는 중…" : "원본 서류 열람"}
                    </button>
                  </div>
                ) : (
                  <p className="provenance-no-doc">※ 연결된 원본 서류 파일이 없는 수기 직접 작성 기록입니다.</p>
                )}
                {docError ? <div className="alert error-alert" role="alert">{docError}</div> : null}
              </div>
            </div>
          )}
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
                  <tr
                    key={m.canonicalName}
                    className={activeMetric?.canonicalName === m.canonicalName ? "row-selected" : ""}
                    onClick={() => {
                      setSelectedMetricName(m.canonicalName);
                      setSelectedPoint(m.latest);
                    }}
                  >
                    <td className="sticky-col font-semibold">{m.canonicalName}</td>
                    {trendData.dates.map((d) => {
                      const pt = pointsMap.get(d);
                      return (
                        <td
                          key={d}
                          className="tabular-value"
                          onClick={(e) => {
                            if (pt) {
                              e.stopPropagation();
                              setSelectedMetricName(m.canonicalName);
                              setSelectedPoint(pt);
                            }
                          }}
                        >
                          {pt ? (
                            <span className="clickable-cell" title="클릭하여 근거 상세 확인">
                              {pt.value} {shouldShowUnit(pt.value, pt.unit) ? <small className="unit-label">{pt.unit}</small> : null}
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
        ※ 본 비교표는 사용자가 확인하고 브라우저 로컬에 저장한 기록의 단순 수치 변화이며, 의학적 진단이나 처방이 아닙니다.
      </p>

      {/* 원본 서류 안전 미리보기 모달 */}
      {previewDoc && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="preview-doc-title">
            <div className="modal-heading">
              <div>
                <p className="section-kicker">로컬 원본 서류 열람</p>
                <h2 id="preview-doc-title">{previewDoc.name}</h2>
              </div>
              <button className="modal-close" type="button" onClick={handleCloseDocPreview} aria-label="닫기">
                ×
              </button>
            </div>
            <div className="document-preview-modal-body">
              {previewDoc.mimeType === "application/pdf" ? (
                <iframe src={previewDoc.url} title={previewDoc.name} />
              ) : (
                <img src={previewDoc.url} alt={previewDoc.name} />
              )}
            </div>
            <div className="form-actions">
              <button className="primary-button" type="button" onClick={handleCloseDocPreview}>
                닫기
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}

function TrendSvgChart({
  metric,
  selectedPoint,
  onSelectPoint,
}: {
  metric: MetricTrendSeries;
  selectedPoint: ExamDataPoint | null;
  onSelectPoint: (pt: ExamDataPoint) => void;
}) {
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
        {coords.map((c, i) => {
          const isSelected = selectedPoint?.dateTime === c.point.dateTime && selectedPoint?.recordId === c.point.recordId;
          return (
            <g
              key={i}
              style={{ cursor: "pointer" }}
              onClick={() => onSelectPoint(c.point)}
              role="button"
              tabIndex={0}
              aria-label={`${c.point.date}: ${c.point.value} ${c.point.unit}`}
            >
              {isSelected ? (
                <circle cx={c.x} cy={c.y} r="8" fill="#93c5fd" opacity="0.6" />
              ) : null}
              <circle
                cx={c.x}
                cy={c.y}
                r={isSelected ? "6" : "5"}
                fill={isSelected ? "#1d4ed8" : "#2563eb"}
                stroke="#ffffff"
                strokeWidth="2"
              />
              <text
                x={c.x}
                y={c.y - 10}
                textAnchor="middle"
                fontSize={isSelected ? "12" : "11"}
                fontWeight={isSelected ? "700" : "600"}
                fill={isSelected ? "#1d4ed8" : "#1e293b"}
              >
                {c.point.numericValue}
              </text>
              <text x={c.x} y={height - 10} textAnchor="middle" fontSize="10" fill="#64748b">
                {c.point.date.slice(5)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
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

