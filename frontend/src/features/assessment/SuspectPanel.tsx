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

import type { DiseaseVerdict, RiskLevel, SuspectCard } from "./contracts";
import { LevelBadge } from "./VerdictCards";

const percent = (value: number) => `${(value * 100).toFixed(0)}%`;

/**
 * 다섯 해가 전부 같은 칸에 떨어졌나.
 *
 * GBDT 는 나이를 계단으로 쓴다. 5년을 옮겨도 같은 잎에 남는 일이 흔하고, 그러면
 * `지금 91% · 1년 91% · 2년 91% …` 여섯 줄이 세로로 쌓인다 — 읽을 것이 없는 자리에
 * 카드 절반을 쓴다. 카드 앞면과 5년 목록도 같은 기준으로 접는다.
 */
function isFlat(curve: { current_probability: number; prevalence_probability: number[] }): boolean {
  const points = [curve.current_probability, ...curve.prevalence_probability];
  return Math.max(...points) - Math.min(...points) < 0.005;
}

/**
 * 같은 값이 이어지는 구간을 한 줄로 묶는다.
 *
 * **왜 필요한가.** 이 곡선은 모델이 둘이 아니다 — 질환마다 모델은 **하나**고, 특징을
 * 고정한 채 `age` 만 옮겨 다시 채점한 것이다(`prediction.score_at`). GBDT 는 나이를
 * 계단으로 쓰므로 몇 해가 같은 잎에 남으면 값이 글자 그대로 같다. 실측으로 어떤
 * 프로필은 52~58세가 19.72% 로 평평하고 59세에서 계단이 생겼다.
 *
 * 그래서 `15% · 15% · 15% · 15% · 15% · 20%` 같은 줄이 나온다. 여섯 줄 중 다섯이
 * 같은 숫자인데, 읽는 사람은 **다섯 번 읽고 나서** 하나만 다르다는 것을 안다.
 * 값을 다듬지는 않는다 — 평평한 것이 모델의 답이므로 부드럽게 만들면 화면과 모델이
 * 갈라진다(`trajectory.prevalence_curve` 머리말). 접는 것은 표시일 뿐이다.
 *
 * 기존 `isFlat` 은 **전부** 같을 때만 걸려서 이 경우를 놓쳤다.
 */
export function collapseRuns(
  points: { years: number; value: number }[],
): { years: number; value: number; when: string }[] {
  const label = (y: number) => (y === 0 ? "지금" : `${y}년 뒤`);
  const runs: { years: number; value: number; when: string }[] = [];
  let start = 0;
  for (let i = 1; i <= points.length; i++) {
    const ended = i === points.length || Math.abs(points[i].value - points[start].value) >= 0.005;
    if (!ended) continue;
    const last = i - 1;
    runs.push({
      years: points[start].years,
      value: points[start].value,
      // 한 해뿐이면 그대로, 이어지면 범위로 적는다. 양쪽이 다 연수면 "뒤" 를 한 번만
      // 쓴다 — `3년 뒤 ~ 4년 뒤` 는 같은 말을 두 번 읽게 한다.
      when:
        last === start
          ? label(points[start].years)
          : points[start].years === 0
            ? `지금 ~ ${label(points[last].years)}`
            : `${points[start].years} ~ ${points[last].years}년 뒤`,
    });
    start = i;
  }
  return runs;
}

/** 측정이 "기준 이내" 라고 이미 답했나. 그러면 모델 확률을 덧붙이지 않는다. */
function isSettled(suspect: SuspectCard) {
  // `risk_level` 이 정본이고 `level` 은 옛 응답(스냅샷)을 위한 폴백이다 — 기록
  // 화면은 그날 저장한 판정을 그대로 그리므로 필드가 없는 판이 남아 있다.
  const normal = suspect.risk_level ? suspect.risk_level === "NORMAL" : suspect.level === "정상 범위";
  return suspect.basis === "측정" && normal;
}

