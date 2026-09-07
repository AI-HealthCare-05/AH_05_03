/**
 * 판정 결과 카드 — 판정 화면과 기록 화면이 같이 쓴다.
 *
 * 왜 뽑았나
 * ---------
 * 판정 화면에만 있으면 **그때 한 번 보고 끝**이다. 기록으로 남긴 판정을 나중에 열면
 * 등급 이름만 남고 근거·엔진·밀려난 ML 확률이 전부 사라졌다 — 남길 값어치가 있어서
 * 저장했는데 정작 다시 볼 화면이 없었다.
 *
 * 그래서 카드를 여기로 옮기고 두 화면이 같은 것을 그린다. 기록 쪽은 서버에 다시
 * 묻지 않고 **그날 저장한 판정**을 그대로 그린다 — 모델과 기준이 갱신되면 지금
 * 다시 판정한 결과와 달라지므로, 그날 본 화면을 재현하려면 저장본이어야 한다.
 */

import type { DiseaseRisk, DiseaseVerdict, OnsetTrajectory, RiskLevel } from "./contracts";
import { ENGINE_SHORT, LEVEL_LABEL } from "./contracts";
import { Evidence, type ModelSpec } from "./Evidence";
import { DISEASE_MEASURES, FIELD_LABELS, FIELD_UNITS, readableField, readableSentence } from "./fields";
import { briefList, objectParticle, precisionGains } from "./precision";

const LEVEL_CLASS: Record<RiskLevel, string> = {
  VERY_HIGH: "level-very-high",
  HIGH: "level-high",
  CAUTION: "level-caution",
  NORMAL: "level-normal",
  INSUFFICIENT_DATA: "level-unknown",
};

export function LevelBadge({ level }: { level: RiskLevel }) {
  return (
    <span className={`assess-badge ${LEVEL_CLASS[level]}`}>
      {LEVEL_LABEL[level]}
    </span>
  );
}

const percent = (value: number) => `${(value * 100).toFixed(0)}%`;

/**
 * 발병 궤적 — "지금 없다면 앞으로 t년 안에 생길 확률".
 *
 * 선 둘을 같이 그린다. 내 곡선 하나만 있으면 "10년 27%" 가 큰 수인지 보통인지 알 수
 * 없다. 동년배 곡선이 자다. 표는 낭독기와 좁은 화면을 위한 같은 내용이다.
 * 차트 라이브러리를 쓰지 않는 이유는 `TrendChart.tsx` 머리말과 같다.
 */
export function TrajectoryChart({ trajectory }: { trajectory: OnsetTrajectory }) {
  const width = 260;
  const height = 96;
  const pad = { left: 30, right: 10, top: 8, bottom: 20 };
  const years = trajectory.horizons_years;
  const mine = trajectory.onset_probability;
  const peers = trajectory.population_onset_probability;
  const maxYear = years[years.length - 1] ?? 1;
  const ceiling = Math.max(0.1, ...mine, ...peers);
  const x = (year: number) => pad.left + ((width - pad.left - pad.right) * year) / maxYear;
  const y = (value: number) => pad.top + (height - pad.top - pad.bottom) * (1 - value / ceiling);
  const path = (values: number[]) =>
    [`M ${x(0)} ${y(0)}`, ...values.map((v, i) => `L ${x(years[i])} ${y(v)}`)].join(" ");

  return (
    <figure className="assess-trajectory-figure">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="연도별 누적 발병 확률, 나와 동년배">
        <line x1={pad.left} y1={y(0)} x2={width - pad.right} y2={y(0)} className="trajectory-axis" />
        <text x={pad.left - 4} y={y(ceiling) + 4} textAnchor="end" className="trajectory-tick">
          {percent(ceiling)}
        </text>
        <text x={pad.left - 4} y={y(0) + 4} textAnchor="end" className="trajectory-tick">
          0%
        </text>
        <path d={path(peers)} className="trajectory-line is-peer" />
        <path d={path(mine)} className="trajectory-line is-mine" />
        {years.map((year, i) => (
          <g key={year}>
            <circle cx={x(year)} cy={y(mine[i])} r={2.5} className="trajectory-dot is-mine" />
            <text x={x(year)} y={height - 6} textAnchor="middle" className="trajectory-tick">
              {year}년
            </text>
          </g>
        ))}
      </svg>
      <figcaption className="assess-trajectory-legend">
        <span className="legend-mine">나</span>
        <span className="legend-peer">동년배 평균</span>
      </figcaption>
    </figure>
  );
}

