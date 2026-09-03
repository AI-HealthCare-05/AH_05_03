/**
 * 판정 화면 — 수치 입력에서 질환별 결과까지 한 화면.
 *
 * 왜 이 화면이 필요했나
 * ---------------------
 * 서버는 질환 13칸 + 매트릭스 4칸을 근거까지 붙여 내보내는데 **받을 화면이 없었다.**
 * 모델 작업 전부가 사용자에게 도달하지 않는 상태였고, 문서 32번이 그것을 축 A 의
 * `output` 끊김으로 판정했다.
 *
 * 무엇을 그대로 보여주는가
 * ------------------------
 * 확률 하나만 크게 띄우지 않는다. 서버가 `engine` · `engine_reason` ·
 * `superseded_by` 를 실어 보내는 이유가 **"왜 이 답인가"를 화면이 설명할 수
 * 있어야** 하기 때문이다. 검사값을 넣으면 정본이 규칙 엔진으로 넘어가고 ML 확률은
 * 참고로 내려가는데, 그 사실이 화면에 보이지 않으면 사용자는 숫자가 왜 바뀌었는지
 * 알 수 없다.
 *
 * 두 축을 나란히 두는 이유는 재료가 겹쳐서다. 위쪽 열세 칸은 "여러 수치 → 이 장기의
 * 현재 상태", 아래쪽 매트릭스는 그 전치인 "수치 하나 → 여러 질환의 앞날"이다.
 * 합치면 같은 값을 두 번 세게 되고, **심혈관질환은 아래 축에만 있다.**
 */

import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { useLocalDomain } from "../../app/localDomainContext";
import { ServerApiError, serverApiClient } from "../../shared/api/serverApiClient";
import type { AssessmentSummaryData, DiseaseRisk, DiseaseVerdict, RiskLevel } from "./contracts";
import { ENGINE_SHORT, LEVEL_LABEL, LEVEL_ORDER } from "./contracts";
import { FIELD_GROUPS, LAB_FIELDS, REQUIRED_FIELDS, toRequestBody } from "./fields";
import { buildLevelTracks, buildSeries, listSnapshots, saveSnapshot, TREND_WINDOW, type Snapshot } from "./snapshots";
import { TrendChart } from "./TrendChart";

const LEVEL_CLASS: Record<RiskLevel, string> = {
  VERY_HIGH: "level-very-high",
  HIGH: "level-high",
  CAUTION: "level-caution",
  NORMAL: "level-normal",
  INSUFFICIENT_DATA: "level-unknown",
};

function LevelBadge({ level }: { level: RiskLevel }) {
  return <span className={`assess-badge ${LEVEL_CLASS[level]}`}>{LEVEL_LABEL[level]}</span>;
}

/** 확률·백분위·정확도. 정본이 아니어도 지우지 않는다 — 접어서 둔다. */
function ReferenceBlock({ verdict }: { verdict: DiseaseVerdict }) {
  const ref = verdict.reference;
  if (!ref || ref.probability === null || ref.probability === undefined) return null;
  const percent = (ref.probability * 100).toFixed(1);
  const accuracy = ref.accuracy;
  return (
    <details className="assess-reference">
      <summary>
        {verdict.superseded_by ? "밀려난 ML 추정 " : "ML 추정 근거 "}
        <strong>{percent}%</strong>
        {ref.peer_percentile !== null && ref.peer_percentile !== undefined && (
          <span className="assess-muted"> · {ref.peer_group} 백분위 {Math.round(ref.peer_percentile)}</span>
        )}
      </summary>
      <dl>
        {ref.peer_ratio ? (
          <>
            <dt>동년배 중간값 대비</dt>
            <dd>{ref.peer_ratio}배</dd>
          </>
        ) : null}
        {accuracy ? (
          <>
            <dt>판별력</dt>
            <dd>
              AUROC {accuracy.headline_auroc} · {accuracy.grade}
              <span className="assess-muted"> ({accuracy.measured_on} 기준)</span>
            </dd>
            {accuracy.alert_ppv !== null && (
              <>
                <dt>상위 10% 경보 적중률</dt>
                <dd>
                  {(accuracy.alert_ppv * 100).toFixed(0)}%
                  {accuracy.alert_sensitivity !== null && (
                    <span className="assess-muted">
                      {" "}· 실제 해당자 중 {(accuracy.alert_sensitivity * 100).toFixed(0)}% 를 잡아낸다
                    </span>
                  )}
                </dd>
              </>
            )}
          </>
        ) : null}
      </dl>
      <p className="assess-fineprint">
        AUROC 는 "100명 중 몇 명을 맞힌다"가 아니다. 위험한 사람과 아닌 사람을 한 명씩 뽑았을 때 위험한 쪽에 더 높은
        점수를 줄 확률이다. 사용자가 실제로 겪는 값은 경보 적중률 쪽이다.
      </p>
    </details>
  );
}

