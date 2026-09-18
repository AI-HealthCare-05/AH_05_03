/**
 * 가족 건강.
 *
 * 가족 선택은 **화면 위쪽에 그대로 세워 둔다.** 아래에 숨기면 이 기능이 있다는
 * 것을 아무도 모른다. 스크롤을 내리면 나 → 엄마 → 아빠로 넘어가고, 탭을 직접
 * 눌러도 같은 자리로 간다(스크롤이 단일 진실 원천이라 두 조작이 어긋나지 않는다).
 *
 * 정서: 감시가 아니라 연결이다. 그래서 "위험" 을 세우지 않고 **다음에 할 수 있는
 * 작은 일**을 한 줄로 적는다.
 */

import { LANDING_FAMILY, STATUS_LABEL } from "../landingStory";
import { useSceneIndex, useSectionProgress } from "../scrollProgress";

export function FamilySection() {
  const { index, update } = useSceneIndex(LANDING_FAMILY.length);
  const sectionRef = useSectionProgress<HTMLElement>({ onProgress: update });

  const focusMember = (memberIndex: number) => {
    const element = sectionRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const travel = rect.height - window.innerHeight;
    if (travel <= 0) return;
    const ratio = (memberIndex + 0.5) / LANDING_FAMILY.length;
    const top = window.scrollY + rect.top + travel * ratio;
    window.scrollTo({
      top,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  };

  const member = LANDING_FAMILY[index] ?? LANDING_FAMILY[0];

  return (
    <section
      className="ln-family ln-scroll"
      id="family"
      ref={sectionRef}
      aria-labelledby="ln-family-title"
    >
      <div className="ln-sticky ln-family-stage">
        <header className="ln-section-head">
          <p className="ln-eyebrow">가족 건강 관리</p>
          <h2 id="ln-family-title" className="ln-headline">
            내 건강에서,
            <br />
            우리 가족의 건강까지.
          </h2>
        </header>

        <div className="ln-family-tabs" role="tablist" aria-label="가족 구성원">
          {LANDING_FAMILY.map((item, itemIndex) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={itemIndex === index}
              className={`ln-family-tab${itemIndex === index ? " is-active" : ""}`}
              onClick={() => focusMember(itemIndex)}
            >
              <span className="ln-family-avatar" aria-hidden="true">
                {item.name.slice(0, 1)}
              </span>
              <span className="ln-family-tab-name">{item.name}</span>
            </button>
          ))}
        </div>

        <article className="ln-family-card" key={member.id}>
          <p className="ln-family-relation">{member.relation}</p>
          <p className="ln-family-summary">{member.summary}</p>
          <div className="ln-family-highlight">
            <span className="ln-family-highlight-label">{member.highlightLabel}</span>
            <strong className="ln-family-highlight-value">{member.highlightValue}</strong>
            <span className="ln-status" data-status={member.highlightStatus}>
              {STATUS_LABEL[member.highlightStatus]}
            </span>
          </div>
          <p className="ln-family-note">{member.note}</p>
        </article>
      </div>
    </section>
  );
}
