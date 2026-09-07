/**
 * 자세히 보기 — 예측 데모(`/api/demo`)의 결과 화면을 판정 결과 위로 옮긴 것.
 *
 * 왜 판정 카드로는 부족했나
 * -------------------------
 * 카드와 `VerdictDetail` 은 **한 질환**의 근거를 보여준다. 데모가 더 갖고 있던 것은
 * 셋이다.
 *
 * 1. **열 장을 한 화면에 세운 요약 타일.** 카드를 스크롤하며 비교하는 대신 한눈에
 *    본다. 경보 구간만 테두리로 띄우고 나머지는 눈에 걸리지 않게 둔다 — 열 장이
 *    전부 강조되면 아무것도 강조가 아니다.
 * 2. **의학 기준 게이지.** 등급 배지는 "주의" 라고만 말하는데, 눈금이 실제로 갈리는
 *    25·50·75% 위에 내 위치와 전체 평균을 같이 찍으면 그 "주의" 가 경계에 걸친
 *    것인지 한참 넘은 것인지 보인다.
 * 3. **이 모델이 받고도 쓰지 않은 입력.** `/predictions/model-info` 의 입력 목록으로
 *    계산하므로 재학습해서 입력이 바뀌면 화면도 따라 바뀐다. 고혈압 모델이 혈압을
 *    안 쓴다는 사실(라벨 누출 차단)이 여기서만 눈에 보인다.
 *
 * 데이터는 어디서 오나
 * --------------------
 * **`/assessments/summary` 응답 하나로 끝낸다.** 데모는 `/predictions/risk` 와
 * `/assessments/rules` 를 따로 불러 합쳤는데, 같은 입력을 두 번 보내면 두 답이 갈릴
 * 수 있다. 대신 서버가 `verdict.reference.medical` 로 등급 묶음 전체를 싣게 했다
 * (`app/services/assessment.py` 의 `_ml_reference`).
 *
 * 모델 입력 목록만 `/predictions/model-info` 를 한 번 더 부른다. 그건 사용자 입력과
 * 무관한 배포 메타데이터라 왕복이 갈릴 일이 없고, 실패하면 그 블록만 빠진다.
 */

import { useEffect, useState } from "react";

import { serverApiClient } from "../../shared/api/serverApiClient";
import { Modal } from "../../shared/ui/Modal";
import type { AssessmentSummaryData, DiseaseVerdict, MedicalRisk } from "./contracts";
import { FIELD_LABELS } from "./fields";

/** `MEDICAL_LEVELS` 와 같은 경계여야 한다 — 정본은 `app/services/risk.py` 다. */
const MED_LEVELS = ["낮음", "관심", "주의", "높음"] as const;
const MED_EDGES = [25, 50, 75];

function medTone(level: string): string {
  return `lv${Math.max(0, MED_LEVELS.indexOf(level as (typeof MED_LEVELS)[number]))}`;
}

/** 큰 숫자의 소수점 아래를 작게 — 자릿수가 흔들려도 시선이 정수부에 머문다. */
function BigNumber({ value }: { value: number }) {
  const [whole, fraction] = (value * 100).toFixed(1).split(".");
  return (
    <>
      {whole}
      <small>.{fraction}%</small>
    </>
  );
}

/**
 * 의학 기준 축. 눈금은 등급이 실제로 갈리는 25·50·75%에 둔다 — 눈금과 판정이
 * 어긋나면 게이지가 거짓말을 한다.
 */
function Gauge({ medical }: { medical: MedicalRisk }) {
  const pos = Math.max(0, Math.min(100, medical.rate * 100));
  const widths = [MED_EDGES[0], MED_EDGES[1] - MED_EDGES[0], MED_EDGES[2] - MED_EDGES[1], 100 - MED_EDGES[2]];
  const baseline =
    medical.baseline === null || medical.baseline === undefined
      ? undefined
      : Math.max(0, Math.min(100, medical.baseline * 100));
  return (
    <>
      <div className="detail-gauge" aria-hidden="true">
        <i style={{ width: `${pos}%` }} className={medTone(medical.level)} />
        {MED_EDGES.map((edge) => (
          <u key={edge} style={{ left: `${edge}%` }} />
        ))}
        {baseline !== undefined && <em style={{ left: `${baseline}%` }} />}
        <b style={{ left: `calc(${pos}% - 2px)` }} />
      </div>
      <div className="detail-zones" aria-hidden="true">
        {widths.map((width, index) => (
          <span key={MED_LEVELS[index]} style={{ flex: `0 0 ${width}%` }}>
            {MED_LEVELS[index]}
          </span>
        ))}
      </div>
    </>
  );
}

