/**
 * 첫 화면. 카드도 스크린샷도 없고 **큰 문장 하나와 그림 하나**뿐이다.
 *
 * 그림은 서비스 이름 그대로다 — 흩어진 점(검진 수치 · 몸의 신호 · 대화 · 가족)이
 * 스크롤과 함께 한 줄로 모인다. 스크롤을 시작하면 글자가 비키고 선이 이어지면서
 * 다음 장면으로 넘어간다.
 */

import { Link } from "react-router-dom";

import { useSectionProgress } from "../scrollProgress";

/** 점이 흩어져 있던 자리. 선 위의 최종 위치에서 얼마나 떨어져 있었나(사용자 단위). */
const DOTS = [
  { x: 40, y: 112, dx: -46, dy: -58, r: 4.5 },
  { x: 108, y: 96, dx: -18, dy: 62, r: 3 },
  { x: 176, y: 78, dx: 34, dy: -74, r: 5.5 },
  { x: 244, y: 66, dx: -52, dy: 48, r: 3.5 },
  { x: 312, y: 62, dx: 28, dy: 70, r: 4 },
  { x: 380, y: 66, dx: 62, dy: -44, r: 3 },
  { x: 448, y: 76, dx: -34, dy: -66, r: 5 },
  { x: 516, y: 90, dx: 46, dy: 54, r: 3.5 },
  { x: 584, y: 100, dx: 18, dy: -58, r: 4.5 },
  { x: 652, y: 104, dx: 56, dy: 40, r: 3 },
] as const;

export function HeroSection() {
  const ref = useSectionProgress<HTMLElement>();

  return (
    <section className="ln-hero ln-scroll" ref={ref} aria-labelledby="ln-hero-title">
      <div className="ln-sticky ln-hero-stage">
        <div className="ln-hero-copy">
          <p className="ln-eyebrow">이어봄 · 가족 건강 기록</p>
          <h1 id="ln-hero-title" className="ln-display">
            흩어진 건강 기록을,
            <br />
            하나로 이어봅니다.
          </h1>
          <p className="ln-lead">
            검진 데이터부터 생활습관, 몸의 기록까지.
            <br className="ln-br-desktop" /> 이어봄이 건강의 흐름을 연결합니다.
          </p>
          <div className="ln-hero-actions">
            <Link className="ln-button ln-button-primary" to="/signup">
              이어봄 시작하기
            </Link>
            <a className="ln-button ln-button-ghost" href="#service">
              서비스 둘러보기
            </a>
          </div>
        </div>

        <div className="ln-hero-visual" aria-hidden="true">
          <svg viewBox="0 0 692 180" role="presentation" focusable="false">
            <defs>
              <linearGradient id="ln-hero-line" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="var(--ln-line-start)" />
                <stop offset="100%" stopColor="var(--ln-line-end)" />
              </linearGradient>
              <linearGradient id="ln-hero-area" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--ln-line-start)" stopOpacity="0.16" />
                <stop offset="100%" stopColor="var(--ln-line-start)" stopOpacity="0" />
              </linearGradient>
            </defs>
            {/* 선 아래 옅은 면. 선 하나만 두면 첫 화면이 비어 보인다. */}
            <path
              className="ln-hero-area"
              d="M40 112 C 140 96, 210 62, 312 62 S 500 84, 652 104 L652 180 L40 180 Z"
              fill="url(#ln-hero-area)"
            />
            <path
              className="ln-hero-path"
              d="M40 112 C 140 96, 210 62, 312 62 S 500 84, 652 104"
              pathLength={1}
              fill="none"
              stroke="url(#ln-hero-line)"
              strokeWidth="3.5"
              strokeLinecap="round"
            />
            {DOTS.map((dot) => (
              <circle
                key={`${dot.x}-${dot.y}`}
                className="ln-hero-dot"
                cx={dot.x}
                cy={dot.y}
                r={dot.r}
                style={{ "--dx": dot.dx, "--dy": dot.dy } as React.CSSProperties}
              />
            ))}
          </svg>
        </div>

        <p className="ln-scroll-hint" aria-hidden="true">
          <span />
          스크롤
        </p>
      </div>
    </section>
  );
}