export function TrajectoryBlock({ verdict }: { verdict: DiseaseVerdict }) {
  const trajectory = verdict.reference?.trajectory;
  if (!trajectory || trajectory.horizons_years.length === 0) return null;
  const last = trajectory.horizons_years.length - 1;
  return (
    <section className="assess-trajectory">
      <h4>
        앞으로의 발병 가능성{" "}
        <span className="assess-muted">· 동년배의 {trajectory.relative_hazard.toFixed(1)}배</span>
      </h4>
      <TrajectoryChart trajectory={trajectory} />
      <table className="assess-trajectory-table">
        <thead>
          <tr>
            <th scope="col">기간</th>
            {trajectory.horizons_years.map((year) => (
              <th scope="col" key={year}>
                {year}년
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">나</th>
            {trajectory.onset_probability.map((value, i) => (
              <td key={trajectory.horizons_years[i]}>{percent(value)}</td>
            ))}
          </tr>
          <tr>
            <th scope="row">동년배</th>
            {trajectory.population_onset_probability.map((value, i) => (
              <td key={trajectory.horizons_years[i]}>{percent(value)}</td>
            ))}
          </tr>
        </tbody>
      </table>
      <p className="assess-fineprint">
        {trajectory.conditional_on}.{" "}
        {trajectory.truncated_at_age ? `${trajectory.truncated_at_age}세 이후는 자료가 없어 ${trajectory.horizons_years[last]}년까지만 보여요. ` : ""}
        {trajectory.caveats[0]}
      </p>
    </section>
  );
}

/**
 * 카드 앞면의 앞날 한 칸. 궤적이 있는 카드만 — 없는 카드는 이유가 있어서 없는 것이다.
 *
 * 예전에는 **마지막 지평 하나만** 적었다(10년). 5년을 빼 두면 "당장은 어떤가" 를
 * 물어볼 자리가 화면에 없고, 두 숫자 사이의 기울기 — 지금 손대면 달라지는 폭 —
 * 도 사라진다. 지평이 둘뿐이라 둘 다 적어도 한 줄에 들어간다.
 */
export function TrajectoryLine({ verdict }: { verdict: DiseaseVerdict }) {
  const trajectory = verdict.reference?.trajectory;
  if (!trajectory || trajectory.horizons_years.length === 0) return null;
  return (
    <div className="assess-trajectory-line">
      <span className="assess-trajectory-label">새로 생길 확률</span>
      <span className="assess-trajectory-values">
        {trajectory.horizons_years.map((year, i) => (
          <span className="assess-trajectory-step" key={year}>
            <b>{percent(trajectory.onset_probability[i])}</b>
            <small>
              {year}년 뒤
              {trajectory.population_onset_probability?.[i] !== undefined && (
                <span className="assess-muted">
                  {" "}
                  · 동년배 {percent(trajectory.population_onset_probability[i])}
                </span>
              )}
            </small>
          </span>
        ))}
      </span>
    </div>
  );
}

/**
 * 카드마다 다른 "더 넣으면 무엇이 좋아지나".
 *
 * 예전에는 `missing_fields` 한 줄뿐이었고, 그 값은 규칙 엔진이 **단계를 못 정했을
 * 때만** 채워진다. 그래서 이미 판정이 난 열두 장에는 아무것도 안 떴다 — 더 넣을 게
 * 없어서가 아니라, 화면이 ML 쪽을 안 물어봤기 때문이다(`precision.ts` 머리말).
 *
 * 두 줄을 가르는 기준은 **등급이 바뀔 수 있는가** 하나다. 위는 바뀔 수 있고 아래는
 * 확률만 정밀해진다. 섞어 두면 사용자는 어느 쪽인지 알 수 없다.
 */
export function PrecisionHints({
  verdict,
  values,
  models,
}: {
  verdict: DiseaseVerdict;
  values: Record<string, string>;
  models: ModelSpec[];
}) {
  const gain = precisionGains(verdict, values, models);
  const decisive = briefList(gain.decisive);
  const refining = briefList(gain.refining);

  if (!decisive && !refining) {
    // 모델 목록을 못 받았으면(기록 화면·`model-info` 실패) "전부 들어왔다" 고 말할
    // 근거가 없다. 모르는 것을 안다고 적지 않는다.
    if (models.length === 0) return null;
    // 아무 줄도 없으면 카드마다 이 자리의 높이가 달라진다. "없다" 도 정보다 —
    // 사용자가 "내가 뭘 빠뜨렸나" 를 다시 확인하러 폼으로 올라가지 않아도 된다.
    return (
      <p className="assess-need is-done">
        {gain.noModel
          ? "이 질환은 규칙 엔진이 검사값으로 직접 판정해요. 더 넣을 값은 없어요."
          : "이 질환이 쓰는 값은 전부 들어왔어요."}
      </p>
    );
  }

  return (
    <div className="assess-needs">
      {decisive ? (
        <p className="assess-need is-decisive">
          <span className="assess-need-tag">판정</span>
          <span>
            <strong>{decisive}</strong>
            {objectParticle(decisive)} 넣으면 정확해져요
          </span>
        </p>
      ) : null}
      {refining ? (
        <p className="assess-need is-refining">
          <span className="assess-need-tag">예측</span>
          <span>
            <strong>{refining}</strong>
            {objectParticle(refining)} 넣으면 {gain.tierUp ? "정밀형으로 바뀌어요" : "예측이 정밀해져요"}
          </span>
        </p>
      ) : null}
    </div>
  );
}

/**
 * 정본 엔진이 무엇을 보고 그 등급을 냈는가 — 모달에만 있던 블록.
 *
 * `VerdictDetail` 모달을 없애면서 카드 접이로 옮겼다. 모달과 카드가 **같은 것을
 * 두 번** 보여주고 있었다 — 둘 다 `Evidence` 를 그리는데 모달은 그 위에 이 표를
 * 더 얹은 정도였고, 사용자에게는 "눌렀더니 똑같은 게 나온다" 로 읽혔다.
 */
export function VerdictFacts({ verdict }: { verdict: DiseaseVerdict }) {
  const hasAny =
    verdict.engine_reason ||
    verdict.reason ||
    verdict.recommendation ||
    verdict.criteria_reference ||
    verdict.flags.length > 0;
  if (!hasAny) return null;
  return (
    <div className="verdict-facts-block">
      <p className="verdict-facts-title">
        <span className={`assess-engine-tag engine-${verdict.engine.toLowerCase()}`}>
          {ENGINE_SHORT[verdict.engine]}
        </span>
        이 판정의 근거
      </p>
      <dl className="verdict-facts">
        {/* **왜 이 엔진이 정본인가.** 세 엔진이 같이 도는데 답은 하나만 실린다
            (ADR-009). 그 선택의 이유가 화면에 없으면, 카드 앞면의 "ML 12% → 규칙
            엔진 매우 높음" 이 왜 뒤쪽을 따르는지 알 길이 없다. */}
        {verdict.engine_reason ? (
          <>
            <dt>어느 엔진이 왜</dt>
            <dd>{verdict.engine_reason}</dd>
          </>
        ) : null}
        {verdict.reason ? (
          <>
            <dt>무엇을 보고</dt>
            <dd>{readableSentence(verdict.reason)}</dd>
          </>
        ) : null}
        {verdict.recommendation ? (
          <>
            <dt>권하는 것</dt>
            <dd>{verdict.recommendation}</dd>
          </>
        ) : null}
        {verdict.criteria_reference ? (
          <>
            <dt>기준 출처</dt>
            <dd>{verdict.criteria_reference}</dd>
          </>
        ) : null}
      </dl>
      {verdict.flags.map((flag) => (
        <p className="assess-flag" key={flag}>
          {flag}
        </p>
      ))}
    </div>
  );
}

/** 확률·백분위·정확도. 정본이 아니어도 지우지 않는다 — 접어서 둔다. */
export function ReferenceBlock({ verdict }: { verdict: DiseaseVerdict }) {
  const ref = verdict.reference;
  if (!ref || ref.probability === null || ref.probability === undefined)
    return null;
  const percent = (ref.probability * 100).toFixed(1);
  const accuracy = ref.accuracy;
  return (
    // 모달 안이라 접지 않는다. 여기까지 들어온 사람은 근거를 보러 온 것이고,
    // 좁은 카드에서 자리를 아끼려고 접었던 이유가 사라진다.
    <section className="assess-reference">
      <h4>
        {verdict.superseded_by ? "밀려난 ML 예측 " : "ML 예측 근거 "}
        <strong>{percent}%</strong>
        {ref.peer_percentile !== null && ref.peer_percentile !== undefined && (
          <span className="assess-muted">
            {" "}
            · {ref.peer_group} 백분위 {Math.round(ref.peer_percentile)}
          </span>
        )}
      </h4>
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
              <span className="assess-muted">
                {" "}
                ({accuracy.measured_on} 기준)
              </span>
            </dd>
            {accuracy.alert_ppv !== null && (
              <>
                <dt>상위 10% 경보 적중률</dt>
                <dd>
                  {(accuracy.alert_ppv * 100).toFixed(0)}%
                  {accuracy.alert_sensitivity !== null && (
                    <span className="assess-muted">
                      {" "}
                      · 실제 해당자 중{" "}
                      {(accuracy.alert_sensitivity * 100).toFixed(0)}% 를
                      잡아낸다
                    </span>
                  )}
                </dd>
              </>
            )}
          </>
        ) : null}
      </dl>
      <p className="assess-fineprint">
        AUROC 는 "100명 중 몇 명을 맞힌다"가 아니다. 위험한 사람과 아닌 사람을
        한 명씩 뽑았을 때 위험한 쪽에 더 높은 점수를 줄 확률이다. 사용자가
        실제로 겪는 값은 경보 적중률 쪽이다.
      </p>
    </section>
  );
}

/**
 * 등급 막대 — 카드에서 **가장 먼저 눈에 들어와야 하는 것**.
 *
 * 카드 열세 장을 훑을 때 사용자가 실제로 하는 일은 "급한 게 어느 것인가" 하나다.
 * 그런데 예전 카드는 그 답이 오른쪽 위 작은 배지 하나에만 있었고, 나머지 자리를
 * 문단 일곱 개가 채우고 있었다 — 배지 색을 하나하나 확인하며 내려가야 했다.
 *
 * 네 칸을 항상 그리고 해당 칸만 채운다. 채운 칸의 **위치**가 색보다 먼저 읽혀서,
 * 색을 구분하기 어려운 사람도 훑을 수 있다.
 */
const LEVEL_STEPS: { level: RiskLevel; label: string }[] = [
  { level: "NORMAL", label: "정상" },
  { level: "CAUTION", label: "주의" },
  { level: "HIGH", label: "높음" },
  { level: "VERY_HIGH", label: "매우 높음" },
];

export function LevelBar({ level }: { level: RiskLevel }) {
  const at = LEVEL_STEPS.findIndex((step) => step.level === level);
  return (
    <div className="level-bar" aria-hidden="true">
      <div className="level-bar-track">
        {LEVEL_STEPS.map((step, index) => (
          <span
            key={step.level}
            className={index === at ? `level-bar-cell is-at ${LEVEL_CLASS[step.level]}` : "level-bar-cell"}
          />
        ))}
      </div>
      <div className="level-bar-labels">
        {LEVEL_STEPS.map((step, index) => (
          <span key={step.level} className={index === at ? "is-at" : undefined}>
            {step.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * 카드가 크게 띄우는 숫자.
 *
 * 검사값을 넣은 질환은 **그 값**을, 넣지 않아 ML 이 추정한 질환은 **확률**을 띄운다.
 * 둘을 같은 크기로 두면 사용자가 구분하지 못하므로, 추정 쪽에는 `~` 를 붙이고
 * 아래 라벨에 "추정" 이라 적는다.
 */
export function KeyFigures({ verdict, values }: { verdict: DiseaseVerdict; values: Record<string, string> }) {
  const measured = (DISEASE_MEASURES[verdict.key] ?? []).filter((name) => values[name]);

  if (measured.length > 0) {
    return (
      <div className="assess-figures">
        {measured.map((name) => (
          <span className="assess-figure" key={name}>
            <b>{values[name]}</b>
            <small>
              {FIELD_LABELS[name]}
              {FIELD_UNITS[name] ? ` ${FIELD_UNITS[name]}` : ""}
            </small>
          </span>
        ))}
      </div>
    );
  }

  const probability = verdict.reference?.probability;
  if (probability === null || probability === undefined) return null;
  return (
    <div className="assess-figures">
      <span className="assess-figure is-estimate">
        <b>~{(probability * 100).toFixed(0)}%</b>
        <small>추정 · 검사하면 확실해져요</small>
      </span>
      {verdict.reference?.peer_percentile !== null && verdict.reference?.peer_percentile !== undefined ? (
        <span className="assess-figure is-estimate">
          <b>{Math.round(verdict.reference.peer_percentile)}</b>
          <small>{verdict.reference.peer_group} 백분위</small>
        </span>
      ) : null}
    </div>
  );
}

/**
 * 질환 카드.
 *
 * 위에서 아래로 **등급 → 숫자 → 한 줄 설명** 까지가 항상 보이고, 근거·기준 출처·
 * 권고·ML 참고는 모달로 뺐다. 예전에는 일곱 문단이 전부 펼쳐져 있었는데, 열세 장이
 * 나란히 서면 그중 무엇도 읽히지 않는다.
 *
 * **접힘(`<details>`)이 아니라 모달인 이유.** 카드가 격자 안에 있어서, 한 장이
 * 펼쳐지면 같은 줄의 다른 카드까지 키가 늘고 아래 카드가 통째로 밀린다. 읽으려던
 * 자리가 눈앞에서 움직인다.
 */
export function VerdictCard({
  verdict,
  values,
  models = [],
}: {
  verdict: DiseaseVerdict;
  values: Record<string, string>;
  /** `/predictions/model-info` 의 모델 목록. 없으면 "안 쓴 입력" 블록만 빠진다. */
  models?: ModelSpec[];
}) {
  const short = verdict.sub_status || LEVEL_LABEL[verdict.risk_level];
  const enough = verdict.risk_level !== "INSUFFICIENT_DATA";
  const probability = verdict.reference?.probability;
  const hasEvidence = probability !== null && probability !== undefined;

  return (
    <article className={`assess-card ${LEVEL_CLASS[verdict.risk_level]}`}>
      <header>
        <h3>{verdict.name}</h3>
        <LevelBadge level={verdict.risk_level} />
      </header>

      {enough ? <LevelBar level={verdict.risk_level} /> : null}

      {/* **앞면은 정본 엔진의 답만 싣는다.** 어느 엔진이 답했는지를 등급 옆에 붙여야
          아래 접이의 ML 확률과 혼동되지 않는다. 예전에는 이 태그가 "판정 근거" 버튼
          안에 있어서, 카드를 훑는 동안 무엇이 이 등급을 정했는지 알 수 없었다. */}
      {/* **두 엔진을 나란히 놓는다.** ML 이 먼저 열 질환을 훑어 확률을 내고,
          검사값이 있는 칸은 규칙 엔진이 그 위에서 단계까지 확정한다. 예전에는
          확률이 접이 안에만 있어서, 카드를 보는 동안 모델이 무엇을 말했는지
          알 수 없었다 — 두 엔진이 같이 도는데 하나만 보였다. */}
      <div className="assess-engines">
        {probability !== null && probability !== undefined ? (
          <span className="assess-engine-step is-ml">
            <small>ML 예측</small>
            <b>{percent(probability)}</b>
          </span>
        ) : (
          <span className="assess-engine-step is-ml is-none">
            <small>ML 예측</small>
            <b>—</b>
          </span>
        )}
        <span className="assess-engine-arrow" aria-hidden="true">
          →
        </span>
        <span className={`assess-engine-step is-verdict engine-${verdict.engine.toLowerCase()}`}>
          <small>{ENGINE_SHORT[verdict.engine]}</small>
          <b>{readableSentence(short)}</b>
        </span>
      </div>
      <KeyFigures verdict={verdict} values={values} />
      <TrajectoryLine verdict={verdict} />

      <PrecisionHints verdict={verdict} values={values} models={models} />

      {/* **ML 근거를 카드 안에서 펼친다 — 예측 데모의 "모델 내부 값" 자리다.**
          모달로만 두던 때는 같은 값을 두 화면이 각자 그리면서 서로 다른 숫자를 크게
          띄웠다(`Evidence.tsx` 머리말의 실측). 이제 한 컴포넌트가 두 자리에 같은 것을
          낸다.

          격자에서 접이를 펼치면 같은 줄 카드까지 키가 늘어 아래가 밀리는 문제가
          있었다. `.assess-cards` 를 `grid-auto-rows` 없이 `align-items: start` 로
          두어 펼친 카드만 늘어나게 했다(`styles.css`). */}
      {/* **모달을 없애고 여기 하나로 모았다.** 예전에는 카드 접이와 "판정 근거 전체"
          모달이 둘 다 `Evidence` 를 그려서, 눌러도 같은 것이 나왔다. 모달에만 있던
          판정 근거표와 궤적 표를 여기로 옮기고 버튼을 뺐다. */}
      <details className="assess-card-evidence">
        <summary>{verdict.name} 판정 근거 자세히</summary>
        <VerdictFacts verdict={verdict} />
        <TrajectoryBlock verdict={verdict} />
        {hasEvidence ? <Evidence verdict={verdict} values={values} models={models} /> : null}
      </details>
    </article>
  );
}

/**
 * 옛 저장본의 제목을 읽을 수 있게 되돌린다.
 *
 * 서버가 `category` 에 **내부 키를 그대로** 넣던 판이 있었고(`cvd_risk`), 기록 화면은
 * 그날 저장한 판정을 그대로 그린다 — 그래서 지난 기록에는 그 값이 남아 있다.
 * 서버는 고쳤지만(`disease_risk_matrix.risk_title`) 저장본은 못 고치므로 여기서 받는다.
 *
 * 표를 두 벌 두는 값은 치른다. 대안은 저장본을 마이그레이션하는 것인데, 스냅샷은
 * "그날 본 화면" 이라는 게 존재 이유라 손대지 않는 편이 맞다.
 */
const LEGACY_MATRIX_TITLE: Record<string, string> = {
  dm_risk: "당뇨병 위험",
  cvd_risk: "심혈관질환 위험",
  ckd_risk: "만성콩팥병 위험",
  htn_risk: "고혈압 위험",
};

export function MatrixCard({ risk }: { risk: DiseaseRisk }) {
  const title = LEGACY_MATRIX_TITLE[risk.category] ?? risk.category;
  return (
    <article
      className={`assess-card assess-matrix ${LEVEL_CLASS[risk.risk_level]}`}
    >
      <header>
        <h3>{title}</h3>
        <LevelBadge level={risk.risk_level} />
      </header>
      <p className="assess-substatus">{risk.sub_status}</p>
      <p className="assess-label">{risk.display_label}</p>

      {risk.contributors.length > 0 && (
        <ul className="assess-contributors">
          {risk.contributors.map((c) => (
            <li key={c.key} className={`weight-${c.weight}`}>
              {/* 신호 이름과 **무게**를 한 줄에. 예전에는 무게가 왼쪽 테두리 색으로만
                  있었는데, 색 하나로는 "이게 셋 중 몇인가" 를 못 읽는다. 점 세 개를
                  같이 두면 형태로도 읽히고, 색을 구분하기 어려운 사람에게도 남는다. */}
              <span className="assess-contrib-head">
                <span className="assess-contrib-label">{c.label}</span>
                <span className="assess-contrib-weight" title={`가중 ${c.weight} / 3`}>
                  <i aria-hidden="true" className={c.weight >= 1 ? "on" : ""} />
                  <i aria-hidden="true" className={c.weight >= 2 ? "on" : ""} />
                  <i aria-hidden="true" className={c.weight >= 3 ? "on" : ""} />
                  <em className="assess-sr">가중 {c.weight} / 3</em>
                </span>
              </span>
              <span className="assess-contrib-detail">{c.detail}</span>
              <span className="assess-contrib-effect">{c.effect}</span>
              {/* 출처와 인과 여부는 **근거를 확인하러 온 사람**이 읽는 줄이다.
                  신호마다 항상 펼쳐 두면 카드 하나가 스무 줄이 된다. */}
              <details className="assess-contrib-source">
                <summary>
                  근거
                  {c.causal === true && <b className="assess-causal is-causal">인과</b>}
                  {c.causal === false && <b className="assess-causal is-marker">지표</b>}
                </summary>
                <span>
                  {c.source}
                  {c.causal === true && " — 유전연구·중재시험이 함께 지지한다"}
                  {c.causal === false && " — 따져봤더니 원인이 아니라 동반 지표였다"}
                </span>
              </details>
            </li>
          ))}
        </ul>
      )}
      {risk.missing_fields.length > 0 && (
        <p className="assess-missing">
          <strong>못 본 값</strong> · {risk.missing_fields.map(readableField).join(", ")}
        </p>
      )}
      {risk.recommendation && (
        <p className="assess-recommend">{risk.recommendation}</p>
      )}
    </article>
  );
}