function VerdictCard({ verdict }: { verdict: DiseaseVerdict }) {
  return (
    <article className={`assess-card ${LEVEL_CLASS[verdict.risk_level]}`}>
      <header>
        <h3>{verdict.name}</h3>
        <LevelBadge level={verdict.risk_level} />
      </header>
      {verdict.sub_status && <p className="assess-substatus">{verdict.sub_status}</p>}
      <p className="assess-label">{verdict.display_label}</p>

      <p className="assess-engine">
        <span className={`assess-engine-tag engine-${verdict.engine.toLowerCase()}`}>
          {verdict.engine} {ENGINE_SHORT[verdict.engine]}
        </span>
        {verdict.engine_reason}
      </p>

      {verdict.reason && <p className="assess-reason">{verdict.reason}</p>}
      {verdict.criteria_reference && <p className="assess-source">기준 · {verdict.criteria_reference}</p>}
      {verdict.recommendation && <p className="assess-recommend">{verdict.recommendation}</p>}

      {verdict.missing_fields.length > 0 && (
        <p className="assess-missing">
          <strong>넣으면 답이 나온다</strong> · {verdict.missing_fields.join(", ")}
        </p>
      )}
      {verdict.flags.map((flag) => (
        <p className="assess-flag" key={flag}>
          {flag}
        </p>
      ))}

      <ReferenceBlock verdict={verdict} />
    </article>
  );
}

function MatrixCard({ risk }: { risk: DiseaseRisk }) {
  return (
    <article className={`assess-card assess-matrix ${LEVEL_CLASS[risk.risk_level]}`}>
      <header>
        <h3>{risk.category}</h3>
        <LevelBadge level={risk.risk_level} />
      </header>
      <p className="assess-substatus">{risk.sub_status}</p>
      <p className="assess-label">{risk.display_label}</p>

      {risk.contributors.length > 0 && (
        <ul className="assess-contributors">
          {risk.contributors.map((c) => (
            <li key={c.key} className={`weight-${c.weight}`}>
              <span className="assess-contrib-label">{c.label}</span>
              <span className="assess-contrib-detail">{c.detail}</span>
              <span className="assess-contrib-effect">{c.effect}</span>
              <span className="assess-muted">
                {c.source}
                {c.causal === true && " · 인과 근거 있음"}
                {c.causal === false && " · 따져봤더니 인과는 아니었다"}
              </span>
            </li>
          ))}
        </ul>
      )}
      {risk.missing_fields.length > 0 && (
        <p className="assess-missing">
          <strong>못 본 값</strong> · {risk.missing_fields.join(", ")}
        </p>
      )}
      {risk.recommendation && <p className="assess-recommend">{risk.recommendation}</p>}
    </article>
  );
}

function byLevel<T>(items: T[], level: (item: T) => RiskLevel): T[] {
  return [...items].sort((a, b) => LEVEL_ORDER.indexOf(level(a)) - LEVEL_ORDER.indexOf(level(b)));
}

