/**
 * 검진표 → 구조화된 건강 데이터.
 *
 * OCR 을 "글자를 읽는 기술" 로 설명하지 않는다. 종이 한 장이 화면 안의 **다룰 수
 * 있는 값**으로 바뀌는 과정을 그대로 보여 준다 — 줄이 하나씩 짚이고, 숫자가 종이를
 * 떠나 오른쪽에 다시 선다.
 *
 * 연출은 전부 CSS 가 한다. 진행도(`--ln-progress`)와 줄마다 정해진 문턱값을
 * `clamp()` 로 견줘서 투명도와 이동을 만든다 — 프레임마다 React 가 할 일이 없다.
 */

import { LANDING_VALUES } from "../landingStory";
import { useSectionProgress } from "../scrollProgress";

/** 종이 위 줄이 짚이는 순간. */
const ROW_START = 0.18;
const ROW_STEP = 0.05;
/** 숫자가 종이를 떠나는 순간. */
const MOVE_START = 0.6;
const MOVE_STEP = 0.032;

export function OcrSection() {
  const ref = useSectionProgress<HTMLElement>();

  return (
    <section className="ln-ocr ln-scroll" id="service" ref={ref} aria-labelledby="ln-ocr-title">
      <div className="ln-sticky ln-ocr-stage">
        <header className="ln-section-head">
          <p className="ln-eyebrow">건강검진 · OCR</p>
          <h2 id="ln-ocr-title" className="ln-headline">
            검진표 한 장으로
            <br />
            시작합니다.
          </h2>
        </header>

        <div className="ln-ocr-flow">
          <figure className="ln-paper" aria-hidden="true">
            <figcaption className="ln-paper-head">
              <span>건강검진 결과통보서</span>
              <span className="ln-paper-date">2026-03-11</span>
            </figcaption>
            <ul className="ln-paper-rows">
              {LANDING_VALUES.map((value, index) => (
                <li
                  key={value.field}
                  className="ln-paper-row"
                  style={
                    {
                      "--t": ROW_START + index * ROW_STEP,
                      "--m": MOVE_START + index * MOVE_STEP,
                    } as React.CSSProperties
                  }
                >
                  <span className="ln-paper-label">{value.label}</span>
                  <span className="ln-paper-value">
                    {value.value}
                    <small>{value.unit}</small>
                  </span>
                </li>
              ))}
            </ul>
          </figure>

          <div className="ln-extracted" aria-hidden="true">
            <p className="ln-extracted-head">
              <span className="ln-dot-live" />
              건강 데이터로 저장됨
            </p>
            <ul className="ln-extracted-grid">
              {LANDING_VALUES.map((value, index) => (
                <li
                  key={value.field}
                  className="ln-extracted-item"
                  style={{ "--t": MOVE_START + index * MOVE_STEP + 0.02 } as React.CSSProperties}
                >
                  <span className="ln-extracted-label">{value.label}</span>
                  <strong className="ln-extracted-value">
                    {value.value}
                    <small>{value.unit}</small>
                  </strong>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* 낭독기와 모션 축소 환경을 위한 같은 내용의 글. 연출이 꺼져도 정보는 남는다. */}
        <p className="ln-sr-only">
          검진표에서 읽어 낸 값 {LANDING_VALUES.length}개:{" "}
          {LANDING_VALUES.map((value) => `${value.label} ${value.value} ${value.unit}`).join(", ")}.
        </p>
      </div>
    </section>
  );
}