/**
 * 측정이 **이미 기준을 넘었다**고 답했나.
 *
 * 그러면 앞날 숫자를 붙이지 않는다. 라벨을 만드는 검사값은 그 질환의 ML 입력에서
 * 차단되므로(`modeling/targets.py`), 공복혈당 148 을 넣어 확진된 사람에게도 당뇨
 * 모델은 그 값을 못 보고 16% 를 낸다 — 같은 카드에 "매우 높음" 배지와 "기준 초과
 * 지금 16%" 가 나란히 서 있었다. 확진에는 "앞으로" 가 아니라 "지금" 이 답이다.
 */
function isConfirmed(suspect: SuspectCard) {
  return suspect.basis === "측정" && (suspect.risk_level === "HIGH" || suspect.risk_level === "VERY_HIGH");
}

/**
 * 발병 확률 한 줄 — 숫자와, 같은 축 위의 동년배 눈금.
 *
 * "41% · 동년배 16%" 를 글자로만 두면 2.5 배라는 사실이 읽는 사람 머릿속 산수로
 * 남는다. 같은 track 위에 채움(나)과 눈금(동년배)을 두면 그 차이가 그냥 보인다.
 * 축은 0~100% 로 고정한다 — 카드마다 축이 다르면 카드 사이 비교가 거짓이 된다.
 */