export function AssessmentPage() {
  const { runtime, profiles } = useLocalDomain();
  const [values, setValues] = useState<Record<string, string>>({});
  const [result, setResult] = useState<AssessmentSummaryData>();
  const [error, setError] = useState<string>();
  const [working, setWorking] = useState(false);
  const [profileId, setProfileId] = useState<string>();
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [saved, setSaved] = useState<string>();
  const [keeping, setKeeping] = useState(false);

  // 프로필을 고르지 않았으면 첫 구성원으로 둔다. 대부분 본인 하나다.
  const activeProfileId = profileId ?? profiles[0]?.id;

  const reloadSnapshots = useCallback(async () => {
    if (!runtime || !activeProfileId) return;
    setSnapshots(await listSnapshots(runtime, activeProfileId));
  }, [runtime, activeProfileId]);

  // 취소 깃발을 두는 이유가 둘이다. 하나, 프로필을 빠르게 바꾸면 먼저 띄운 조회가
  // 늦게 돌아와 **다른 사람의 스냅샷을 덮어쓸** 수 있다. 둘, 조기 반환에서 setState 를
  // 동기로 부르면 연쇄 렌더가 된다(`react-hooks/set-state-in-effect`).
  useEffect(() => {
    if (!runtime || !activeProfileId) {
      return;
    }
    let cancelled = false;
    void listSnapshots(runtime, activeProfileId).then((found) => {
      if (!cancelled) setSnapshots(found);
    });
    return () => {
      cancelled = true;
    };
  }, [runtime, activeProfileId]);

  // `keeping` 이 없으면 버튼을 두 번 누르면 **같은 시점이 두 벌 저장된다.** 몇 밀리초
  // 차이로 나란히 선 두 점은 그래프에서 뜻이 없고, 지우는 화면도 아직 없다.
  const keep = useCallback(async () => {
    if (!runtime || !activeProfileId || !result || keeping) return;
    setSaved(undefined);
    setKeeping(true);
    try {
      await saveSnapshot(runtime, activeProfileId, values, result);
      await reloadSnapshots();
      setSaved("이 시점을 기록에 남겼습니다. 기기 안에만 저장됩니다.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "기록 저장에 실패했습니다.");
    } finally {
      setKeeping(false);
    }
  }, [runtime, activeProfileId, result, values, reloadSnapshots, keeping]);

  // 최근 창만 그린다. 이유는 `TREND_WINDOW` 설명 참조 — 보관함에는 다 남아 있다.
  const recent = useMemo(() => snapshots.slice(-TREND_WINDOW), [snapshots]);
  const series = useMemo(() => buildSeries(recent), [recent]);
  const tracks = useMemo(() => buildLevelTracks(recent), [recent]);
  const diseaseNames = useMemo(
    () => Object.fromEntries((result?.verdicts ?? []).map((v) => [v.key, v.name])),
    [result],
  );

  const missingRequired = useMemo(
    () => REQUIRED_FIELDS.filter((name) => !values[name]),
    [values],
  );
  const labsFilled = useMemo(() => LAB_FIELDS.filter((name) => values[name]).length, [values]);

  const setField = useCallback((name: string, value: string) => {
    setValues((prev) => ({ ...prev, [name]: value }));
  }, []);

  const submit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      setError(undefined);
      // 새로 판정했으면 지난 저장 안내를 지운다. 안 지우면 값을 바꿔 다시 판정한
      // 뒤에도 "기록에 남겼습니다"가 남아, 방금 것이 저장된 줄로 읽힌다.
      setSaved(undefined);
      setWorking(true);
      try {
        const data = await serverApiClient.assessSummary<AssessmentSummaryData>(toRequestBody(values));
        setResult(data);
      } catch (cause) {
        // 422 는 어느 필드가 왜 틀렸는지를 details 에 담아 온다. 통째로 "실패"라고
        // 쓰면 사용자가 고칠 수 없다.
        if (cause instanceof ServerApiError) {
          const detail = cause.details ? ` (${JSON.stringify(cause.details)})` : "";
          setError(`${cause.message}${detail}`);
        } else {
          setError("판정 요청이 실패했습니다.");
        }
      } finally {
        setWorking(false);
      }
    },
    [values],
  );

  // 정렬을 렌더마다 하면 **입력창에 글자 하나 칠 때마다** 스무 장 넘는 카드를 다시
  // 세운다. 배열이 매번 새로 생겨 아래쪽 memo 도 전부 무효가 된다.
  const verdicts = useMemo(() => (result ? byLevel(result.verdicts, (v) => v.risk_level) : []), [result]);
  const matrix = useMemo(
    () => (result ? byLevel(Object.values(result.disease_risks), (r) => r.risk_level) : []),
    [result],
  );

  return (
    <section className="assess-page">
      <header className="assess-intro">
        <h1>만성질환 위험 판정</h1>
        <p>
          필수 다섯 개만 채우면 판정이 나옵니다. 검진결과지 수치를 넣을수록 답하는 칸이 늘고,{" "}
          <strong>넣은 값이 있는 질환은 추정이 아니라 학회 기준 대조로 넘어갑니다.</strong>
        </p>
      </header>

      <form className="assess-form" onSubmit={submit}>
        {FIELD_GROUPS.map((group) => (
          <fieldset key={group.key} className="assess-group">
            <legend>{group.title}</legend>
            {group.note && <p className="assess-group-note">{group.note}</p>}
            <div className="assess-fields">
              {group.fields.map((field) => (
                <label key={field.name} className="assess-field">
                  <span className="assess-field-label">
                    {field.label}
                    {field.required && <em aria-label="필수"> *</em>}
                    {field.unit && <span className="assess-unit"> {field.unit}</span>}
                  </span>
                  {field.kind === "number" && (
                    <input
                      type="number"
                      inputMode="decimal"
                      min={field.min}
                      max={field.max}
                      step={field.step ?? 1}
                      value={values[field.name] ?? ""}
                      onChange={(event) => setField(field.name, event.target.value)}
                      required={field.required}
                    />
                  )}
                  {field.kind === "select" && (
                    <select
                      value={values[field.name] ?? ""}
                      onChange={(event) => setField(field.name, event.target.value)}
                      required={field.required}
                    >
                      <option value="">선택 안 함</option>
                      {field.options?.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  )}
                  {field.kind === "bool" && (
                    <select
                      value={values[field.name] ?? ""}
                      onChange={(event) => setField(field.name, event.target.value)}
                    >
                      <option value="">선택 안 함</option>
                      <option value="true">예</option>
                      <option value="false">아니오</option>
                    </select>
                  )}
                  {field.hint && <span className="assess-hint">{field.hint}</span>}
                </label>
              ))}
            </div>
          </fieldset>
        ))}

        <div className="assess-submit">
          <button type="submit" disabled={working || missingRequired.length > 0}>
            {working ? "판정 중…" : "판정하기"}
          </button>
          <p className="assess-muted">
            {missingRequired.length > 0
              ? `필수 ${missingRequired.length}개가 남았습니다.`
              : `검사값 ${labsFilled}개를 넣었습니다.`}
          </p>
        </div>
      </form>

      {error && (
        <p className="alert error-alert" role="alert">
          {error}
        </p>
      )}

      {result && (
        <section className="assess-result">
          <header className="assess-summary">
            <h2>판정 요약</h2>
            <ul>
              <li>
                <strong>
                  {result.summary.evaluated} / {result.summary.total}
                </strong>{" "}
                칸 판정 · 최고 등급 <LevelBadge level={result.summary.highest_level} />
              </li>
              <li>
                엔진별 —{" "}
                {Object.entries(result.summary.by_engine)
                  .map(([engine, count]) => `${engine} ${count}칸`)
                  .join(" · ")}
              </li>
              <li>
                수치가 가리키는 질환 <strong>{result.summary.matrix_evaluated}</strong> /{" "}
                {result.summary.matrix_total} 칸
              </li>
              <li>
                입력 {result.inputs_provided} / {result.inputs_total} · BMI {result.bmi}
              </li>
            </ul>
            {!result.model_available && (
              <p className="alert error-alert">예측 모델이 적재되지 않아 규칙·공식으로만 판정했습니다.</p>
            )}

            <div className="assess-keep">
              {profiles.length === 0 ? (
                <p className="assess-muted">
                  변화 추이를 남기려면 먼저 <strong>가족 홈</strong>에서 구성원을 등록해 주세요. 판정은 지금도 보이지만
                  시점을 이을 자리가 없습니다.
                </p>
              ) : (
                <>
                  <label className="assess-field">
                    <span className="assess-field-label">누구의 기록으로</span>
                    <select value={activeProfileId ?? ""} onChange={(event) => setProfileId(event.target.value)}>
                      {profiles.map((profile) => (
                        <option key={profile.id} value={profile.id}>
                          {profile.displayName}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button type="button" onClick={keep} disabled={keeping}>
                    {keeping ? "저장 중…" : "이 시점을 기록에 남기기"}
                  </button>
                  <p className="assess-muted">
                    입력값과 등급을 <strong>기기 안 암호화 보관함</strong>에만 저장합니다. 서버는 판정을 저장하지
                    않습니다.
                  </p>
                </>
              )}
              {saved && <p className="alert success-alert">{saved}</p>}
            </div>
          </header>

          <h2 className="assess-axis-title">
            영역별 판정 <span className="assess-muted">여러 수치 → 이 장기의 현재 상태</span>
          </h2>
          <div className="assess-cards">
            {verdicts.map((verdict) => (
              <VerdictCard key={verdict.key} verdict={verdict} />
            ))}
          </div>

          <h2 className="assess-axis-title">
            수치가 가리키는 질환 <span className="assess-muted">수치 하나 → 여러 질환의 앞날</span>
          </h2>
          <p className="assess-axis-note">
            위 판정의 전치입니다. 같은 질환이 양쪽에 나올 수 있고 뜻이 다릅니다 — γ-GTP 는 간 영역에서 읽히면서 제2형
            당뇨 발생도 예측하고, 알부민뇨는 eGFR 과 독립적으로 심혈관 사망을 예측합니다. 장기별로만 묶어 읽으면 이
            화살표들이 보이지 않습니다.
          </p>
          <div className="assess-cards">
            {matrix.map((risk) => (
              <MatrixCard key={risk.category} risk={risk} />
            ))}
          </div>

          {snapshots.length > 0 && (
            <>
              <h2 className="assess-axis-title">
                추적 대시보드 <span className="assess-muted">같은 사람 · 다른 시점</span>
              </h2>
              <p className="assess-axis-note">
                그래프의 확률은 <strong>발병 가능성이 아니라 "지금 재면 기준을 넘을 가능성"</strong>입니다. 그래서
                여기서는 확률선을 그리지 않고 <strong>입력한 수치 자체</strong>와 <strong>등급의 변화</strong>를
                겹칩니다. 등급은 그날 계산한 값을 그대로 남긴 것입니다 — 나중에 재채점하면 그날 본 화면과 달라집니다.
              </p>
              <TrendChart
                series={series}
                tracks={tracks}
                names={diseaseNames}
                dates={recent.map((s) => s.recordedAt)}
                total={snapshots.length}
              />
            </>
          )}

          <footer className="assess-disclaimers">
            {result.disclaimers.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </footer>
        </section>
      )}
    </section>
  );
}
