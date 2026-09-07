/**
 * 예측 근거 개요 — 열세 칸을 한 화면에 세운다.
 *
 * ## 카드와 무엇이 다른가
 *
 * 카드는 질환 하나를 설명하고, 근거도 카드 안에서 펼쳐진다(`VerdictCard` 의
 * `<details>`). 그러면 이 화면이 왜 남아 있나 — **비교** 때문이다. 카드를 열세 장
 * 스크롤하며 등급을 눈으로 모으는 대신 타일로 한 번에 본다. 예측 데모(`/api/demo`)의
 * `summaryTiles` 가 그 자리였다.
 *
 * ## 같은 값을 쓴다
 *
 * 타일의 배지는 **카드와 같은 `risk_level` 5단계**다. 처음 판에서는 `medical.level`
 * (의학 4단계)을 썼는데, 그 값은 집단 통계라 측정과 부딪혔다 — 실측 118/74 인 사람의
 * 고혈압 카드가 "정상" 인데 타일은 "주의" 였다. 자세한 경위는 `Evidence.tsx` 머리말.
 *
 * 질환별 근거는 `Evidence` 컴포넌트 하나가 낸다. 카드와 이 화면이 그것을 같이 쓰므로
 * 두 자리가 다른 숫자를 띄울 수 없다.
 */

import { Modal } from "../../shared/ui/Modal";
import type { AssessmentSummaryData, DiseaseVerdict, RiskLevel } from "./contracts";
import { LEVEL_LABEL, LEVEL_ORDER } from "./contracts";
import { BigNumber, Evidence, type ModelSpec } from "./Evidence";

const LEVEL_CLASS: Record<RiskLevel, string> = {
  VERY_HIGH: "level-very-high",
  HIGH: "level-high",
  CAUTION: "level-caution",
  NORMAL: "level-normal",
  INSUFFICIENT_DATA: "level-unknown",
};

/** 경보 구간만 테두리로 띄운다 — 열세 장이 전부 강조되면 아무것도 강조가 아니다. */
const FLAGGED: RiskLevel[] = ["VERY_HIGH", "HIGH", "CAUTION"];

function Tile({ verdict }: { verdict: DiseaseVerdict }) {
  const probability = verdict.reference?.probability;
  return (
    <div className={FLAGGED.includes(verdict.risk_level) ? "detail-tile flag" : "detail-tile"}>
      <em>{verdict.name}</em>
      {/* 등급이 주인공이다. 숫자는 ML 참고값이 있을 때만 작게 붙는다 — 검사값으로
          판정된 칸에서 확률을 크게 띄우면 그게 판정으로 읽힌다. */}
      <span className={`assess-badge ${LEVEL_CLASS[verdict.risk_level]}`}>
        {LEVEL_LABEL[verdict.risk_level]}
      </span>
      {probability !== null && probability !== undefined ? (
        <div className="v">
          <BigNumber value={probability} />
        </div>
      ) : (
        <div className="v is-none">—</div>
      )}
      <small>{verdict.sub_status}</small>
    </div>
  );
}

export function DetailReport({
  result,
  values,
  models = [],
  onClose,
}: {
  result: AssessmentSummaryData;
  values: Record<string, string>;
  models?: ModelSpec[];
  onClose: () => void;
}) {
  const scored = result.verdicts.filter(
    (verdict) => verdict.reference?.probability !== null && verdict.reference?.probability !== undefined,
  );
  const tier = scored[0]?.reference?.tier;
  // 급한 것이 위로. 카드 격자와 같은 순서를 쓰면 개요의 값어치가 없다 —
  // 훑어서 "무엇이 급한가" 를 답하려고 만든 화면이다.
  const byLevel = [...result.verdicts].sort(
    (a, b) => LEVEL_ORDER.indexOf(a.risk_level) - LEVEL_ORDER.indexOf(b.risk_level),
  );

  return (
    <Modal title="예측 근거 한눈에" kicker="열세 칸 비교" className="detail-modal" onClose={onClose}>
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

      <div className="detail-tiles">
        {byLevel.map((verdict) => (
          <Tile key={verdict.key} verdict={verdict} />
        ))}
      </div>
      <p className="detail-cite">
        배지는 정본 엔진의 판정이고 그 아래 숫자는 <strong>ML 참고 확률</strong>입니다. 검사값이 있는 질환은 규칙
        엔진·공개 공식이 정본이라 둘이 같은 뜻이 아닙니다 — 확률은 "지금 검사받으면 기준을 넘을 가능성" 입니다.
      </p>

      {scored.length === 0 ? (
        <p className="detail-cite">
          ML 번들이 적재되지 않아 확률 근거가 없습니다. 판정은 규칙 엔진과 공개 공식으로만 나왔습니다.
        </p>
      ) : (
        scored.map((verdict) => (
          <section className="detail-condition" key={verdict.key}>
            <h4>
              {verdict.name}
              <span className={`assess-badge ${LEVEL_CLASS[verdict.risk_level]}`}>
                {LEVEL_LABEL[verdict.risk_level]}
              </span>
            </h4>
            <Evidence verdict={verdict} values={values} models={models} />
          </section>
        ))
      )}
    </Modal>
  );
}
