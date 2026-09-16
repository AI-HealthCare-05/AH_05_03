/**
 * 검진표 → 구조화된 건강 데이터.
 *
 * OCR 을 "글자를 읽는 기술" 로 설명하지 않는다. 종이 한 장이 화면 안의 **다룰 수
 * 있는 값**으로 바뀌는 과정을 그대로 보여 준다 — 업로드되고, 줄이 하나씩 짚이고,
 * 숫자가 종이를 떠나 오른쪽에 캡슐로 다시 선다.
 *
 * v1 과 다른 점은 재배치된 값의 모양이다. 이 디자인 시스템에서 값을 담는 그릇은
 * **캡슐**이므로, 떠난 숫자는 격자 카드가 아니라 캡슐 줄로 앉는다.
 *
 * 연출은 전부 CSS 다. 진행도(`--ln-progress`)와 줄마다 정해진 문턱값(`--t`·`--m`)을
 * `clamp()` 로 견줘 투명도와 이동을 만든다 — 프레임마다 React 가 할 일이 없다.
 */

import { LANDING_VALUES } from "../../landing/landingStory";
import { useSectionProgress } from "../../landing/scrollProgress";

/** 종이 위 줄이 짚이는 순간. */
const ROW_START = 0.2;
const ROW_STEP = 0.048;
/** 숫자가 종이를 떠나는 순간. */
const MOVE_START = 0.61;
const MOVE_STEP = 0.03;

export function OcrV2() {
  const ref = useSectionProgress<HTMLElement>();

  return (
    <section className="lnv2-ocr lnv2-scroll" id="v2-service" ref={ref} aria-labelledby="lnv2-ocr-title">
      <div className="lnv2-sticky lnv2-ocr-stage">
        <header className="lnv2-head">
          <p className="lnv2-chip">건강검진 · OCR</p>
          <h2 id="lnv2-ocr-title" className="lnv2-headline">
            검진표 한 장으로
            <br />
            시작하는 건강관리.
          </h2>
        </header>

        <div className="lnv2-ocr-flow">
          <figure className="lnv2-paper" aria-hidden="true">
            <figcaption className="lnv2-paper-head">
              <span className="lnv2-paper-name">건강검진 결과통보서</span>
              <span className="lnv2-paper-date">2026-03-11</span>
            </figcaption>

            {/* 업로드 → 읽는 중 → 저장됨. 세 상태를 한 캡슐 안에서 갈아 끼운다.
                브리프가 말하는 "업로드하는 장면에서 시작한다" 가 이 한 줄이다. */}
            <p className="lnv2-paper-state">
              <span className="lnv2-paper-state-dot" />
              <span className="lnv2-paper-state-text" data-phase="upload">
                검진표 업로드
              </span>
              <span className="lnv2-paper-state-text" data-phase="read">
                수치를 읽는 중
              </span>
              <span className="lnv2-paper-state-text" data-phase="done">
                건강 데이터로 저장됨
              </span>
            </p>

            <ul className="lnv2-paper-rows">
              {LANDING_VALUES.map((value, index) => (
                <li
                  key={value.field}
                  className="lnv2-paper-row"
                  style={
                    {
                      "--t": ROW_START + index * ROW_STEP,
                      "--m": MOVE_START + index * MOVE_STEP,
                    } as React.CSSProperties
                  }
                >
                  <span className="lnv2-paper-label">{value.label}</span>
                  <span className="lnv2-paper-value">
                    {value.value}
                    <small>{value.unit}</small>
                  </span>
                </li>
              ))}
            </ul>
          </figure>

          <ul className="lnv2-extracted" aria-hidden="true">
            {LANDING_VALUES.map((value, index) => (
              <li
                key={value.field}
                className="lnv2-extracted-pill"
                style={{ "--t": MOVE_START + index * MOVE_STEP + 0.02 } as React.CSSProperties}
              >
                <span className="lnv2-extracted-label">{value.label}</span>
                <span className="lnv2-extracted-value">
                  {value.value}
                  <small>{value.unit}</small>
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* 낭독기와 모션 축소 환경을 위한 같은 내용의 글. 연출이 꺼져도 정보는 남는다. */}
        <p className="lnv2-sr-only">
          검진표에서 읽어 낸 값 {LANDING_VALUES.length}개:{" "}
          {LANDING_VALUES.map((value) => `${value.label} ${value.value} ${value.unit}`).join(", ")}.
        </p>
      </div>
    </section>
  );
}
