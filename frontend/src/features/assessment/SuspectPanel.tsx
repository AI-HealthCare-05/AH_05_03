/**
 * 먼저 볼 세 가지 — 판정 화면에서 **가장 먼저 읽혀야 하는 것**.
 *
 * 카드 열네 장을 훑을 때 사용자가 실제로 하는 일은 "그래서 뭘 봐야 하나" 하나다.
 * 이 패널은 그 답만 한다 — **어느 셋을, 왜 먼저 보나.**
 *
 * ## 숫자를 여기에 두지 않는다 (2026-09-11)
 *
 * 한동안 이 패널이 확률까지 같이 적었다. 그래서 같은 숫자가 한 화면에 **세 번**
 * 나왔다 — 실측으로 대사증후군 `56% / 58%` 가 이 패널의 접이 안에, 아래 질환
 * 카드의 `TrajectoryLine` 에, 그리고 맨 아래 "질환 N가지 전부" 목록에 한 번씩
 * 있었다. 셋 다 같은 값이고 같은 근거였다.
 *
 * 중복은 자리만 먹는 게 아니다. 사용자는 **같은 값인지 다른 값인지 확인하려고**
 * 세 자리를 오간다. 숫자가 한 자리에만 있으면 그 확인이 필요 없다.
 *
 * 그래서 역할을 갈랐다.
 *
 *   이 패널        어느 셋이 급한가 · 왜 그 순위인가
 *   질환 카드      그 질환의 수치와 확률 (`VerdictCards.TrajectoryLine`)
 *   근거 모달      해마다의 값과 곡선 (`TrajectoryBlock`·`PrevalenceBlock`)
 *
 * 없앤 것과 그 값이 지금 어디 있는지는 이렇다. 하나도 버리지 않았다.
 *
 *   접이 안의 확률 표    → 질환 카드 앞면과 근거 모달
 *   "N년 뒤 건강 예측"   → 질환 카드가 열네 장을 모두 그린다
 *   `suspect.reason`     → 카드의 `sub_status` 가 같은 말을 한다
 *
 * ## 장기 예측 근거는 남긴다
 *
 * 확률과 달리 이 값은 **다른 곳에 없다.** 같은 "주의" 라도 신기능은 사망연계
 * C 0.84 이고 낮은 HDL 은 0.51 이다. 그 차이가 화면에 없으면 둘이 같아 보이고,
 * 순위를 그렇게 매긴 이유도 사라진다. 순위를 말하는 자리에 순위의 근거를 둔다.
 */

import type { RiskLevel, SuspectCard } from "./contracts";
import { LevelBadge } from "./VerdictCards";
import "./suspectPanel.css";

/**
 * 측정이 "정상 범위" 라고 답했나.
 *
 * `risk_level` 이 정본이고 `level` 은 옛 응답(스냅샷)을 위한 폴백이다 — 기록
 * 화면은 그날 저장한 판정을 그대로 그리므로 필드가 없는 판이 남아 있다.
 */
function isSettled(suspect: SuspectCard) {
  const normal = suspect.risk_level ? suspect.risk_level === "NORMAL" : suspect.level === "정상 범위";
  return suspect.basis === "측정" && normal;
}

/** 측정이 **이미 기준을 넘었다**고 답했나. 다음 행동이 달라지는 갈림이다. */
function isConfirmed(suspect: SuspectCard) {
  return suspect.basis === "측정" && (suspect.risk_level === "HIGH" || suspect.risk_level === "VERY_HIGH");
}

/** 장기 근거의 세기를 말로 옮긴다. 점 세 개와 같은 경계를 쓴다. */
function evidenceLabel(weight: number): string {
  if (weight >= 1.0) return "장기 추적 연구에서 확인됨";
  if (weight >= 0.7) return "어느 정도 확인됨";
  if (weight >= 0.5) return "아직 평가되지 않음";
  return "근거가 약해 참고용으로 확인";
}

function SuspectItem({ suspect }: { suspect: SuspectCard }) {
  const settled = isSettled(suspect);
  const confirmed = isConfirmed(suspect);
  const measured = suspect.basis === "측정";

  return (
    <article className={`suspect-card ${suspect.suspected ? "is-suspected" : "is-filler"}`}>
      <header>
        {/* 순위를 제목 안에 둔다. 아래 질환 카드에도 같은 이름의 제목이 있어서,
            밖에 두면 화면 낭독기가 같은 이름의 제목 두 개를 읽는다. */}
        <h4>
          <span className="suspect-rank">{suspect.rank}순위</span> {suspect.name}
        </h4>
        <span className="suspect-tags">
          <span className={`suspect-basis ${measured ? "is-measured" : "is-estimated"}`}>
            {measured ? "검사값 기준" : suspect.basis === "예측" ? "예측값 기준" : suspect.basis}
          </span>
          {/* **판정 카드와 같은 배지다.** 예전에는 `suspect.level` 을 그대로 썼는데
              그 값은 순위 점수를 만든 재료라 규칙 5단계와 의학 4단계가 섞여 있었다 —
              같은 고혈압이 카드에서 "정상", 여기서 "정상 범위" 로 나왔다.
              서버가 `risk_level` 을 따로 실어 준다(`app/services/assessment.py`). */}
          {suspect.risk_level ? (
            <LevelBadge level={suspect.risk_level as RiskLevel} />
          ) : (
            <span className="suspect-level">{suspect.level}</span>
          )}
        </span>
      </header>

      {/* 한 줄이다. 무엇을 하면 되는지까지만 적고, 수치는 아래 카드가 맡는다. */}
      {confirmed ? (
        <p className="suspect-now">
          <strong>검사값이 기준을 넘었어요.</strong>
          재측정 후 의료기관과 상담해 주세요.
        </p>
      ) : (
        <p className="suspect-status">
          {settled
            ? "현재 검사값은 정상 범위예요."
            : measured
              ? "검사값과 예측 결과를 함께 확인하세요."
              : "입력한 정보로 추정한 결과예요."}
        </p>
      )}

      {/* **이 순위를 얼마나 믿어도 되는가.** 확률과 달리 이 값은 다른 곳에 없다. */}
      <p className="suspect-evidence">
        <span className="suspect-evidence-label">장기 예측 근거</span>
        <span className="suspect-evidence-dots" aria-hidden="true">
          <i className={suspect.evidence_weight >= 0.5 ? "on" : ""} />
          <i className={suspect.evidence_weight >= 0.7 ? "on" : ""} />
          <i className={suspect.evidence_weight >= 1.0 ? "on" : ""} />
        </span>
        <span>{evidenceLabel(suspect.evidence_weight)}</span>
      </p>
    </article>
  );
}

export function SuspectPanel({ suspects }: { suspects: SuspectCard[] }) {
  if (suspects.length === 0) return null;
  const anySuspected = suspects.some((s) => s.suspected);

  return (
    <section className="suspect-panel" aria-labelledby="suspect-heading">
      <h3 id="suspect-heading">
        먼저 확인할 건강 신호
        <span className="suspect-count">{suspects.length}개 항목</span>
      </h3>
      <p className="assess-muted suspect-lead">
        {anySuspected
          ? "검사 결과와 예측 근거를 바탕으로 우선 확인할 항목을 모았어요. 수치는 아래 질환별 결과에 있어요."
          : "현재 예측에서 특별히 주의할 항목은 없어요. 아래 결과를 참고해 주세요."}
      </p>
      <div className="suspect-grid">
        {suspects.map((suspect) => (
          <SuspectItem key={suspect.target} suspect={suspect} />
        ))}
      </div>
    </section>
  );
}
