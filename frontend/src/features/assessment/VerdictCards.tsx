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

import { Modal } from "../../shared/ui/Modal";
import type { DiseaseRisk, DiseaseVerdict, RiskLevel } from "./contracts";
import { ENGINE_SHORT, LEVEL_LABEL } from "./contracts";
import { DISEASE_MEASURES, FIELD_LABELS, FIELD_UNITS } from "./fields";

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
        {verdict.superseded_by ? "밀려난 ML 추정 " : "ML 추정 근거 "}
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
  onOpen,
}: {
  verdict: DiseaseVerdict;
  values: Record<string, string>;
  onOpen: () => void;
}) {
  const short = verdict.sub_status || LEVEL_LABEL[verdict.risk_level];
  const enough = verdict.risk_level !== "INSUFFICIENT_DATA";

  return (
    <article className={`assess-card ${LEVEL_CLASS[verdict.risk_level]}`}>
      <header>
        <h3>{verdict.name}</h3>
        <LevelBadge level={verdict.risk_level} />
      </header>

      {enough ? <LevelBar level={verdict.risk_level} /> : null}

      <p className="assess-substatus">{short}</p>
      <KeyFigures verdict={verdict} values={values} />

      {verdict.missing_fields.length > 0 && (
        <p className="assess-need">
          <strong>{verdict.missing_fields.join(", ")}</strong>를 넣으면 정확해져요
        </p>
      )}

      {/* 질환 이름을 접근성 이름에 넣는다. 카드가 열세 장이라 "판정 근거"만 있으면
          화면 낭독기가 같은 이름의 버튼 열세 개를 읽는다. */}
      <button type="button" className="assess-why-button" onClick={onOpen}>
        <span className={`assess-engine-tag engine-${verdict.engine.toLowerCase()}`}>
          {ENGINE_SHORT[verdict.engine]}
        </span>
        <span>
          {verdict.name} 판정 근거
        </span>
      </button>
    </article>
  );
}

/** 카드에서 접었던 것 전부. 좁은 카드가 아니라 모달이라 나열하지 않고 항목으로 가른다. */
export function VerdictDetail({ verdict, values, onClose }: { verdict: DiseaseVerdict; values: Record<string, string>; onClose: () => void }) {
  return (
    <Modal title={verdict.name} kicker="판정 근거" className="verdict-modal" onClose={onClose}>
      <div className="verdict-modal-top">
        <LevelBadge level={verdict.risk_level} />
        <strong>{verdict.sub_status || LEVEL_LABEL[verdict.risk_level]}</strong>
      </div>

      {verdict.risk_level !== "INSUFFICIENT_DATA" ? <LevelBar level={verdict.risk_level} /> : null}
      <KeyFigures verdict={verdict} values={values} />

      <p className="assess-label">{verdict.display_label}</p>

      <dl className="verdict-facts">
        {verdict.reason ? (
          <>
            <dt>무엇을 보고</dt>
            <dd>{verdict.reason}</dd>
          </>
        ) : null}
        <dt>어느 엔진이 왜</dt>
        <dd>
          <span className={`assess-engine-tag engine-${verdict.engine.toLowerCase()}`}>
            {verdict.engine} {ENGINE_SHORT[verdict.engine]}
          </span>{" "}
          {verdict.engine_reason}
        </dd>
        {verdict.recommendation ? (
          <>
            <dt>권하는 것</dt>
            <dd>{verdict.recommendation}</dd>
          </>
        ) : null}
        {verdict.missing_fields.length > 0 ? (
          <>
            <dt>넣으면 정확해지는 값</dt>
            <dd>{verdict.missing_fields.join(", ")}</dd>
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

      <ReferenceBlock verdict={verdict} />

      {verdict.disclaimer ? <p className="assess-fineprint">{verdict.disclaimer}</p> : null}
    </Modal>
  );
}

export function MatrixCard({ risk }: { risk: DiseaseRisk }) {
  return (
    <article
      className={`assess-card assess-matrix ${LEVEL_CLASS[risk.risk_level]}`}
    >
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
      {risk.recommendation && (
        <p className="assess-recommend">{risk.recommendation}</p>
      )}
    </article>
  );
}
