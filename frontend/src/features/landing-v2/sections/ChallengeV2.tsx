/**
 * 아는 것에서 하는 것으로.
 *
 * 챌린지는 이어봄의 핵심 기능이라 페이지 아래 작은 띠로 처리하지 않는다 —
 * 고정 구간을 하나 통째로 쓴다. 카드는 **세 장뿐**이고, 스크롤을 따라
 * 등장 → 진행 → 완료까지 한 번에 간다.
 *
 * 체크 표시는 SVG 획을 스크롤로 **그린다**(`stroke-dashoffset`). 체크가 툭 나타나는
 * 것과 그려지는 것의 차이가 이 섹션의 완성도 전부다. 다 그려진 체크는 링이 고스트
 * 라벤더로 채워지며 캡슐 진행 막대도 같이 찬다.
 */

import { LANDING_CHALLENGES } from "../../landing/landingStory";
import { useSectionProgress } from "../../landing/scrollProgress";

/** 카드가 서는 순간 · 진행이 차는 순간 · 체크가 그려지는 순간. */
const ENTER_START = 0.07;
const ENTER_STEP = 0.07;
const FILL_START = 0.36;
const FILL_STEP = 0.07;
const CHECK_START = 0.64;
const CHECK_STEP = 0.07;

export function ChallengeV2() {
  const ref = useSectionProgress<HTMLElement>();

  return (
    <section className="lnv2-challenge lnv2-scroll" id="v2-challenge" ref={ref} aria-labelledby="lnv2-challenge-title">
      <div className="lnv2-sticky lnv2-challenge-stage">
        <header className="lnv2-head">
          <p className="lnv2-chip">맞춤 건강 챌린지</p>
          <h2 id="lnv2-challenge-title" className="lnv2-headline">
            알기만 하는 건강관리에서,
            <br />
            실천하는 건강관리로.
          </h2>
          <p className="lnv2-lead lnv2-lead-sm">
            검진 수치와 생활습관을 함께 보고, 오늘 할 수 있는 크기로 제안합니다.
          </p>
        </header>

        <ul className="lnv2-challenge-list">
          {LANDING_CHALLENGES.map((challenge, index) => (
            <li
              key={challenge.id}
              className="lnv2-challenge-card"
              style={
                {
                  "--enter": ENTER_START + index * ENTER_STEP,
                  "--fill": FILL_START + index * FILL_STEP,
                  "--check": CHECK_START + index * CHECK_STEP,
                  "--rate": challenge.done / challenge.total,
                } as React.CSSProperties
              }
            >
              <span className="lnv2-challenge-check" aria-hidden="true">
                <svg viewBox="0 0 34 34" focusable="false">
                  <circle cx="17" cy="17" r="16" className="lnv2-challenge-check-fill" />
                  <circle cx="17" cy="17" r="16" className="lnv2-challenge-check-ring" />
                  <path
                    className="lnv2-challenge-check-mark"
                    d="M10 17.5 L15 22.5 L24 12.5"
                    pathLength={1}
                    fill="none"
                  />
                </svg>
              </span>

              <p className="lnv2-challenge-title">{challenge.title}</p>
              <p className="lnv2-challenge-detail">{challenge.detail}</p>

              <div className="lnv2-challenge-progress">
                <span className="lnv2-challenge-track" aria-hidden="true">
                  <span className="lnv2-challenge-bar" />
                </span>
                <span className="lnv2-challenge-count">
                  이번 주 {challenge.done}/{challenge.total}일
                </span>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
