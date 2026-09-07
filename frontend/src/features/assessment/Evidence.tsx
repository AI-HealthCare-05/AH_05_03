/**
 * ML 참고 근거 한 벌 — 예측 데모(`/api/demo`)의 결과 카드 본문을 옮긴 것.
 *
 * ## 왜 컴포넌트 하나로 뽑았나
 *
 * 같은 근거를 **판정 카드**와 **자세히 보기**가 각자 그리고 있었고, 각자 다른 값을
 * 크게 띄웠다. 실측(52세 남 · 118/74 · 이상지질 프리셋)에서 고혈압 하나에 이렇게
 * 나왔다.
 *
 *     판정 카드 배지        정상      E1 규칙엔진 · 측정 118/74
 *     판정 카드 참고 확률   27.1%     ML 원확률
 *     자세히 보기 큰 숫자   50.2%     규칙 앵커 비율 ← 다른 스케일
 *     자세히 보기 배지      주의      의학 4단계    ← 판정과 모순
 *     먼저 볼 세 가지 배지  정상 범위  또 다른 표기
 *
 * `medical.level` 이 "주의" 인 이유는 그 값이 **집단 통계**라서다 — ML 확률 27%
 * 구간의 NHANES 응답자 중 50.2%가 규칙 기준을 넘었다는 뜻이고, 이 사람의 실측은
 * 정상이다. 집단 비율을 개인 배지로 쓰면 측정과 부딪힌다.
 *
 * 그래서 규칙을 둘로 못 박았다.
 *
 * 1. **배지는 `risk_level` 5단계 하나뿐이다.** `medical.level` 은 배지가 되지 않고
 *    근거 문장 안에서만 산다.
 * 2. **ML 값은 정본 엔진의 답과 같은 자리에 놓지 않는다.** 검사값으로 판정된 칸에서
 *    ML 확률은 밀려난 값이므로(`superseded_by`) 접이 안으로 내린다.
 *
 * 이 파일이 그 근거 블록의 유일한 구현이고, 카드와 자세히 보기가 같이 쓴다. 두 벌로
 * 두면 한쪽만 고쳐지고 화면은 다시 갈라진다.
 */

import type { DiseaseVerdict, MedicalRisk } from "./contracts";
import { FIELD_LABELS } from "./fields";

/** `app/services/risk.py` 의 `MEDICAL_LEVELS` 와 같은 경계여야 한다. 거기가 정본이다. */
const MED_LEVELS = ["낮음", "관심", "주의", "높음"] as const;
const MED_EDGES = [25, 50, 75];

export function medTone(level: string): string {
  return `lv${Math.max(0, MED_LEVELS.indexOf(level as (typeof MED_LEVELS)[number]))}`;
}

/**
 * 규칙 엔진 5단계의 한글 이름. 서버는 `CAUTION` 처럼 코드로 보낸다.
 *
 * 화면에 코드를 그대로 띄우면 배지에 쓰는 "주의" 와 같은 값인지 알 수 없다.
 */
const LEVEL_NAME: Record<string, string> = {
  INSUFFICIENT_DATA: "판정 불가",
  NORMAL: "정상",
  CAUTION: "주의",
  HIGH: "높음",
  VERY_HIGH: "매우 높음",
};

/** 큰 숫자의 소수점 아래를 작게 — 자릿수가 흔들려도 시선이 정수부에 머문다. */
export function BigNumber({ value }: { value: number }) {
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
export function Gauge({ medical }: { medical: MedicalRisk }) {
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

export interface ModelSpec {
  target: string;
  tier: string;
  required_inputs: string[];
  optional_inputs: string[];
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

/**
 * ML 근거 한 벌. **정본이 아닐 때는 그 사실을 먼저 적는다.**
 *
 * `superseded_by` 가 있으면 이 확률은 밀려난 값이다. 그 표시 없이 큰 숫자를 띄우면
 * 위 배지와 다른 말을 하는 것으로 읽힌다 — 바로 이 화면이 겪던 문제다.
 */
export function Evidence({
  verdict,
  values,
  models,
}: {
  verdict: DiseaseVerdict;
  values: Record<string, string>;
  models: ModelSpec[];
}) {
  const ref = verdict.reference;
  if (!ref || ref.probability === null || ref.probability === undefined) return null;
  const medical = ref.medical;
  const ignored = ignoredInputs(verdict.key, ref.tier, values, models);
  const percentile = ref.peer_percentile;
  const superseded = Boolean(verdict.superseded_by);

  return (
    <div className="assess-evidence">
      <p className="detail-meta">
        {superseded ? (
          <>
            아래는 <strong>밀려난 ML 추정</strong>입니다. 위 판정은 측정값으로 나왔고, 이 확률은 검사 전 선별용이라
            같은 뜻이 아닙니다.
          </>
        ) : (
          <>
            <strong>ML 시드 앙상블</strong> 추정입니다 — 발병 예측이 아니라 지금 검사받으면 기준을 넘을 가능성입니다.
          </>
        )}
        {ref.tier === "lab" ? " 검사값을 써서 정밀형으로 채점했습니다." : " 검사값 없이 일반형으로 채점했습니다."}
      </p>

      <div className="detail-risk">
        <strong>
          <BigNumber value={ref.probability} />
        </strong>
        <span className="assess-muted">모델 확률</span>
      </div>

      {medical ? (
        <>
          <Gauge medical={medical} />
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
          <p className="detail-cite">
            {medical.anchored_on_rule_engine
              ? "규칙 엔진(국내 학회 임계값)을 같은 확률대의 NHANES 응답자에게 실제로 돌려서 센 값입니다. 이 사람의 측정값이 아니라 같은 점수를 받은 집단의 비율입니다."
              : "모델 확률 자체가 그 비율입니다 — 라벨이 곧 의학 기준이고 보정을 거쳤습니다."}
          </p>
        </>
      ) : null}

      {percentile !== null && percentile !== undefined ? (
        <p className="detail-meta">
          {ref.peer_group} 중 상위 {(100 - percentile).toFixed(0)}%
          {ref.peer_ratio !== null && ref.peer_ratio !== undefined ? ` (동년배 평균의 ${ref.peer_ratio}배)` : ""} —
          나이가 많을수록 유병률이 오르므로 이 값으로 안심하면 안 됩니다. 그래서 등급에는 쓰지 않습니다.
        </p>
      ) : null}

      <AnchorLine verdict={verdict} />
      <AccuracyLine verdict={verdict} />

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
          <strong>
            {verdict.name} 모델이 쓰지 않은 입력 {ignored.length}개
          </strong>
          <br />
          {ignored.join(" · ")} — 값을 넣어도 이 확률에는 반영되지 않습니다.
        </p>
      ) : null}
    </div>
  );
}
