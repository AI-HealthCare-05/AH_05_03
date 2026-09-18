import { useState } from "react";

import type { AssessmentSummaryData, DiseaseRisk, DiseaseVerdict, RiskLevel } from "./contracts";
import { LEVEL_LABEL } from "./contracts";
import type { ModelSpec } from "./Evidence";
import { FIELD_BY_NAME, FIELD_LABELS } from "./fields";
import { briefList, objectParticle } from "./precision";
import type { LevelTrack, Snapshot, TrendSeries } from "./snapshots";
import { SuspectPanel } from "./SuspectPanel";
import { TrendChart } from "./TrendChart";
import { MatrixCard, VerdictCard } from "./VerdictCards";
import "./risk-report.css";

type ReportProps = {
  result: AssessmentSummaryData;
  values: Record<string, string>;
  models: ModelSpec[];
  snapshots: Snapshot[];
  recent: Snapshot[];
  series: TrendSeries[];
  tracks: LevelTrack[];
  diseaseNames: Record<string, string>;
  verdicts: DiseaseVerdict[];
  matrix: DiseaseRisk[];
  sharedInputs: string[];
  profileName: string;
  reportAt?: string;
  profiles: { id: string; displayName: string }[];
  activeProfileId: string | undefined;
  onProfileChange: (id: string) => void;
  onKeep: () => void;
  keeping: boolean;
  saved: string | undefined;
  onReset: () => void;
  onNew: () => void;
  onOpenDetail: () => void;
  onOpenDisease: (key: string) => void;
  onOpenHistory: (snapshot: Snapshot) => void;
};

const statusName: Record<RiskLevel, string> = {
  VERY_HIGH: "관찰 필요",
  HIGH: "관찰 필요",
  CAUTION: "주의",
  NORMAL: "안정",
  INSUFFICIENT_DATA: "정보 부족",
};

function tone(level: RiskLevel) {
  if (level === "HIGH" || level === "VERY_HIGH") return "danger";
  if (level === "CAUTION") return "caution";
  if (level === "NORMAL") return "safe";
  return "unknown";
}

function ReportHeader({ profileName, reportAt, onReset, onNew }: Pick<ReportProps, "profileName" | "reportAt" | "onReset" | "onNew">) {
  return (
    <header className="risk-report-header">
      <div>
        <p className="risk-breadcrumb">위험 판정 <span aria-hidden="true">›</span> 만성질환 위험도 심층 분석</p>
        <h1>{profileName ? `${profileName}님의` : "나의"} 만성질환 위험도 분석</h1>
        <p>{reportAt ? `${new Date(reportAt).toLocaleDateString("ko-KR")} 판정 결과입니다.` : "건강정보를 바탕으로 분석한 결과입니다."}</p>
      </div>
      <div className="risk-report-header-actions">
        <button type="button" className="risk-new-action" onClick={onNew}>새로운 결과 넣어보기 <span aria-hidden="true">→</span></button>
        <button type="button" className="risk-other-record" onClick={onReset}>다른 기록으로 분석하기</button>
      </div>
    </header>
  );
}

function AnalysisSummary({ result, verdicts }: Pick<ReportProps, "result" | "verdicts">) {
  const high = verdicts.filter((item) => item.risk_level === "HIGH" || item.risk_level === "VERY_HIGH").length;
  const caution = verdicts.filter((item) => item.risk_level === "CAUTION").length;
  const normal = verdicts.filter((item) => item.risk_level === "NORMAL").length;
  const first = verdicts.find((item) => item.risk_level === "VERY_HIGH" || item.risk_level === "HIGH" || item.risk_level === "CAUTION");
  const points = (result.top_suspects ?? []).filter((item) => item.reason).slice(0, 2);
  return (
    <section className="risk-summary" aria-labelledby="risk-summary-heading">
      <div className="risk-summary-lead">
        <h2 id="risk-summary-heading"><strong>{high + caution}개 항목</strong>에서 관리가 필요해요.</h2>
        <p>전체 {verdicts.length}개 중 {high}개는 관찰이 필요하고, {caution}개는 주의, {normal}개는 안정 범위예요.</p>
        <div className="risk-counts" aria-label="판정 요약">
          <span className="risk-count danger">관찰 필요 <strong>{high}</strong></span>
          <span className="risk-count caution">주의 <strong>{caution}</strong></span>
          <span className="risk-count safe">안정 <strong>{normal}</strong></span>
        </div>
      </div>
      <div className="risk-summary-points">
        <h3>꼭 확인해 주세요</h3>
        <ul>{first && <li>{first.name}: {first.reason}</li>}{points.map((item) => <li key={item.target}>{item.reason}</li>)}<li>현재 결과는 진단이 아니며 의료진의 판단을 대신하지 않습니다.</li></ul>
      </div>
    </section>
  );
}

