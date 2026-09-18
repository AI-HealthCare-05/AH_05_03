/**
 * 아는 것에서 하는 것으로.
 *
 * 챌린지는 이어봄의 핵심 기능이라 페이지 아래 작은 띠로 처리하지 않는다 —
 * 고정 구간을 하나 통째로 쓴다. 카드는 **세 장뿐**이고, 스크롤을 따라
 * 등장 → 진행 → 완료까지 한 번에 간다.
 *
 * 체크 표시는 SVG 획을 스크롤로 **그린다**(`stroke-dashoffset`). 체크가 툭 나타나는
 * 것과 그려지는 것의 차이가 이 섹션의 완성도 전부다.
 */

import { LANDING_CHALLENGES } from "../landingStory";
import { useSectionProgress } from "../scrollProgress";

/** 카드가 서는 순간 · 진행이 차는 순간 · 체크가 그려지는 순간. */
const ENTER_START = 0.08;
const ENTER_STEP = 0.07;
const FILL_START = 0.38;
const FILL_STEP = 0.07;
const CHECK_START = 0.66;
const CHECK_STEP = 0.07;

export function ChallengeSection() {
  const ref = useSectionProgress<HTMLElement>();

  return (
    <section className="ln-challenge ln-scroll" id="challenge" ref={ref} aria-labelledby="ln-challenge-title">
      <div className="ln-sticky ln-challenge-stage">
        <header className="ln-section-head">
          <p className="ln-eyebrow">맞춤 건강 챌린지</p>
          <h2 id="ln-challenge-title" className="ln-headline">
            알기만 하는 건강관리에서,
            <br />
            실천하는 건강관리로.
          </h2>
          <p className="ln-lead ln-lead-sm">
            검진 수치와 생활습관을 함께 보고, 오늘 할 수 있는 크기로 제안합니다.
          </p>
        </header>

        <ul className="ln-challenge-list">
          {LANDING_CHALLENGES.map((challenge, index) => (
            <li
              key={challenge.id}
              className="ln-challenge-card"
              style={
                {
                  "--enter": ENTER_START + index * ENTER_STEP,
                  "--fill": FILL_START + index * FILL_STEP,
                  "--check": CHECK_START + index * CHECK_STEP,
                  "--rate": challenge.done / challenge.total,
                } as React.CSSProperties
              }
            >
              <div className="ln-challenge-top">
                <span className="ln-challenge-check" aria-hidden="true">
                  <svg viewBox="0 0 32 32" focusable="false">
                    <circle cx="16" cy="16" r="15" className="ln-challenge-check-ring" />
                    <path
                      className="ln-challenge-check-mark"
                      d="M9.5 16.5 L14 21 L22.5 11.5"
                      pathLength={1}
                      fill="none"
                    />
                  </svg>
                </span>
                <div>
                  <p className="ln-challenge-title">{challenge.title}</p>
                  <p className="ln-challenge-detail">{challenge.detail}</p>
                </div>
              </div>

              <div className="ln-challenge-progress">
                <div className="ln-challenge-track" aria-hidden="true">
                  <span className="ln-challenge-bar" />
                </div>
                <p className="ln-challenge-count">
                  이번 주 {challenge.done}/{challenge.total}일
                </p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
