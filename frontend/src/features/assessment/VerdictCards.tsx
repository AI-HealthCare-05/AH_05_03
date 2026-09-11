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

import { useState } from "react";

import { Modal } from "../../shared/ui/Modal";
import type { ComplicationOutlook, DiseaseRisk, DiseaseVerdict, OnsetTrajectory, RiskLevel } from "./contracts";
import { ENGINE_PLAIN, ENGINE_SHORT, LEVEL_LABEL } from "./contracts";
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
 * 카드 앞면이 적는 앞날의 해. **모달 표는 지평 전부를 그대로 그린다.**
 *
 * 서버는 1~5년 다섯 점을 다 보내고(`trajectory.HORIZONS`) 앞면은 그중 하나만 쓴다.
 * 앞면에서 골라 쓰는 것이지 지평을 줄이는 것이 아니다 — 줄이면 근거 모달의 곡선이
 * 점 두 개짜리 직선이 된다.
 */
const CARD_HORIZON_YEARS = 5;

/**
 * 발병 궤적 — "지금 없다면 앞으로 t년 안에 생길 확률".
 *
 * 선 둘을 같이 그린다. 내 곡선 하나만 있으면 "10년 27%" 가 큰 수인지 보통인지 알 수
 * 없다. 동년배 곡선이 그 자를 준다. 표는 낭독기와 좁은 화면을 위한 같은 내용이다.
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
 * 카드 앞면의 앞날 한 칸. **열세 장 전부에 있다.**
 *
 * **앞면이 적는 것은 "지금" 과 "5년 뒤" 둘이다.** 다만 둘이 같은 줄에 있지 않다 —
 * 지금은 이 줄 위의 등급 배지와 `sub_status` 줄이 말하고, 이 줄은 5년 뒤만 맡는다.
 *
 * 지평을 여럿 적어 본 이력이 있다. 10년 하나 → 양 끝(1·5년) 둘 → 1·3·5년 셋 →
 * 지금의 5년 하나다. 앞면에 점을 늘리면 줄이 길어져 카드 폭에서 줄바꿈되고
 * (`.assess-trajectory-values` 는 `flex-wrap: wrap`) 카드 높이가 궤적 유무에 따라
 * 제각각이 된다. **해마다의 값과 곡선은 근거 모달(`TrajectoryBlock`)이 지평 다섯
 * 개를 다 그리므로 앞면에서 겹쳐 적을 이유가 없다.**
 *
 * ## 두 물음을 같은 자리에 놓되 이름을 다르게 쓴다
 *
 *   새로 생길 확률   지금 없다면 그 사이에 새로 생길 확률. 비가역 셋에만 있다.
 *                    t=0 에서 정의상 0 이라 이 줄에는 "지금" 이 없다.
 *   기준 초과 확률   그 나이에 기준을 넘고 있을 확률. 열 질환 전부에 있다.
 *                    이쪽은 `current_probability` 가 있어서 `지금 · 5년 뒤` 둘을 적는다.
 *
 * 발병 궤적이 셋뿐인 것은 학습이 덜 된 게 아니라 **가역 질환에서 누적 발병 곡선이
 * 거짓이 되기 때문**이다(이상지질혈증은 65세+ 사망연계 C 0.43 으로 방향이 뒤집힌다).
 * 그래서 나머지 열 장에는 다른 물음으로 답한다. 이름을 섞으면 안 된다 — "새로
 * 생길" 과 "이미 넘었는지와 무관하게 그 나이에 넘고 있을" 은 다른 숫자다.
 */