/**
 * 이 카드의 숫자를 얼마나 믿어도 되는가. 카드마다 다르다 — 같은 화면에 AUROC
 * 0.87 짜리와 0.70 짜리가 나란히 있는데 그 사실을 안 적으면 둘이 같아 보인다.
 */
function AccuracyLine({ verdict }: { verdict: DiseaseVerdict }) {
  const a = verdict.reference?.accuracy;
  if (!a) return null;
  const tone = a.headline_auroc >= 0.8 ? "good" : a.headline_auroc >= 0.7 ? "ok" : "weak";
  return (
    <>
      <div className="detail-acc">
        <span className="k">정확도</span>
        <span className="n">{a.headline_auroc.toFixed(3)}</span>
        <span className={`assess-badge ${tone}`}>{a.grade}</span>
        <span>{a.measured_on === "미진단자" ? "미진단자 기준" : "전체 기준"} AUROC</span>
        {a.alert_ppv !== null && a.alert_ppv !== undefined ? (
          <>
            <span className="sep">|</span>
            <span>
              상위 10% 경보 적중 <strong>{Math.round(a.alert_ppv * 100)}%</strong>
              {a.alert_sensitivity !== null && a.alert_sensitivity !== undefined ? (
                <>
                  {" "}
                  · 실제 해당자 <strong>{Math.round(a.alert_sensitivity * 100)}%</strong> 발견
                </>
              ) : null}
            </span>
          </>
        ) : null}
      </div>
      <p className="detail-cite">
        AUROC 는 "100명 중 몇 명을 맞힌다"가 아닙니다. 해당자와 비해당자를 한 명씩 뽑았을 때 해당자에게 더 높은
        점수를 줄 확률입니다.
        {a.auroc_undiagnosed !== null && a.auroc_undiagnosed !== undefined ? (
          <> 이미 진단받은 사람을 맞히는 건 쉬우므로 그들을 뺀 값을 씁니다 (라벨 전체 기준은 {a.auroc.toFixed(3)}).</>
        ) : null}{" "}
        {a.holdout_cycle ?? ""} 주기
        {a.holdout_n ? ` ${a.holdout_n.toLocaleString()}명` : ""} 홀드아웃 측정.
      </p>
    </>
  );
}

/**
 * 규칙 엔진 5단계의 한글 이름. 서버는 `CAUTION` 처럼 코드로 보낸다.
 *
 * **화면에 코드를 그대로 띄우면 안 된다.** `rule_anchor.positive_from` 은 "이 등급
 * 이상을 기준 초과로 셌다" 는 뜻인데, 그걸 `CAUTION` 으로 두면 한국어 화면에 영어
 * 상수가 섞이고 무엇보다 배지에 쓰는 "주의" 와 같은 값인지 알 수 없다.
 */
const LEVEL_NAME: Record<string, string> = {
  INSUFFICIENT_DATA: "판정 불가",
  NORMAL: "정상",
  CAUTION: "주의",
  HIGH: "높음",
  VERY_HIGH: "매우 높음",
};

/** 확률을 읽을 자 — 이 확률대를 실제로 검사하면 학회 기준으로 몇 %가 넘었는가. */
function AnchorLine({ verdict }: { verdict: DiseaseVerdict }) {
  const a = verdict.reference?.rule_anchor;
  if (!a) {
    return (
      <p className="detail-cite">
        이 질환은 규칙 엔진에 대응 영역이 없어 학회 기준 대조를 붙이지 못했습니다. 위 비율로만 읽으십시오.
      </p>
    );
  }
  const people = Math.round(a.rule_positive_rate * 100);
  const average =
    a.overall_rate === null || a.overall_rate === undefined ? undefined : Math.round(a.overall_rate * 100);
  const tone =
    a.lift === null || a.lift === undefined ? "low" : a.lift >= 1.3 ? "high" : a.lift >= 1.05 ? "moderate" : "low";
  return (
    <p className="detail-peer">
      이 확률대의 <strong>100명</strong>을 실제로 검사했을 때 <span className={`assess-badge ${tone}`}>{people}명</span>
      이 {a.society} 기준 '{LEVEL_NAME[a.positive_from] ?? a.positive_from}' 이상이었습니다.
      {average !== undefined && a.lift !== null && a.lift !== undefined ? (
        <span className="assess-muted">
          {" "}
          (같은 검사를 받은 사람 전체 평균 {average}명 · <strong>{a.lift}배</strong>)
        </span>
      ) : null}
    </p>
  );
}