function DiseaseRiskOverview({ verdicts, values, models, sharedInputs, onOpenDisease }: Pick<ReportProps, "verdicts" | "values" | "models" | "sharedInputs" | "onOpenDisease">) {
  const [expanded, setExpanded] = useState(false);
  return (
    <section className="risk-report-section" aria-labelledby="risk-overview-heading">
      <div className="risk-section-heading"><h2 id="risk-overview-heading">주요 질환별 위험도</h2><button type="button" className="risk-link" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>{expanded ? "간단히 보기" : "전체 결과 보기"} <span aria-hidden="true">›</span></button></div>
      <div className="risk-disease-list">
        {(expanded ? verdicts : verdicts.slice(0, 5)).map((verdict) => {
          return <button type="button" className="risk-disease-row" key={verdict.key} onClick={() => onOpenDisease(verdict.key)} aria-label={`${verdict.name} 상세 근거 보기`}><strong>{verdict.name}</strong><span className={`risk-status ${tone(verdict.risk_level)}`}>{statusName[verdict.risk_level]}</span><span className="risk-row-measure">{verdict.reason || LEVEL_LABEL[verdict.risk_level]}</span><span className="risk-row-reason">{verdict.display_label}</span><span aria-hidden="true">›</span></button>;
        })}
      </div>
      {expanded && <div className="risk-expanded-results">
        {sharedInputs.length > 0 && <p>{briefList(sharedInputs)}{objectParticle(briefList(sharedInputs))} 채우면 여러 카드의 예측이 함께 정밀해져요.</p>}
        <div className="assess-cards">{verdicts.map((verdict) => <VerdictCard key={verdict.key} verdict={verdict} values={values} models={models} sharedRefining={sharedInputs} />)}</div>
      </div>}
    </section>
  );
}

function HealthTrendSection({ snapshots, recent, series, tracks, diseaseNames }: Pick<ReportProps, "snapshots" | "recent" | "series" | "tracks" | "diseaseNames">) {
  return <section className="risk-report-section risk-trend" aria-labelledby="risk-trend-heading"><div className="risk-section-heading"><h2 id="risk-trend-heading">주요 지표 변화 추이</h2></div>
    <TrendChart series={series.slice(0, 2)} tracks={[]} names={diseaseNames} dates={recent.map((item) => item.recordedAt)} total={snapshots.length} />
    {(series.length > 2 || tracks.length > 0) && <details className="risk-trend-more"><summary>전체 변화 추이 보기</summary><TrendChart series={series} tracks={tracks} names={diseaseNames} dates={recent.map((item) => item.recordedAt)} total={snapshots.length} /></details>}
  </section>;
}

function FutureRiskSection({ verdicts, matrix, result }: Pick<ReportProps, "verdicts" | "matrix" | "result">) {
  const [showMatrix, setShowMatrix] = useState(false);
  const rows = verdicts.flatMap((item) => {
    const onset = item.reference?.trajectory;
    const prevalence = item.reference?.prevalence_trajectory;
    if (onset && item.reference?.trajectory_status === "projected" && onset.horizons_years.length) {
      const index = onset.horizons_years.length - 1;
      return [{ key: item.key, name: item.name, years: onset.horizons_years[index], value: onset.onset_probability[index], kind: "새로 생길 확률" }];
    }
    if (prevalence && prevalence.horizons_years.length) {
      const index = prevalence.horizons_years.length - 1;
      return [{ key: item.key, name: item.name, years: prevalence.horizons_years[index], value: prevalence.prevalence_probability[index], kind: "기준 초과 확률" }];
    }
    return [];
  }).filter((item) => Number.isFinite(item.value)).sort((a, b) => b.value - a.value).slice(0, 4);
  return <section className="risk-report-section risk-future" aria-labelledby="risk-future-heading"><div className="risk-section-heading"><h2 id="risk-future-heading">앞으로의 위험 예측</h2></div>
    {rows.length ? <ul className="risk-future-list">{rows.map((row) => <li key={row.key}><strong>{row.name}</strong><span>{row.years}년 뒤 · {row.kind}</span><b>{Math.round(row.value * 100)}%</b><progress value={row.value} max={1} aria-label={`${row.name} ${row.years}년 뒤 ${row.kind}`} /></li>)}</ul> : <p className="risk-empty">표시할 미래 확률이 없습니다. 검사값과 모델 제공 범위에 따라 예측이 제한될 수 있습니다.</p>}
    <button type="button" className="risk-wide-action" onClick={() => setShowMatrix(!showMatrix)} aria-expanded={showMatrix}>{showMatrix ? "근거 접기" : "관련 위험 신호 보기"} <span aria-hidden="true">→</span></button>
    {showMatrix && <div className="risk-matrix-detail"><SuspectPanel suspects={result.top_suspects ?? []} verdicts={result.verdicts ?? []} /><h3>수치가 가리키는 앞날</h3><p>한 수치가 여러 질환의 위험 신호가 될 수 있습니다. 아래 결과는 위 확률과 다른 판정 축입니다.</p><div className="assess-matrix-grid">{matrix.map((risk) => <MatrixCard key={risk.category} risk={risk} />)}</div></div>}
  </section>;
}

