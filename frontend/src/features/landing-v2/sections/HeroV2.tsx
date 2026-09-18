/**
 * 첫 화면. **큰 문장 하나와 그림 하나**뿐이다. 카드도 스크린샷도 없다.
 *
 * 그림은 서비스 이름을 그대로 그린다 — 흩어져 기울어 있던 기록 캡슐 다섯이
 * 스크롤과 함께 한 줄로 정렬된다. 디자인 시스템의 어휘가 캡슐이므로 히어로의
 * 유일한 그림도 캡슐로 만든다(장식 blob 이 아니라 **내용이 적힌 기록**이다).
 *
 * 연출은 CSS 가 전부 한다. `--ln-progress` 하나를 두 구간으로 쪼개 쓴다.
 *   0 → 0.52   흩어진 캡슐이 제자리를 찾는다
 *   0.52 → 1   글이 비키고 캡슐 묶음이 떠오르며 다음 장면으로 넘어간다
 */

import { Link } from "react-router-dom";

import { useSectionProgress } from "../../landing/scrollProgress";

/**
 * 히어로 캡슐. `label` 은 실제로 이어봄이 잇는 기록의 종류다 — 의미 없는 도형을
 * 띄우지 않는다(검진 수치 · 몸의 신호 · 실천 · 가족, 네 갈래를 한 번씩).
 *
 * `dx`·`dy`·`rot` 은 **정렬되기 전 흩어져 있던 자리**다. 정렬된 모습은 CSS 의
 * 흐름 배치(세로 스택)가 만들고, 흩어짐은 그 위에 얹는 transform 으로만 준다 —
 * 절대 위치로 두면 캡슐마다 글자 길이가 달라 간격이 들쭉날쭉해진다.
 *
 * **흩어짐은 거의 가로로만 준다(`dy` 는 ±26px).** 세로로 크게 흩으면 맨 위
 * 캡슐이 CTA 버튼 위로 올라타고 맨 아래 캡슐은 화면 밖으로 잘렸다(1024×768
 * 실측). 가로에는 여유가 있고, 넘친 것은 `overflow-x: clip` 이 받는다.
 *
 * `tone` 은 디자인 시스템의 파스텔 세트에서 골라 리듬만 만든다(상태색이 아니다).
 *
 * **다섯 장을 넘기지 않는다.** 1024×768 에서 큰 문장 두 줄 + 리드 + CTA 를 세우면
 * 남는 높이가 한 화면에 240px 뿐이다(실측). 일곱 장은 스택이 화면 밖으로 나갔다.
 */
const PILLS = [
  { label: "LDL 167", dx: -196, dy: -22, rot: -11, tone: "lavender" },
  { label: "혈압 128/82", dx: 178, dy: 18, rot: 9, tone: "buttercream" },
  { label: "오른쪽 무릎이 아파요", dx: -150, dy: 24, rot: 6, tone: "cornflower" },
  { label: "저녁 걷기 6/7일", dx: 202, dy: -16, rot: -8, tone: "mint" },
  { label: "엄마 · 혈압 기록", dx: -170, dy: 26, rot: 11, tone: "blush" },
] as const;

export function HeroV2() {
  const ref = useSectionProgress<HTMLElement>();

  return (
    <section className="lnv2-hero lnv2-scroll" ref={ref} aria-labelledby="lnv2-hero-title">
      <div className="lnv2-sticky lnv2-hero-stage">
        <div className="lnv2-hero-copy">
          <p className="lnv2-chip">이어봄 · 가족 건강 기록</p>
          <h1 id="lnv2-hero-title" className="lnv2-display">
            건강을 기록하는 것에서,
            <br />
            건강을 이어가는 것으로.
          </h1>
          <p className="lnv2-lead">
            검진 데이터부터 생활습관, 몸의 기록까지.
            <br className="lnv2-br-wide" /> 이어봄이 건강의 흐름을 연결합니다.
          </p>
          <div className="lnv2-actions">
            <Link className="lnv2-btn lnv2-btn-primary lnv2-btn-lg" to="/signup">
              이어봄 시작하기
            </Link>
            <a className="lnv2-btn lnv2-btn-quiet lnv2-btn-lg" href="#v2-service">
              서비스 둘러보기
            </a>
          </div>
        </div>

        <div className="lnv2-hero-visual" aria-hidden="true">
          <div className="lnv2-hero-stack">
            {/* 정렬된 캡슐 뒤에 서는 한 줄. "흩어진 것이 하나의 흐름이 된다" 에서
                그 흐름 쪽이다 — 캡슐이 제자리를 찾은 뒤에야 그려진다. */}
            <span className="lnv2-hero-spine" />
            {PILLS.map((pill, index) => (
              <span
                key={pill.label}
                className="lnv2-hero-pill"
                data-tone={pill.tone}
                style={
                  {
                    /* 앞뒤 순서만 쓴다 — 자리는 흐름 배치가 잡는다. */
                    "--i": index,
                    "--dx": `${pill.dx}px`,
                    "--dy": `${pill.dy}px`,
                    "--rot": `${pill.rot}deg`,
                  } as React.CSSProperties
                }
              >
                {pill.label}
              </span>
            ))}
          </div>
        </div>

        <p className="lnv2-scroll-hint" aria-hidden="true">
          <span />
          스크롤
        </p>
      </div>
    </section>
  );
}