function OnsetRow({
  years,
  value,
  peer,
  when,
}: {
  years: number;
  value: number;
  peer?: number;
  /** 시점 문구를 직접 정할 때. 같은 값이 이어지는 구간을 한 줄로 접을 때 쓴다. */
  when?: string;
}) {
  return (
    <li className="suspect-row">
      {/* 0 은 "지금" 이다. `0년 뒤` 라고 적으면 읽는 사람이 한 박자 멈춘다. */}
      <span className="suspect-when">{when ?? (years === 0 ? "지금" : `${years}년 뒤`)}</span>
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
  const confirmed = isConfirmed(suspect);
  const measured = suspect.basis === "측정";
  // **여기서 다시 판단하지 않는다.** 곡선을 낼지 말지는 서버가 한 곳에서 정한다
  // (`assessment.model_contradicts_measurement`) — 측정과 모델이 서로 반대 방향을
  // 가리킬 때만 지운다. 화면이 따로 막던 때는 판단이 두 곳에 있어서, 판정과
  // 어긋나지 않는 값(비만 91% · 지방간 66% · 대사증후군 58%)까지 같이 사라졌다.
  const showPrevalence = prevalence ?? undefined;

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
      <p className="suspect-reason">{suspect.reason}</p>

      {/* **이 숫자를 얼마나 믿어도 되는가.** 같은 "주의" 라도 신기능은 사망연계
          C 0.84 이고 낮은 HDL 은 0.51 이다 — 그 사실이 화면에 없으면 둘이 같아
          보인다. 순위 점수의 `evidence_weight` 를 그대로 보인다. */}
      <p className="suspect-evidence">
        <span className="suspect-evidence-label">장기 근거</span>
        <span className="suspect-evidence-dots" aria-hidden="true">
          <i className={suspect.evidence_weight >= 0.5 ? "on" : ""} />
          <i className={suspect.evidence_weight >= 0.7 ? "on" : ""} />
          <i className={suspect.evidence_weight >= 1.0 ? "on" : ""} />
        </span>
        <span>
          {suspect.evidence_weight >= 1.0
            ? "사망연계에서 확인됨"
            : suspect.evidence_weight >= 0.7
              ? "어느 정도 확인됨"
              : suspect.evidence_weight >= 0.5
                ? "아직 못 쟀음"
                : "장기 결과와 연결이 약함"}
        </span>
      </p>

      {onset ? (
        <section className="suspect-series">
          <h5>
            아직 없다면, 앞으로 <span className="assess-muted">해마다 새로 생길 가능성</span>
          </h5>
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
        // **한 줄짜리 화살표 사슬을 표로 바꿨다.** 지평이 1~5년 다섯 개가 되면서
        // `지금 47% → 1년 46% → 2년 45% → …` 이 두 줄로 접히고, 그 줄에서 어느
        // 숫자가 어느 해인지 눈으로 되짚어야 했다. 발병 곡선과 같은 막대로 둔다 —
        // 두 곡선의 뜻은 다르지만 읽는 방법은 같아야 한다.
        //
        // **제목이 전제를 먼저 말한다.** "기준을 넘고 있을 확률" 은 명세서 문장이고,
        // 정작 중요한 조건(`지금 수치가 유지된다는 가정`)이 저 아래 잔글씨에만 있었다.
        <section className="suspect-series">
          <h5>
            이대로 지내면 <span className="assess-muted">해마다 기준을 넘고 있을 가능성</span>
          </h5>
          {isFlat(showPrevalence) ? (
            // 여섯 줄이 전부 같은 숫자면(실측 비만 91% × 6) 세로로 쌓아 봐야 읽을 것이
            // 없다. 한 줄만 두고 "그대로" 를 말로 적는다.
            <>
              <ul className="suspect-rows">
                <OnsetRow years={0} value={showPrevalence.current_probability} />
              </ul>
              <p className="suspect-flat assess-muted">
                {showPrevalence.horizons_years[showPrevalence.horizons_years.length - 1]}년 뒤까지 이 수준이
                이어져요.
              </p>
            </>
          ) : (
            <ul className="suspect-rows">
              {collapseRuns([
                { years: 0, value: showPrevalence.current_probability },
                ...showPrevalence.horizons_years.map((year, i) => ({
                  years: year,
                  value: showPrevalence.prevalence_probability[i],
                })),
              ]).map((run) => (
                <OnsetRow key={run.years} years={run.years} value={run.value} when={run.when} />
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {confirmed ? (
        <p className="suspect-now">
          <b>지금</b> 기준을 넘은 상태예요. <b>재측정과 진료 상담</b>이 다음 단계입니다.
        </p>
      ) : null}
      {!confirmed && !onset && !showPrevalence ? (
        <p className="suspect-none assess-muted">
          {settled
            ? "검사값이 기준 안에 있어 앞으로의 숫자는 내지 않았어요."
            : "이 질환은 앞으로의 발병 확률을 낼 근거가 아직 없어요."}
        </p>
      ) : null}
    </article>
  );
}

/** 유지로 볼 폭. 이보다 작은 변화는 GBDT 계단의 잡음이지 예측이 아니다. */
const FLAT = 0.005;

interface OutlookRow {
  key: string;
  name: string;
  years: number;
  value: number;
  /** 발병 궤적일 때 동년배 값. 유병 곡선에는 없다. */
  peer?: number;
  /** 유병 곡선일 때 지금 값. 발병 궤적에는 없다(지금은 0 이라는 전제다). */
  now?: number;
}

/**
 * 질환마다 **5년 뒤 한 줄**. 세 장 카드 아래에 붙는다.
 *
 * ## 왜 필요했나
 *
 * 카드 세 장은 아래 질환별 결과의 **급한 순** 셋이다. 그런데 급한 셋이 전부 이미
 * 기준을 넘은 상태이면 세 장 모두 "지금 넘었어요" 만 적고 앞날 숫자가 하나도 안
 * 남는다 — 실측으로 그런 화면이 나왔다(지질 셋이 전부 '높음'). 제목이 "발병 예측"
 * 인데 예측이 한 줄도 없는 셈이었다. 순위는 그대로 두고 나머지를 같이 싣는다.
 *
 * ## 두 물음을 섞어 정렬하지 않는다
 *
 * 첫 판에서는 열넷을 한 줄로 세워 확률 큰 순으로 정렬했다. 그런데 두 숫자의 뜻이
 * 다르다 — "새로 생길" 과 "그때 넘고 있을" 은 같은 자를 쓰지 않는다. 실측에서
 * 고혈압 18%(동년배 22% 라 **평균 이하**)가 만성염증 18%(기준 초과) 바로 옆에
 * 섰다. 줄마다 꼬리표를 달아도 위에서 아래로 훑는 사람은 순서를 먼저 읽는다.
 * 그래서 블록을 갈랐다.
 *
 * ## 안 변하는 줄에 같은 숫자를 두 번 적지 않는다
 *
 * GBDT 는 나이를 계단으로 쓰므로 5년을 옮겨도 같은 칸에 떨어지는 일이 흔하다.
 * 실측(대사증후군 프리셋)에서 유병 여섯 줄 중 **다섯 줄이 +0.0%p** 였다.
 * `지금 21% → 5년 21%` 는 정보가 없는 자리를 두 번 읽게 만든다. "유지" 한 단어로
 * 접고, 실제로 움직인 줄에만 변화폭을 적는다.
 */
function ForwardOutlook({ verdicts, ranked }: { verdicts: DiseaseVerdict[]; ranked: Map<string, number> }) {
  const onsets: OutlookRow[] = [];
  const prevalences: OutlookRow[] = [];
  const settled: string[] = [];
  const unknown: string[] = [];
  // 카드마다 지평이 다를 수 있다(나이가 표 상한에 가까우면 잘린다). 마지막으로
  // 읽은 값을 쓰면 목록 순서가 제목을 바꾼다. 가장 먼 값으로 못 박는다.
  let horizon = 0;

  for (const verdict of verdicts) {
    const onset = verdict.reference?.trajectory;
    const prevalence = verdict.reference?.prevalence_trajectory;
    if (onset && onset.onset_probability.length > 0) {
      const last = onset.onset_probability.length - 1;
      horizon = Math.max(horizon, onset.horizons_years[last]);
      onsets.push({
        key: verdict.key,
        name: verdict.name,
        years: horizon,
        value: onset.onset_probability[last],
        peer: onset.population_onset_probability?.[last],
      });
    } else if (prevalence && prevalence.prevalence_probability.length > 0) {
      const last = prevalence.prevalence_probability.length - 1;
      horizon = Math.max(horizon, prevalence.horizons_years[last]);
      prevalences.push({
        key: verdict.key,
        name: verdict.name,
        years: horizon,
        value: prevalence.prevalence_probability[last],
        now: prevalence.current_probability,
      });
    } else if (verdict.risk_level === "HIGH" || verdict.risk_level === "VERY_HIGH") {
      // 서버가 곡선을 지운 칸(`assessment._drop_forecasts_when_already_present`).
      settled.push(verdict.name);
    } else {
      unknown.push(verdict.name);
    }
  }

  if (onsets.length === 0 && prevalences.length === 0 && settled.length === 0) return null;
  // **위 세 장이 먼저 온다.** 패널이 "급한 순 세 가지" 를 세워 놓고 아래 목록은
  // 전혀 다른 질환으로 시작하면, 같은 패널이 두 이야기를 하는 것으로 읽힌다.
  // 그 셋을 순위대로 맨 위에 두고, 나머지는 확률 큰 순으로 잇는다.
  const byRank = (a: OutlookRow, b: OutlookRow) => {
    const ra = ranked.get(a.key);
    const rb = ranked.get(b.key);
    if (ra !== undefined && rb !== undefined) return ra - rb;
    if (ra !== undefined) return -1;
    if (rb !== undefined) return 1;
    return b.value - a.value;
  };
  onsets.sort(byRank);
  prevalences.sort(byRank);
  const total = onsets.length + prevalences.length + settled.length + unknown.length;

  return (
    <section className="suspect-outlook" aria-labelledby="suspect-outlook-heading">
      <h4 id="suspect-outlook-heading">
        {horizon || 5}년 뒤 <span className="assess-muted">· 질환 {total}가지 전부</span>
      </h4>

      {onsets.length > 0 && (
        <div className="outlook-block">
          <p className="outlook-block-title">
            새로 생길 확률{" "}
            <span className="assess-muted">지금은 없다고 보고 낸 값 · 위 세 가지 먼저, 나머지는 확률 높은 순</span>
          </p>
          {/* **왜 몇 개뿐인지 화면이 말하지 않았다.** 이 블록에 둘, 아래 블록에 열둘이
              서는데 그 갈림의 이유가 어디에도 없어서, 읽는 사람은 "나머지 질환은
              빠졌다" 로 읽는다. 실제로 그 질문을 받았다.

              갈림은 취향이 아니다. 이 곡선은 단면 유병률을 illness-death 모형으로
              뒤집어 만드는데, 그 뒤집기가 **"한 번 생기면 없어지지 않는다"** 를 전제로
              한다. 되돌아가는 수치에서는 순발생률이 아니라 순전이율이 나오고, 일부는
              방향까지 뒤집힌다(낮은 HDL 사망연계 C 0.51 · 이상지질 65세+ 0.43 —
              `trajectory.EXCLUDED_TARGETS`). 그래서 셋만 켜고 나머지는 다른 물음으로
              답한다. 개수를 적지 않고 **규칙**을 적는다 — 이미 기준을 넘은 질환은
              그 셋에서도 빠지므로 개수는 사람마다 다르다. */}
          <p className="outlook-block-why assess-muted">
            되돌아가지 않는 질환(당뇨·고혈압·신기능)에만 낼 수 있어요. 나머지는 수치가 오르내려서 "새로 생김"
            이라는 말이 성립하지 않아, 아래 <b>기준을 넘고 있을 확률</b>로 답합니다.
          </p>
          <ul className="suspect-outlook-list">
            {onsets.map((row) => (
              <li key={row.key} className="outlook-onset">
                <span className="outlook-name">
                  {/* 숫자 대신 왕관. 순위는 바로 위 카드 셋이 이미 "1순위·2순위" 로 적으므로
                      여기서는 **그 셋에 든다는 표시**만 필요하다. 숫자를 또 적으면 같은
                      정보가 두 번 서고, 목록에서는 이름보다 숫자가 먼저 읽힌다.
                      순위 자체는 낭독기와 마우스오버에 남긴다. */}
                  {ranked.has(row.key) && (
                    <b className="outlook-rank" title={`급한 순 ${ranked.get(row.key)}위`} aria-label={`급한 순 ${ranked.get(row.key)}위`}>
                      👑
                    </b>
                  )}
                  {row.name}
                </span>
                <span className="outlook-bar" aria-hidden="true">
                  <i style={{ width: `${Math.min(row.value * 100, 100)}%` }} />
                  {row.peer !== undefined && <em style={{ left: `${Math.min(row.peer * 100, 100)}%` }} />}
                </span>
                <b className="outlook-value">{percent(row.value)}</b>
                <span className="outlook-note">
                  {row.peer === undefined
                    ? "동년배 값이 없어요"
                    : row.value > row.peer + FLAT
                      ? `동년배 ${percent(row.peer)}보다 높아요`
                      : row.value < row.peer - FLAT
                        ? `동년배 ${percent(row.peer)}보다 낮아요`
                        : `동년배 ${percent(row.peer)}와 비슷해요`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {prevalences.length > 0 && (
        <div className="outlook-block">
          <p className="outlook-block-title">
            기준을 넘고 있을 확률{" "}
            <span className="assess-muted">지금 넘었든 아니든 그때 재면 넘어 있을 가능성 · 위 세 가지 먼저, 나머지는 확률 높은 순</span>
          </p>
          {/* 위 블록의 짝. 여기 있는 질환이 "빠진" 것이 아니라 **다른 물음으로 답한**
              것임을 같이 적어야 갈림이 읽힌다. */}
          <p className="outlook-block-why assess-muted">
            위 블록에 없는 질환은 여기 있어요. 되돌아갈 수 있는 수치라 발병 시점을 말할 수 없고, 대신 그때
            재면 넘어 있을 가능성을 냅니다.
          </p>
          <ul className="suspect-outlook-list">
            {prevalences.map((row) => {
              const delta = row.now === undefined ? 0 : row.value - row.now;
              const flat = Math.abs(delta) < FLAT;
              return (
                <li key={row.key} className="outlook-prevalence">
                  <span className="outlook-name">
                    {/* 숫자 대신 왕관. 순위는 바로 위 카드 셋이 이미 "1순위·2순위" 로 적으므로
                      여기서는 **그 셋에 든다는 표시**만 필요하다. 숫자를 또 적으면 같은
                      정보가 두 번 서고, 목록에서는 이름보다 숫자가 먼저 읽힌다.
                      순위 자체는 낭독기와 마우스오버에 남긴다. */}
                  {ranked.has(row.key) && (
                    <b className="outlook-rank" title={`급한 순 ${ranked.get(row.key)}위`} aria-label={`급한 순 ${ranked.get(row.key)}위`}>
                      👑
                    </b>
                  )}
                    {row.name}
                  </span>
                  <span className="outlook-bar" aria-hidden="true">
                    <i style={{ width: `${Math.min(row.value * 100, 100)}%` }} />
                  </span>
                  <b className="outlook-value">{percent(row.value)}</b>
                  <span className={`outlook-note${flat ? "" : delta > 0 ? " is-up" : " is-down"}`}>
                    {flat
                      ? "지금과 비슷해요"
                      : `지금 ${percent(row.now ?? 0)} → ${delta > 0 ? "▲" : "▼"} ${Math.abs(delta * 100).toFixed(0)}%p`}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* 이미 넘은 칸은 한 줄로 묶는다. 각각 한 줄씩 두면 같은 문장이 여섯 번
          반복되면서 실제로 읽어야 하는 위쪽 숫자를 밀어낸다. */}
      {settled.length > 0 && (
        <p className="outlook-settled">
          <b>앞날 숫자를 내지 않은 {settled.length}가지</b> {settled.join(" · ")}
          <span className="assess-muted">
            {" "}
            — 이미 기준을 넘었는데 모델은 그 검사값을 못 봅니다(라벨이라 학습에서 차단). 두 숫자가 서로 다투므로
            적지 않았습니다. 재측정과 진료 상담이 다음 단계입니다.
          </span>
        </p>
      )}
      {unknown.length > 0 && (
        <p className="outlook-settled assess-muted">
          <b>앞날을 낼 근거가 없는 {unknown.length}가지</b> {unknown.join(" · ")}
        </p>
      )}
    </section>
  );
}

/**
 * 상위 세 장. 하나도 의심이 아니면 그 사실을 먼저 말한다 — 세 장이 떠 있는 것만으로
 * "뭔가 걸렸다" 로 읽히면 안 된다.
 */
export function SuspectPanel({ suspects, verdicts = [] }: { suspects: SuspectCard[]; verdicts?: DiseaseVerdict[] }) {
  if (suspects.length === 0) return null;
  const anySuspected = suspects.some((s) => s.suspected);
  // 두 숫자의 뜻은 카드마다가 아니라 패널에 한 번만 적는다. 카드에 세 번 반복하면
  // 같은 문장 세 줄이 화면의 3분의 1을 먹고, 그러면 아무도 안 읽는다.
  const anyOnset = suspects.some((s) => s.onset_trajectory);
  const anyPrevalence = suspects.some((s) => s.prevalence_trajectory && !isSettled(s));

  return (
    <section className="suspect-panel" aria-labelledby="suspect-heading">
      <h3 id="suspect-heading">
        만성질환 발병 예측
        <span className="assess-muted"> 급한 순 세 가지</span>
      </h3>
      <p className="assess-muted suspect-lead">
        {anySuspected ? (
          <>
            아래 <b>질환별 결과</b>에서 급한 순으로 세 가지를 뽑아, 그 질환이 <b>앞으로 어떻게 되는지</b>를 붙였어요.
            등급은 아래 카드와 같은 값이고, 같은 등급이면 장기 추적에서 근거가 확인된 질환을 먼저 둡니다.
          </>
        ) : (
          "지금 특별히 급한 항목은 없어요. 아래 세 항목은 함께 보시라고 올렸습니다."
        )}
      </p>
      <div className="suspect-grid">
        {suspects.map((suspect) => (
          <SuspectItem key={suspect.target} suspect={suspect} />
        ))}
      </div>
      <ForwardOutlook verdicts={verdicts} ranked={new Map(suspects.map((s) => [s.target, s.rank]))} />
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