function KeyFactors({ verdicts, values }: Pick<ReportProps, "verdicts" | "values">) {
  const factors = verdicts.flatMap((item) => (item.reference?.top_factors ?? []).map((factor) => ({ ...factor, disease: item.name }))).filter((item, index, all) => all.findIndex((other) => other.feature === item.feature) === index).slice(0, 5);
  return <div className="risk-explanation-part"><h3>주요 요인</h3>{factors.length ? <><ol className="risk-factor-list">{factors.map((factor) => <li key={factor.feature}><span>{FIELD_LABELS[factor.feature] ?? factor.feature}</span><strong>{values[factor.feature] ? `${values[factor.feature]} ${FIELD_BY_NAME[factor.feature]?.unit ?? ""}` : "입력값 없음"}</strong><small>{factor.disease} 모델 기여도 {factor.contribution.toFixed(2)}</small></li>)}</ol><p className="risk-factor-note">모델의 참고 요인이며 현재 판정의 인과관계를 뜻하지 않습니다.</p></> : <p>표시할 모델 기여도 정보가 없습니다.</p>}</div>;
}

function RelatedMeasurements({ values, verdicts }: Pick<ReportProps, "values" | "verdicts">) {
  const keys = [...new Set([...verdicts.flatMap((item) => (item.reference?.top_factors ?? []).map((factor) => factor.feature)), "sbp", "dbp", "fasting_glucose", "ldl", "hdl", "total_chol", ...Object.keys(values)])].filter((key) => values[key] && FIELD_BY_NAME[key]).slice(0, 8);
  return <div className="risk-explanation-part"><h3>관련 수치</h3>{keys.length ? <dl className="risk-measurements">{keys.map((key) => <div key={key}><dt>{FIELD_LABELS[key] ?? key}</dt><dd>{values[key]} {FIELD_BY_NAME[key]?.unit}</dd></div>)}</dl> : <p>모델 주요 요인에 연결된 입력 수치가 없습니다.</p>}</div>;
}

function ModelExplanation({ verdicts, onOpenDetail }: Pick<ReportProps, "verdicts" | "result" | "onOpenDetail">) {
  const engines = [...new Set(verdicts.map((item) => item.engine_label))];
  return <div className="risk-explanation-part"><h3>모델 설명</h3><p>이 결과에는 {engines.join(" · ")} 판정이 포함됩니다.</p><p>검사값이 있는 질환은 규칙 엔진이나 공개 공식이 우선할 수 있습니다. 질환별 정본과 참고 확률은 상세 근거에서 확인하세요.</p><button type="button" className="risk-link" onClick={onOpenDetail}>모델별 근거 자세히 보기 <span aria-hidden="true">→</span></button></div>;
}

function MedicalEvidence({ verdicts, onOpenDetail }: Pick<ReportProps, "verdicts" | "onOpenDetail">) {
  const citations = [...new Set(verdicts.map((item) => item.criteria_reference).filter(Boolean))].slice(0, 4);
  const recommendations = [...new Set(verdicts.filter((item) => item.risk_level === "HIGH" || item.risk_level === "VERY_HIGH" || item.risk_level === "CAUTION").map((item) => item.recommendation).filter(Boolean))].slice(0, 3);
  return <div className="risk-explanation-part"><h3>의학적 근거</h3>{citations.length ? <ul className="risk-citations">{citations.map((citation) => <li key={citation}>{citation}</li>)}</ul> : <p>표시할 판정 기준 출처가 없습니다.</p>}{recommendations.length > 0 && <><h4>판정에 따른 안내</h4><ul className="risk-citations">{recommendations.map((line) => <li key={line}>{line}</li>)}</ul></>}<button type="button" className="risk-link" onClick={onOpenDetail}>전체 분석 근거 보기 <span aria-hidden="true">→</span></button></div>;
}

function ExplanationSection(props: Pick<ReportProps, "verdicts" | "values" | "result" | "onOpenDetail">) {
  return <section className="risk-report-section risk-explanation" aria-labelledby="risk-explanation-heading"><h2 id="risk-explanation-heading">왜 이런 결과가 나왔을까요?</h2><div className="risk-explanation-list"><details><summary>주요 요인</summary><KeyFactors verdicts={props.verdicts} values={props.values} /></details><details><summary>관련 수치와 근거</summary><RelatedMeasurements verdicts={props.verdicts} values={props.values} /><MedicalEvidence verdicts={props.verdicts} onOpenDetail={props.onOpenDetail} /></details><details><summary>모델 설명</summary><ModelExplanation verdicts={props.verdicts} result={props.result} onOpenDetail={props.onOpenDetail} /></details></div></section>;
}

