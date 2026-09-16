/**
 * 숫자를 이해로 바꾸는 장면.
 *
 * 여덟 개를 한꺼번에 세우지 않는다. **하나를 크게 세우고** 나머지는 그 아래에
 * 조용히 둔다 — 대시보드가 아니라 문장이다. 디자인 시스템의 디스플레이 단계를
 * 숫자 하나에 통째로 쓴다(굵기 300 의 96px 숫자는 그 자체로 조각이다).
 *
 * 상태는 **세 칸 캡슐** 하나로 보여 준다. 막대 위에 값을 찍는 그림은 "어디까지가
 * 위험" 을 그리게 되는데 이 서비스는 그 선을 긋지 않는다 — 정상 / 주의 / 관리 필요
 * 중 지금 어디인지만 켜고, 그 옆에 항상 참고 기준을 적는다.
 *
 * 말의 선: 기준과 견준 위치만 말하고 병명을 말하지 않는다(docs/22 · 31 과 같은 선).
 */

import { Reveal } from "../../landing/Reveal";
import {
  HEADLINE_VALUE_FIELD,
  LANDING_VALUES,
  STATUS_LABEL,
  type ValueStatus,
} from "../../landing/landingStory";
import { useCountUp } from "../../landing/useCountUp";
import { useInView } from "../../landing/scrollProgress";

/** 캡슐 세 칸의 순서. `STATUS_LABEL` 의 키 순서에 의존하지 않게 여기 적어 둔다. */
const STATUS_STEPS: ValueStatus[] = ["normal", "watch", "manage"];

export function InsightV2() {
  const headline = LANDING_VALUES.find((value) => value.field === HEADLINE_VALUE_FIELD) ?? LANDING_VALUES[0];
  const rest = LANDING_VALUES.filter((value) => value.field !== headline.field);
  const { ref, inView } = useInView<HTMLDivElement>({ rootMargin: "0px 0px -20% 0px" });
  const counted = useCountUp(Number(headline.value), inView);

  return (
    <section className="lnv2-insight" aria-labelledby="lnv2-insight-title">
      <div className="lnv2-container">
        <Reveal as="header" className="lnv2-head">
          <p className="lnv2-chip">건강 데이터 해석</p>
          <h2 id="lnv2-insight-title" className="lnv2-headline">
            숫자는 어렵지만,
            <br />내 건강은 쉽게.
          </h2>
        </Reveal>

        <div className="lnv2-insight-hero" ref={ref}>
          <p className="lnv2-insight-label">{headline.label}</p>
          <p className="lnv2-insight-number" data-status={headline.status}>
            {/* 세는 동안 자리 폭이 흔들리지 않게 숫자는 tabular 로 둔다(CSS). */}
            <span aria-hidden="true">{Math.round(counted)}</span>
            <span className="lnv2-sr-only">{headline.value}</span>
            <small>{headline.unit}</small>
          </p>

          <p className="lnv2-insight-steps" role="img" aria-label={`상태 ${STATUS_LABEL[headline.status]}`}>
            {STATUS_STEPS.map((step) => (
              <span
                key={step}
                className="lnv2-insight-step"
                data-step={step}
                data-on={step === headline.status}
              >
                {STATUS_LABEL[step]}
              </span>
            ))}
          </p>

          <p className="lnv2-insight-note">
            {headline.note} · {headline.reference}
          </p>
          <p className="lnv2-insight-caveat">
            이어봄은 검사 결과를 진단하지 않습니다. 기준과 견준 위치를 보여 주고, 다음 행동을 함께 정합니다.
          </p>
        </div>

        <ul className="lnv2-insight-list">
          {rest.map((value, index) => (
            <Reveal as="li" key={value.field} delay={index * 0.04} className="lnv2-insight-row">
              <span className="lnv2-insight-row-label">{value.label}</span>
              <span className="lnv2-insight-row-value">
                {value.value}
                <small>{value.unit}</small>
              </span>
              <span className="lnv2-status" data-status={value.status}>
                {STATUS_LABEL[value.status]}
              </span>
              <span className="lnv2-insight-row-ref">{value.reference}</span>
            </Reveal>
          ))}
        </ul>
      </div>
    </section>
  );
}
