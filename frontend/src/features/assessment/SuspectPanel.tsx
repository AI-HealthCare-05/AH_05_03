/**
 * 먼저 볼 세 가지 — 판정 화면에서 **가장 먼저 읽혀야 하는 것**.
 *
 * 카드 열세 장을 훑을 때 사용자가 실제로 하는 일은 "그래서 뭘 봐야 하나" 하나다.
 * 그 답을 맨 위에 세 장으로 놓고, 각 장에 5년·10년 뒤 숫자를 붙인다.
 *
 * ## 왜 곡선이 아니라 숫자인가
 *
 * 지평이 1·2·3·5·10년이던 때는 선그래프가 맞았다. 지금은 5년과 10년 둘이라 점이
 * 두 개뿐이고, 두 점을 잇는 선은 정보를 더하지 않으면서 "그 사이를 우리가 안다" 는
 * 인상만 준다. 실제로는 그 사이를 재지 않았다.
 *
 * ## 두 숫자의 뜻이 다르다 — 그래서 크기도 다르다
 *
 *   새로 생김   지금 없다면 그 사이에 새로 생길 확률. 비가역 세 질환에만 있다.
 *   기준 초과   그 나이가 됐을 때 기준을 넘고 있을 확률. 열 질환 전부에 있다.
 *
 * 예전에는 둘을 같은 크기의 블록 두 개로 놓았다. 나란히 두면 "41%" 와 "77%" 중
 * 무엇이 무엇인지 매번 제목을 다시 읽어야 한다. **행동을 바꾸는 쪽은 앞이다** —
 * 앞을 크게 두고 동년배 대비를 막대로 보이게 하고, 뒤는 한 줄로 접었다.
 *
 * ## 측정이 이미 답한 카드에는 숫자를 두지 않는다
 *
 * 라벨을 만드는 검사값은 그 질환의 ML 입력에서 차단된다(`modeling/targets.py`).
 * 그래서 이상지질혈증 모델은 사용자가 넣은 지질 넉 장을 **보지 못한 채** 확률을
 * 낸다. 규칙 엔진이 "기준 안에 있어요" 라고 한 카드 바로 밑에 그 모델이 낸 74% 가
 * 붙어 있던 것이 이 패널에서 가장 헷갈리는 지점이었다. 측정이 답한 칸은 답으로 닫는다.
 */

import type { SuspectCard } from "./contracts";

const percent = (value: number) => `${(value * 100).toFixed(0)}%`;

/** 측정이 "기준 이내" 라고 이미 답했나. 그러면 모델 확률을 덧붙이지 않는다. */
function isSettled(suspect: SuspectCard) {
  return suspect.basis === "측정" && suspect.level === "정상 범위";
}

/**
 * 발병 확률 한 줄 — 숫자와, 같은 축 위의 동년배 눈금.
 *
 * "41% · 동년배 16%" 를 글자로만 두면 2.5 배라는 사실이 읽는 사람 머릿속 산수로
 * 남는다. 같은 track 위에 채움(나)과 눈금(동년배)을 두면 그 차이가 그냥 보인다.
 * 축은 0~100% 로 고정한다 — 카드마다 축이 다르면 카드 사이 비교가 거짓이 된다.
 */
function OnsetRow({ years, value, peer }: { years: number; value: number; peer?: number }) {
  return (
    <li className="suspect-row">
      <span className="suspect-when">{years}년 뒤</span>
      <b className="suspect-value">{percent(value)}</b>
      <span className="suspect-gauge" aria-hidden="true">
        <span className="suspect-gauge-fill" style={{ width: `${Math.min(value * 100, 100)}%` }} />
        {peer !== undefined && (
          <span className="suspect-gauge-peer" style={{ left: `${Math.min(peer * 100, 100)}%` }} />
        )}
      </span>
      {peer !== undefined && <em className="suspect-peer">동년배 {percent(peer)}</em>}
    </li>
  );
}