function MedicalDisclaimer({ result, profiles, activeProfileId, onProfileChange, onKeep, keeping, saved }: Pick<ReportProps, "result" | "profiles" | "activeProfileId" | "onProfileChange" | "onKeep" | "keeping" | "saved">) {
  return <details className="risk-report-disclaimer"><summary>의학적 안내사항</summary><p>이 결과는 건강정보에 대한 참고 자료이며 진단이나 처방을 대신하지 않습니다.</p>{saved && <p role="status">{saved}</p>}{profiles.length ? <div className="risk-save"><label>기록 대상 <select value={activeProfileId ?? ""} onChange={(event) => onProfileChange(event.target.value)}>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.displayName}</option>)}</select></label><button type="button" className="risk-pill" onClick={onKeep} disabled={keeping}>{keeping ? "저장 중…" : "판정 기록 다시 남기기"}</button></div> : <p>변화 추이를 남기려면 가족 홈에서 구성원을 등록해 주세요.</p>}{result.disclaimers.map((line) => <p key={line}>{line}</p>)}</details>;
}

function ReportHistory({ snapshots, onOpenHistory }: Pick<ReportProps, "snapshots" | "onOpenHistory">) {
  if (!snapshots.length) return null;
  const historyCount = snapshots.reduce((count, snapshot) => count + Math.max(1, snapshot.payload.runs?.length ?? 0), 0);
  return <details className="risk-report-history">
    <summary>이전 판정 결과 보기 <span>{historyCount}건</span></summary>
    <ul>{[...snapshots].reverse().map((snapshot) => {
      const olderRuns = snapshot.payload.runs?.slice(0, -1) ?? [];
      return <li key={snapshot.id}>
        <button type="button" onClick={() => onOpenHistory(snapshot)}>
          <time dateTime={snapshot.recordedAt}>{new Date(snapshot.payload.checkedAt || snapshot.recordedAt).toLocaleString("ko-KR")}</time>
          <span>{Object.values(snapshot.payload.levels).filter((level) => level === "HIGH" || level === "VERY_HIGH").length}개 관찰 필요</span>
          <span aria-hidden="true">›</span>
        </button>
        {olderRuns.length > 0 && <details className="risk-legacy-runs">
          <summary>이 기록의 이전 판정 등급 {olderRuns.length}건</summary>
          <ul>{olderRuns.map((run, index) => <li key={`${run.at}-${index}`}>
            <time dateTime={run.at || snapshot.recordedAt}>{new Date(run.at || snapshot.recordedAt).toLocaleString("ko-KR")}</time>
            <span>{Object.entries(run.levels).map(([key, level]) =>
              `${snapshot.payload.verdicts?.find((item) => item.key === key)?.name ?? key}: ${LEVEL_LABEL[level as RiskLevel] ?? level}`,
            ).join(" · ")}</span>
            <small>이전 저장 방식의 등급 기록 · 상세 근거 없음</small>
          </li>)}</ul>
        </details>}
      </li>;
    })}</ul>
  </details>;
}

export function RiskReportPage(props: ReportProps) {
  return <div className="risk-report-page">
    <ReportHeader profileName={props.profileName} reportAt={props.reportAt} onReset={props.onReset} onNew={props.onNew} />
    <ReportHistory snapshots={props.snapshots} onOpenHistory={props.onOpenHistory} />
    <AnalysisSummary result={props.result} verdicts={props.verdicts} />
    <DiseaseRiskOverview verdicts={props.verdicts} values={props.values} models={props.models} sharedInputs={props.sharedInputs} onOpenDisease={props.onOpenDisease} />
    <div className={`risk-middle-grid ${props.series.length === 0 ? "is-no-trend" : ""}`}><HealthTrendSection snapshots={props.snapshots} recent={props.recent} series={props.series} tracks={props.tracks} diseaseNames={props.diseaseNames} /><FutureRiskSection verdicts={props.verdicts} matrix={props.matrix} result={props.result} /></div>
    <ExplanationSection verdicts={props.verdicts} values={props.values} result={props.result} onOpenDetail={props.onOpenDetail} />
    <MedicalDisclaimer result={props.result} profiles={props.profiles} activeProfileId={props.activeProfileId} onProfileChange={props.onProfileChange} onKeep={props.onKeep} keeping={props.keeping} saved={props.saved} />
  </div>;
}