export function TrajectoryLine({ verdict }: { verdict: DiseaseVerdict }) {
  const trajectory = verdict.reference?.trajectory;
  if (trajectory && trajectory.horizons_years.length > 0) {
    // **앞날 한 점만 적는다 — 5년 뒤.**
    //
    // 이 줄에 "현재" 를 적지 않는 것은 자리를 아껴서가 아니다. 누적 발병 확률은
    // t=0 에서 **정의상 0** 이라 적을 값이 자체적으로 없다. 그리고 카드가 이미
    // 현재를 말하고 있다 — 헤더의 등급 배지와 그 아래 `sub_status` 줄이 그것이다.
    // 그래서 카드 앞면은 (위) 지금 · (아래) 5년 뒤 두 층으로 읽힌다.
    //
    // 1·3년을 같이 적어 본 적이 있는데 되돌렸다. 해마다의 값과 곡선은 근거 모달의
    // `TrajectoryBlock` 이 지평 다섯 개를 다 그리므로, 앞면에서 겹쳐 적을 이유가 없다.
    //
    // 지평을 **값으로** 고른다. 인덱스를 박으면 `trajectory.HORIZONS` 가 바뀌는 날
    // 조용히 다른 해를 가리킨다 — 그때 화면은 아무 오류 없이 틀린 해를 적는다.
    // 나이 상한에 5년이 잘리면(78세는 1·2년만 남는다) 있는 것 중 마지막을 쓴다.
    const years = trajectory.horizons_years;
    const wanted = years.indexOf(CARD_HORIZON_YEARS);
    const at = wanted >= 0 ? wanted : years.length - 1;
    return (
      <div className="assess-trajectory-line is-onset">
        <span className="assess-trajectory-label">새로 생길 확률</span>
        <span className="assess-trajectory-values">
          <span className="assess-trajectory-step">
            <b>{percent(trajectory.onset_probability[at])}</b>
            <small>
              {years[at]}년 뒤
              {trajectory.population_onset_probability?.[at] !== undefined && (
                <span className="assess-muted"> · 동년배 {percent(trajectory.population_onset_probability[at])}</span>
              )}
            </small>
          </span>
        </span>
      </div>
    );
  }

  const prevalence = verdict.reference?.prevalence_trajectory;
  if (!prevalence || prevalence.horizons_years.length === 0) return null;
  const points = [prevalence.current_probability, ...prevalence.prevalence_probability];
  // GBDT 는 나이를 계단으로 쓰므로 세 지평이 같은 칸에 떨어지는 일이 흔하다
  // (실측: 고콜레스테롤혈증 19·19·19%). 같은 숫자를 세 번 적으면 눈이 "왜 셋이지"
  // 를 해석하게 되고, 그게 정보가 없는 자리에서 일어난다. 한 번만 적고 끝을 밝힌다.
  const flat = Math.max(...points) - Math.min(...points) < 0.01;
  const lastYear = prevalence.horizons_years[prevalence.horizons_years.length - 1];
  return (
    <div className="assess-trajectory-line is-prevalence">
      <span className="assess-trajectory-label">기준 초과 확률</span>
      <span className="assess-trajectory-values">
        <span className="assess-trajectory-step">
          <b>{percent(prevalence.current_probability)}</b>
          <small>지금</small>
        </span>
        {flat ? (
          <span className="assess-trajectory-step">
            <small>{lastYear}년 뒤까지 거의 그대로</small>
          </span>
        ) : (
          // 마지막 해만. 해마다의 값은 위 발병 예측 패널에 있다.
          <span className="assess-trajectory-step">
            <b>{percent(prevalence.prevalence_probability[prevalence.prevalence_probability.length - 1])}</b>
            <small>{lastYear}년 뒤</small>
          </span>
        )}
      </span>
    </div>
  );
}

/**
 * 접이 안의 유병 곡선 — 발병 궤적이 없는 카드가 읽는 자리.
 *
 * 곡선이 **내려가는** 구간이 실제로 있다. 지질은 60대 이후 유병률이 떨어지는데
 * 낫는 게 아니라 그 나이대에서 약을 먹기 시작한 사람이 많고 고위험군이 먼저
 * 사망하기 때문이다. 그 사실을 같이 적지 않으면 "나이 들면 좋아진다" 로 읽힌다.
 */
