/**
 * 숫자를 이해로 바꾸는 장면.
 *
 * 여덟 개를 한꺼번에 세우지 않는다. **하나를 크게 세우고** 나머지는 그 아래에
 * 조용히 둔다 — 대시보드가 아니라 문장이다.
 *
 * 말의 선: 기준과 견준 위치만 말하고 병명을 말하지 않는다. `landingStory.ts` 의
 * `note` 와 `reference` 가 그 선을 지키는 문구다.
 */

import { Reveal } from "../Reveal";
import { HEADLINE_VALUE_FIELD, LANDING_VALUES, STATUS_LABEL } from "../landingStory";
import { useInView } from "../scrollProgress";
import { useCountUp } from "../useCountUp";

export function InsightSection() {
  const headline = LANDING_VALUES.find((value) => value.field === HEADLINE_VALUE_FIELD) ?? LANDING_VALUES[0];
  const rest = LANDING_VALUES.filter((value) => value.field !== headline.field);
  const { ref, inView } = useInView<HTMLDivElement>({ rootMargin: "0px 0px -20% 0px" });
  const counted = useCountUp(Number(headline.value), inView);

  return (
    <section className="ln-insight" aria-labelledby="ln-insight-title">
      <div className="ln-container">
        <Reveal as="header" className="ln-section-head">
          <p className="ln-eyebrow">건강 데이터 해석</p>
          <h2 id="ln-insight-title" className="ln-headline">
            숫자는 어렵지만,
            <br />내 건강은 쉽게.
          </h2>
        </Reveal>

        <div className="ln-insight-hero" ref={ref}>
          <p className="ln-insight-label">{headline.label}</p>
          <p className="ln-insight-number" data-status={headline.status}>
            <span aria-hidden="true">{Math.round(counted)}</span>
            <span className="ln-sr-only">{headline.value}</span>
            <small>{headline.unit}</small>
          </p>
          <p className="ln-insight-note">
            <span className="ln-status" data-status={headline.status}>
              {STATUS_LABEL[headline.status]}
            </span>
            {headline.note} · {headline.reference}
          </p>
          <p className="ln-insight-caveat">
            이어봄은 검사 결과를 진단하지 않습니다. 기준과 견준 위치를 보여 주고, 다음 행동을 함께 정합니다.
          </p>
        </div>

        <ul className="ln-insight-list">
          {rest.map((value, index) => (
            <Reveal as="li" key={value.field} delay={index * 0.04} className="ln-insight-row">
              <span className="ln-insight-row-label">{value.label}</span>
              <span className="ln-insight-row-value">
                {value.value}
                <small>{value.unit}</small>
              </span>
              <span className="ln-status" data-status={value.status}>
                {STATUS_LABEL[value.status]}
              </span>
              <span className="ln-insight-row-ref">{value.reference}</span>
            </Reveal>
          ))}
        </ul>
      </div>
    </section>
  );
}