/**
 * 이 모델이 받고도 쓰지 않은 항목.
 *
 * `dm` 은 혈압을 쓰지만 `htn` 은 쓰지 않는다 — 혈압이 고혈압 라벨을 정의하므로
 * 학습에서 차단됐다(`modeling/targets.py`). 그 사실이 화면 어디에도 안 보이면
 * 사용자는 혈압을 넣었으니 고혈압 확률이 정확해졌다고 믿는다.
 *
 * **키·체중은 세지 않는다.** 그대로 모델에 가지 않고 BMI 하나로 합쳐 들어가므로
 * "안 쓴 입력" 으로 세면 거짓말이 된다.
 */
const NOT_MODEL_INPUTS = new Set([
  "height_cm",
  "weight_kg",
  // 규칙 엔진·공개 공식만 읽는 값. ML 번들에는 애초에 없다.
  "ogtt_2h",
  "is_fasting",
  "non_hdl_c",
  "has_diabetes",
  "has_hypertension",
  "has_ascvd_history",
]);

function ignoredInputs(
  target: string | undefined,
  tier: string | null | undefined,
  values: Record<string, string>,
  models: ModelSpec[],
): string[] {
  if (!target || models.length === 0) return [];
  const spec =
    models.find((m) => m.target === target && m.tier === (tier ?? "basic")) ??
    models.find((m) => m.target === target);
  if (!spec) return [];
  const used = new Set([...spec.required_inputs, ...spec.optional_inputs]);
  const entered = Object.entries(values)
    .filter(([name, value]) => value !== "" && !NOT_MODEL_INPUTS.has(name))
    .map(([name]) => name);
  if (values.height_cm && values.weight_kg) entered.push("bmi");
  return entered.filter((name) => !used.has(name)).map((name) => FIELD_LABELS[name] ?? name);
}

interface ModelSpec {
  target: string;
  tier: string;
  required_inputs: string[];
  optional_inputs: string[];
}

/** 질환 하나의 자세히 블록. ML 참고값이 없으면 그리지 않는다. */
function ConditionDetail({
  verdict,
  values,
  models,
}: {
  verdict: DiseaseVerdict;
  values: Record<string, string>;
  models: ModelSpec[];
}) {
  const ref = verdict.reference;
  const medical = ref?.medical;
  if (!ref || ref.probability === null || ref.probability === undefined) return null;
  const ignored = ignoredInputs(verdict.key, ref.tier, values, models);
  const percentile = ref.peer_percentile;

  return (
    <section className="detail-condition">
      <h4>
        {verdict.name}
        {ref.tier === "lab" && <span className="assess-badge low">정밀형</span>}
      </h4>

      {medical ? (
        <>
          <div className="detail-risk">
            <strong>
              <BigNumber value={medical.rate} />
            </strong>
            <span className={`assess-badge ${medTone(medical.level)}`}>{medical.level}</span>
          </div>
          <p className="detail-peer">
            이 점수대의 <strong>100명</strong> 중 <strong>{Math.round(medical.rate * 100)}명</strong>이 {medical.basis}
            입니다.
            {medical.baseline !== null && medical.baseline !== undefined ? (
              <span className="assess-muted">
                {" "}
                같은 검사를 받은 사람 전체는 {Math.round(medical.baseline * 100)}명
                {medical.lift !== null && medical.lift !== undefined ? (
                  <>
                    {" "}
                    · <strong>{medical.lift}배</strong>
                  </>
                ) : null}
              </span>
            ) : null}
          </p>
          <Gauge medical={medical} />
          <p className="detail-cite">
            {medical.anchored_on_rule_engine
              ? "규칙 엔진(국내 학회 임계값)을 같은 확률대의 NHANES 응답자에게 실제로 돌려서 센 값입니다."
              : "모델 확률 자체가 그 비율입니다 — 라벨이 곧 의학 기준이고 보정을 거쳤습니다."}
          </p>
        </>
      ) : (
        <div className="detail-risk">
          <strong>
            <BigNumber value={ref.probability} />
          </strong>
        </div>
      )}

      {percentile !== null && percentile !== undefined ? (
        <p className="detail-meta">
          참고 · {ref.peer_group} 중 상위 {(100 - percentile).toFixed(0)}%
          {ref.peer_ratio !== null && ref.peer_ratio !== undefined ? ` (동년배 평균의 ${ref.peer_ratio}배)` : ""} —
          나이가 많을수록 유병률이 오르므로 이 값으로 안심하면 안 됩니다.
        </p>
      ) : null}

      <AnchorLine verdict={verdict} />
      <AccuracyLine verdict={verdict} />

      <details className="detail-tech">
        <summary>모델 내부 값</summary>
        <p className="detail-meta">
          모델 확률 {(ref.probability * 100).toFixed(1)}%
          {ref.peer_median !== null && ref.peer_median !== undefined
            ? ` · ${ref.peer_group} 중간값 ${(ref.peer_median * 100).toFixed(1)}%`
            : ""}
        </p>
        {verdict.criteria_reference ? <p className="detail-cite">{verdict.criteria_reference}</p> : null}
        {ref.top_factors && ref.top_factors.length > 0 ? (
          <>
            <p className="detail-meta">기여가 큰 항목 (로그오즈)</p>
            <ul className="detail-factors">
              {ref.top_factors.map((factor) => (
                <li key={factor.feature}>
                  {FIELD_LABELS[factor.feature] ?? factor.feature}{" "}
                  <span className="num">
                    {factor.contribution > 0 ? "+" : ""}
                    {factor.contribution.toFixed(2)}
                  </span>
                </li>
              ))}
            </ul>
            <p className="detail-cite">
              개선 조언으로 그대로 읽으면 안 됩니다 — 단면 데이터에서는 금연·절주가 위험을 올리는 방향으로 나옵니다
              (이미 아픈 사람이 끊었기 때문입니다).
            </p>
          </>
        ) : null}
        {ignored.length > 0 ? (
          <p className="detail-ignored">
            <strong>{verdict.name} 모델이 쓰지 않은 입력 {ignored.length}개</strong>
            <br />
            {ignored.join(" · ")} — 값을 넣어도 이 확률에는 반영되지 않습니다.
          </p>
        ) : null}
      </details>
    </section>
  );
}