export function PrevalenceBlock({ verdict }: { verdict: DiseaseVerdict }) {
  const prevalence = verdict.reference?.prevalence_trajectory;
  if (!prevalence || prevalence.horizons_years.length === 0) return null;
  if (verdict.reference?.trajectory) return null;
  return (
    <section className="assess-trajectory">
      <h4>
        기준을 넘고 있을 확률 <span className="assess-muted">· {prevalence.direction}</span>
      </h4>
      <table className="assess-trajectory-table">
        <thead>
          <tr>
            <th scope="col">기간</th>
            <th scope="col">지금</th>
            {prevalence.horizons_years.map((year) => (
              <th scope="col" key={year}>
                {year}년
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">확률</th>
            <td>{percent(prevalence.current_probability)}</td>
            {prevalence.prevalence_probability.map((value, i) => (
              <td key={prevalence.horizons_years[i]}>{percent(value)}</td>
            ))}
          </tr>
        </tbody>
      </table>
      <p className="assess-fineprint">
        {prevalence.conditional_on}. {prevalence.caveats[0]} {prevalence.caveats[1]}
      </p>
    </section>
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
  shared,
}: {
  verdict: DiseaseVerdict;
  values: Record<string, string>;
  models: ModelSpec[];
  /**
   * 패널 위에서 **이미 한 번 적은** 정밀화 입력. 카드에서는 뺀다.
   *
   * 없으면 예전처럼 카드마다 전부 적는다 — 기록 화면처럼 카드가 한 장만 있는
   * 자리에서는 위에 올릴 곳이 없기 때문이다.
   */
  shared?: readonly string[];
}) {
  const gain = precisionGains(verdict, values, models);
  const decisive = briefList(gain.decisive);
  // 판정을 가르는 값(`decisive`)은 카드마다 다르므로 그대로 둔다. 겹치는 것은
  // "정밀해진다" 쪽뿐이고, 그건 한 번 채우면 여러 카드가 같이 좋아진다.
  const refining = briefList(shared?.length ? gain.refining.filter((item) => !shared.includes(item)) : gain.refining);

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
        {/* 출처 표기는 `is-citation` 으로 한 단 내린다. 지침 제목·판·분류 체계가 통째로
            들어와서 네 줄이 되는데, 그 네 줄이 위 셋과 같은 무게로 앉으면 정작 읽을
            답("무엇을 보고" · "권하는 것")이 묻힌다. */}
        {verdict.criteria_reference ? (
          <>
            <dt>기준 출처</dt>
            <dd className="is-citation">{verdict.criteria_reference}</dd>
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
      {/* **2026-09-11 통계 용어를 사용자 말로 옮겼다.** 이 블록은 "백분위"·"중간값
          대비"·"판별력"·"상위 10% 경보 적중률" 로 이루어져 있었다. 근거를 보러
          들어온 사람이라 해도 통계를 배우고 온 것은 아니다.
          숫자는 하나도 지우지 않았다 — 말만 바꾸고 순서를 바꿨다. */}
      <h4>
        {/* 밀렸다는 사실은 남긴다 — 그 숫자를 왜 안 쓰는지가 여기서 답할 물음이다. */}
        {verdict.superseded_by ? "검사값이 대신한 추정 " : "검사 없이 추정한 값 "}
        <strong>{percent}%</strong>
        {ref.peer_percentile !== null && ref.peer_percentile !== undefined && (
          <span className="assess-muted">
            {" "}
            · {ref.peer_group} 100명 중 {Math.round(ref.peer_percentile)}명보다 높아요
          </span>
        )}
      </h4>
      <dl>
        {ref.peer_ratio ? (
          <>
            <dt>또래 한가운데 사람과 견주면</dt>
            <dd>{ref.peer_ratio}배</dd>
          </>
        ) : null}
        {accuracy ? (
          <>
            {/* **겪게 되는 숫자를 먼저 놓는다.** 예전에는 AUROC 가 맨 위였는데,
                그 값은 사용자가 화면에서 겪는 것과 관계가 없다(아래 잔글씨 참조).
                경보가 맞을 확률이 실제로 이 화면이 사람에게 하는 약속이다. */}
            {accuracy.alert_ppv !== null && (
              <>
                <dt>경보가 맞을 확률</dt>
                <dd>
                  위험하다고 알린 <strong>100명 중 {(accuracy.alert_ppv * 100).toFixed(0)}명</strong>이 실제로 해당했습니다
                  {accuracy.alert_sensitivity !== null && (
                    <span className="assess-muted">
                      {" "}
                      · 실제 해당하는 100명 중{" "}
                      {(accuracy.alert_sensitivity * 100).toFixed(0)}명을 찾아냅니다
                    </span>
                  )}
                </dd>
              </>
            )}
            <dt>전체 판별 성능</dt>
            <dd>
              AUROC {accuracy.headline_auroc} · {accuracy.grade}
              <span className="assess-muted">
                {" "}
                ({accuracy.measured_on} 기준)
              </span>
            </dd>
          </>
        ) : null}
      </dl>
      <p className="assess-fineprint">
        {/* 어미를 셋 다 `-습니다` 로 맞춘다. 앞서 `아닙니다 / 확률이에요 / 쪽입니다`
            로 갈려 있었다. 그리고 "실제로 겪게 되는 것은 ~ 쪽입니다" 는 영어
            (what you actually experience is…) 구조 그대로다 — 한국어는 명사구를
            주어로 세우는 대신 주어를 사람으로 돌린다. */}
        AUROC 는 "100명 중 몇 명을 맞히나"가 아닙니다. 위험한 사람과 그렇지 않은
        사람을 한 명씩 뽑아 견주면, 위험한 쪽에 더 높은 점수를 매길 확률입니다.
        정작 내가 겪는 쪽은 위에 적은 <strong>경보가 맞을 확률</strong>입니다.
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
  sharedRefining,
}: {
  verdict: DiseaseVerdict;
  values: Record<string, string>;
  /** `/predictions/model-info` 의 모델 목록. 없으면 "안 쓴 입력" 블록만 빠진다. */
  models?: ModelSpec[];
  /**
   * 패널이 카드 위에서 이미 한 번 적은 정밀화 입력. 카드에서는 뺀다.
   *
   * 카드가 여러 장 나란히 설 때만 넘어온다 — 기록 화면처럼 한 장뿐인 자리에는
   * 위에 올릴 곳이 없으므로 넘기지 않고, 그때는 카드가 예전처럼 전부 적는다.
   */
  sharedRefining?: readonly string[];
}) {
  const [open, setOpen] = useState(false);
  const short = verdict.sub_status || LEVEL_LABEL[verdict.risk_level];
  const enough = verdict.risk_level !== "INSUFFICIENT_DATA";
  const probability = verdict.reference?.probability;
  const hasEvidence = probability !== null && probability !== undefined;
  // 근거 모달의 곁칸에 실릴 것이 있나. 없으면 두 칸으로 가르지 않는다.
  const hasSide = Boolean(
    verdict.reference?.trajectory || verdict.reference?.prevalence_trajectory || hasEvidence,
  );

  return (
    <article className={`assess-card ${LEVEL_CLASS[verdict.risk_level]}`}>
      <header>
        <h3>{verdict.name}</h3>
        <LevelBadge level={verdict.risk_level} />
      </header>

      {enough ? <LevelBar level={verdict.risk_level} /> : null}

      {/* **2026-09-11 엔진 두 칸을 걷어냈다.** 여기는 `ML 예측 77% → 판정 정상 범위`
          였고, 두 가지가 한꺼번에 잘못돼 있었다.

          하나, **말이 우리 말이지 사용자 말이 아니다.** "ML 예측"·"규칙 엔진"·
          "공개 공식" 은 이 화면을 만든 사람의 어휘다. 게다가 그 셋을 구분해 봐야
          사용자가 화면에서 할 수 있는 일은 달라지지 않는다.

          둘, **정본이 아닌 숫자를 정본 앞에 세웠다.** 바로 아래 옛 주석이 적어 둔
          실측이 그 증거다 — "이상지질혈증 · 정상 범위 · ML 예측 77%". 정상이라고
          해 놓고 77% 를 나란히 보여 주면 사용자는 둘 중 무엇을 믿을지 모른다.
          `is-superseded` 로 흐리는 것으로는 안 풀린다. 흐린 숫자도 읽히고, 읽히면
          묻게 된다. 무시해도 되는 값이면 훑는 자리에 두지 않는 것이 답이다.

          지우지 않고 **옮겼다.** 두 엔진이 같이 돌았다는 사실과 밀려난 확률은
          `판정 근거 자세히`(`VerdictFacts`) 안에 그대로 있다 — 거기에는 나란히
          놓을 자리와 설명이 같이 있다. 앞면에는 정본이 말하는 것만 남긴다. */}
      {verdict.sub_status ? (
        // 등급 배지는 "얼마나" 를 말하고 이 줄은 "무엇이" 를 말한다. `sub_status`
        // 가 없을 때 `LEVEL_LABEL` 로 떨어뜨리지 않는 이유는 그러면 배지와 같은
        // 말을 두 번 하기 때문이다.
        <p className="assess-substatus">{readableSentence(verdict.sub_status)}</p>
      ) : null}

      {/* 검사값 없이 추정한 칸에만 숫자를 앞면에 둔다. **확률(%)이 아니라 자연빈도**
          로 적는다 — 같은 번역을 `Evidence` 가 이미 쓰고 있는데("이 점수대의 100명
          중 N명") 그게 모달 안에만 있어서, 정작 카드를 훑는 자리에는 % 만 있었다.
          좋은 표기를 숨기고 나쁜 표기를 내놓고 있었던 셈이다. */}
      {verdict.engine === "E2" && probability !== null && probability !== undefined ? (
        <p className="assess-chance">
          나와 수치가 비슷한 <b>100명 중 {Math.round(probability * 100)}명</b>이 이 기준을 넘어요
        </p>
      ) : null}

      {/* 어느 쪽이 답했는지는 한 칸으로 족하다. 사용자에게 실제로 다른 것은
          "내 검사값이 쓰였는가" 하나이므로 그 답을 적는다(`ENGINE_PLAIN`). */}
      <span className={`assess-engine-tag engine-${verdict.engine.toLowerCase()}`}>
        {ENGINE_PLAIN[verdict.engine]}
      </span>
      <KeyFigures verdict={verdict} values={values} />
      <TrajectoryLine verdict={verdict} />

      <PrecisionHints verdict={verdict} values={values} models={models} shared={sharedRefining} />

      {/* **근거는 카드 위에 겹쳐 띄운다.**
          한동안 접이(`<details>`)로 카드 안에서 펼쳤는데, 격자에서 한 장이 펼쳐지면
          같은 줄의 다른 카드까지 키가 늘고 아래가 통째로 밀린다. 근거 블록은 게이지·
          표·차트까지 있어서 카드 하나가 화면 두 개 길이가 됐다.

          모달이지만 **내용은 접이 때와 같은 컴포넌트 넷**이다. 예전에 모달을 없앤
          이유는 "눌러도 카드 접이와 똑같은 것이 나온다" 였고, 지금은 그 접이가
          없으므로 중복이 아니다. */}
      <button type="button" className="assess-evidence-open" onClick={() => setOpen(true)}>
        {verdict.name} 판정 근거 자세히
      </button>
      {open ? (
        <Modal
          title={verdict.name}
          kicker="판정 근거"
          className="verdict-modal"
          onClose={() => setOpen(false)}
        >
          <div className="verdict-modal-head">
            <LevelBadge level={verdict.risk_level} />
            <strong>{readableSentence(short)}</strong>
          </div>
          {/* **넓은 화면에서는 두 칸으로 읽는다.** 근거는 문장이고 궤적·참고는
              숫자라 읽는 방식이 다르다. 한 줄로 쌓아 두면 모달이 세로로 길어져
              스크롤 없이는 둘을 같이 못 본다 — "왜 이 등급인가" 와 "그래서 앞으로
              어떻게 되나" 는 나란히 놓고 봐야 하는 물음이다.

              곁칸에 담을 것이 없으면 한 칸으로 둔다. 빈 칸을 만들면 본문이 절반
              폭으로 쪼그라들어 오히려 좁아 보인다. */}
          <div className={hasSide ? "verdict-modal-body has-side" : "verdict-modal-body"}>
            <div className="verdict-modal-main">
              <VerdictFacts verdict={verdict} />
            </div>
            {hasSide ? (
              <div className="verdict-modal-side">
                <TrajectoryBlock verdict={verdict} />
                <PrevalenceBlock verdict={verdict} />
                {hasEvidence ? <Evidence verdict={verdict} values={values} models={models} /> : null}
              </div>
            ) : null}
          </div>
        </Modal>
      ) : null}
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
  // **신호가 하나도 안 걸린 칸은 짧게 둔다.** 여섯 신호가 겹친 카드와 같은 높이를
  // 차지하면 "정상인데 왜 이렇게 크게 보여주나" 가 된다 — 실제로 그 질문을 받았다.
  // 대신 지우지는 않는다. 다 보고 깨끗한 것은 그 자체로 답이고, 그걸 말하려면
  // **몇 가지를 봤는지**를 같이 적어야 한다.
  const clear = risk.contributors.length === 0 && risk.risk_level === "NORMAL";
  if (clear) {
    return (
      <article className={`assess-card assess-matrix is-clear ${LEVEL_CLASS[risk.risk_level]}`}>
        <header>
          <h3>{title}</h3>
          <LevelBadge level={risk.risk_level} />
        </header>
        <p className="assess-matrix-clear">{risk.reason || risk.display_label}</p>
        {risk.missing_fields.length > 0 && (
          <p className="assess-missing">
            <strong>못 본 값</strong> · {risk.missing_fields.map(readableField).join(", ")}
          </p>
        )}
      </article>
    );
  }
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

/**
 * 이미 걸린 질환이 앞으로 무엇을 부르는가.
 *
 * **`MatrixCard` 와 방향이 반대다.** 저쪽은 "이 수치들이 이 질환을 가리킨다"(들어오는
 * 화살표)이고 이쪽은 "이 질환이 저것들을 부른다"(나가는 화살표)다. 그래서 목록의
 * 생김새는 일부러 닮게 두고 — 이름·설명·크기·출처에 인과 표시까지 같다 — 방향만
 * 제목과 첫 줄로 가른다. 두 벌의 문법을 새로 배우게 할 이유가 없다.
 *
 * **확률을 붙이지 않는다.** 서버가 안 주기 때문이고, 안 주는 이유는 "당신은 5년 안에
 * 망막병증이 생깁니다" 를 말할 근거가 이 서비스에 없기 때문이다. 여기 있는 것은
 * 지침과 코호트가 말하는 **질환의 앞날**이지 이 사람의 예측이 아니다.
 */
export function OutlookCard({ outlook }: { outlook: ComplicationOutlook }) {
  return (
    <article className={`assess-card assess-outlook ${LEVEL_CLASS[outlook.risk_level]}`}>
      <header>
        <h3>{outlook.name}</h3>
        <LevelBadge level={outlook.risk_level} />
      </header>
      <p className="assess-outlook-lead">{outlook.lead}</p>
      <p className="assess-outlook-summary">{outlook.summary}</p>

      {/* 낮은 HDL 처럼 **합병증 틀로 말하면 안 되는 칸**이 있다. 목록을 비우고 왜
          비웠는지를 적는다 — 빈 카드를 세우면 "아직 안 채운 화면" 으로 읽힌다. */}
      {outlook.caveat ? <p className="assess-outlook-caveat">{outlook.caveat}</p> : null}

      {outlook.complications.length > 0 && (
        <ul className="assess-complications">
          {outlook.complications.map((c) => (
            <li key={c.label}>
              <span className="assess-contrib-head">
                <span className="assess-contrib-label">{c.label}</span>
                {/* 장기 이름. 목록이 여섯 줄까지 가는 카드(비만)에서 눈이 묶어 읽을
                    손잡이가 된다. 색이 아니라 글자라 구분이 어려운 사람에게도 남는다. */}
                <span className="assess-organ">{c.organ}</span>
              </span>
              <span className="assess-contrib-detail">{c.detail}</span>
              <span className="assess-contrib-effect">{c.effect}</span>
              <details className="assess-contrib-source">
                <summary>
                  근거
                  {c.causal === true && <b className="assess-causal is-causal">인과</b>}
                  {c.causal === false && <b className="assess-causal is-marker">지표</b>}
                </summary>
                <span>
                  {c.source}
                  {c.causal === false && " — 따져봤더니 원인이 아니라 동반 지표였다"}
                </span>
              </details>
            </li>
          ))}
        </ul>
      )}

      {/* **무엇이 생기나만 적고 끝내지 않는다.** 합병증은 대개 증상이 없어서, 읽고
          나서 할 일이 남지 않으면 카드가 겁주기로만 끝난다. */}
      {outlook.monitoring.length > 0 && (
        <div className="assess-outlook-watch">
          <strong>지금 확인할 것</strong>
          <ul>
            {outlook.monitoring.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}