function SuspectItem({ suspect }: { suspect: SuspectCard }) {
  const onset = suspect.onset_trajectory;
  const prevalence = suspect.prevalence_trajectory;
  const settled = isSettled(suspect);
  const measured = suspect.basis === "측정";
  // 측정이 답한 칸에는 모델 확률을 덧붙이지 않는다. 위 머리말 참조.
  const showPrevalence = prevalence && !settled;

  return (
    <article className={`suspect-card ${suspect.suspected ? "is-suspected" : "is-filler"}`}>
      <header>
        {/* 순위를 제목 안에 둔다. 아래 질환 카드에도 같은 이름의 제목이 있어서,
            밖에 두면 화면 낭독기가 같은 이름의 제목 두 개를 읽는다. */}
        <h4>
          <span className="suspect-rank">{suspect.rank}순위</span> {suspect.name}
        </h4>
        <span className="suspect-tags">
          <span className={`suspect-basis ${measured ? "is-measured" : "is-estimated"}`}>{suspect.basis}</span>
          <span className="suspect-level">{suspect.level}</span>
        </span>
      </header>
      <p className="suspect-reason">{suspect.reason}</p>

      {onset ? (
        <section className="suspect-series">
          <h5>지금 없다면 새로 생길 확률</h5>
          <ul className="suspect-rows">
            {onset.horizons_years.map((year, i) => (
              <OnsetRow
                key={year}
                years={year}
                value={onset.onset_probability[i]}
                peer={onset.population_onset_probability?.[i]}
              />
            ))}
          </ul>
        </section>
      ) : null}

      {showPrevalence ? (
        <p className="suspect-prevalence">
          <span className="suspect-prevalence-label">기준 초과</span>
          <span>
            지금 {percent(prevalence.current_probability)}
            {prevalence.horizons_years.map((year, i) => (
              <span key={year}>
                {" → "}
                {year}년 <b>{percent(prevalence.prevalence_probability[i])}</b>
              </span>
            ))}
          </span>
        </p>
      ) : null}

      {!onset && !showPrevalence ? (
        <p className="suspect-none assess-muted">
          {settled ? "검사값이 기준 안에 있어 앞으로의 숫자는 내지 않았어요." : "앞으로의 예측은 자료 범위 밖이라 내지 않았어요."}
        </p>
      ) : null}
    </article>
  );
}

/**
 * 상위 세 장. 하나도 의심이 아니면 그 사실을 먼저 말한다 — 세 장이 떠 있는 것만으로
 * "뭔가 걸렸다" 로 읽히면 안 된다.
 */
export function SuspectPanel({ suspects }: { suspects: SuspectCard[] }) {
  if (suspects.length === 0) return null;
  const anySuspected = suspects.some((s) => s.suspected);
  // 두 숫자의 뜻은 카드마다가 아니라 패널에 한 번만 적는다. 카드에 세 번 반복하면
  // 같은 문장 세 줄이 화면의 3분의 1을 먹고, 그러면 아무도 안 읽는다.
  const anyOnset = suspects.some((s) => s.onset_trajectory);
  const anyPrevalence = suspects.some((s) => s.prevalence_trajectory && !isSettled(s));

  return (
    <section className="suspect-panel" aria-labelledby="suspect-heading">
      <h3 id="suspect-heading">
        {anySuspected ? "먼저 볼 세 가지" : "지금 특별히 의심되는 항목은 없어요"}
      </h3>
      <p className="assess-muted suspect-lead">
        {anySuspected
          ? "검사값이 있으면 그 판정을, 없으면 추정 등급을 씁니다. 동년배 대비 위치와 장기 결과와의 연결까지 함께 따져 골랐어요."
          : "아래 세 항목은 의심돼서가 아니라 함께 보시라고 올렸어요."}
      </p>
      <div className="suspect-grid">
        {suspects.map((suspect) => (
          <SuspectItem key={suspect.target} suspect={suspect} />
        ))}
      </div>
      {(anyOnset || anyPrevalence) && (
        <p className="assess-fineprint suspect-note">
          {anyOnset && <><b>새로 생길 확률</b>은 지금 그 질환이 없다는 전제 아래 그 사이에 새로 생길 확률입니다. </>}
          {anyPrevalence && <><b>기준 초과</b>는 지금 넘었는지와 무관하게 그 나이에 기준을 넘고 있을 확률이라 서로 다릅니다. </>}
          지금 수치가 유지된다고 가정한 추정입니다.
        </p>
      )}
    </section>
  );
}