export function DetailReport({
  result,
  values,
  onClose,
}: {
  result: AssessmentSummaryData;
  values: Record<string, string>;
  onClose: () => void;
}) {
  const [models, setModels] = useState<ModelSpec[]>([]);

  // 배포 메타데이터라 사용자 입력과 무관하다. 실패하면 "안 쓴 입력" 블록만 빠진다 —
  // 없는 것을 없다고 말할 수 없을 뿐이고, 나머지 근거는 그대로 나간다.
  useEffect(() => {
    let cancelled = false;
    void serverApiClient
      .modelInfo<{ models: ModelSpec[] }>()
      .then((data) => {
        if (!cancelled) setModels(data.models ?? []);
      })
      .catch(() => {
        if (!cancelled) setModels([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const scored = result.verdicts.filter(
    (verdict) => verdict.reference?.probability !== null && verdict.reference?.probability !== undefined,
  );
  const tier = scored[0]?.reference?.tier;

  return (
    <Modal title="예측 근거 자세히 보기" kicker="ML 시드 앙상블" className="detail-modal" onClose={onClose}>
      <p className="detail-meta">
        BMI {result.bmi} · 입력 {result.inputs_provided}/{result.inputs_total}개 ·{" "}
        {tier === "lab" ? (
          <>
            검사값을 써서 <strong>정밀형</strong>으로 채점했습니다
          </>
        ) : (
          <>
            검사값 없이 <strong>일반형</strong>으로 채점했습니다
          </>
        )}
      </p>

      {/* 열 장을 스크롤하며 비교하는 대신 한 화면에 요약한다. 경보 구간만 테두리로
          띄우고 나머지는 눈에 걸리지 않게 둔다. */}
      <div className="detail-tiles">
        {scored.map((verdict) => {
          const medical = verdict.reference?.medical;
          const flag = medical?.level === "주의" || medical?.level === "높음";
          return (
            <div key={verdict.key} className={flag ? "detail-tile flag" : "detail-tile"}>
              <em>{verdict.name}</em>
              <div className="v">
                <BigNumber value={medical ? medical.rate : (verdict.reference?.probability ?? 0)} />
              </div>
              <span className={`assess-badge ${medical ? medTone(medical.level) : "lv0"}`}>
                {medical?.level ?? verdict.reference?.medical_level ?? "—"}
              </span>
            </div>
          );
        })}
      </div>

      {scored.length === 0 ? (
        <p className="detail-cite">
          ML 번들이 적재되지 않아 확률 근거가 없습니다. 판정은 규칙 엔진과 공개 공식으로만 나왔습니다.
        </p>
      ) : (
        scored.map((verdict) => (
          <ConditionDetail key={verdict.key} verdict={verdict} values={values} models={models} />
        ))
      )}

      <p className="detail-cite">
        여기 숫자는 <strong>발병 예측이 아니라 지금 검사받으면 기준을 넘을 가능성</strong>입니다. 판정 배지는 검사값이
        있는 질환에서 규칙 엔진·공개 공식이 정본이고, 이 확률은 참고로 내려간 값입니다.
      </p>
    </Modal>
  );
}
