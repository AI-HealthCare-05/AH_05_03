/**
 * 가족 건강.
 *
 * 가족 선택은 **화면 위쪽에 캡슐 줄로 그대로 세워 둔다.** 아래에 숨기면 이 기능이
 * 있다는 것을 아무도 모른다. 스크롤을 내리면 나 → 엄마 → 아빠로 넘어가고, 캡슐을
 * 직접 눌러도 같은 자리로 간다(스크롤이 단일 진실 원천이라 두 조작이 어긋나지 않는다).
 *
 * 정서: 감시가 아니라 연결이다. 그래서 "위험" 을 세우지 않고 **다음에 할 수 있는
 * 작은 일**을 한 줄로 적는다.
 */

import { LANDING_FAMILY, STATUS_LABEL } from "../../landing/landingStory";
import { useSceneIndex, useSectionProgress } from "../../landing/scrollProgress";

export function FamilyV2() {
  const { index, update } = useSceneIndex(LANDING_FAMILY.length);
  const sectionRef = useSectionProgress<HTMLElement>({ onProgress: update });

  const focusMember = (memberIndex: number) => {
    const element = sectionRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const travel = rect.height - window.innerHeight;
    // 모션 축소에서는 고정이 풀려 이동할 거리가 없다. 그때는 카드가 전부 제자리에
    // 있으므로 아무것도 하지 않는 것이 맞다.
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
    <section className="lnv2-family lnv2-scroll" id="v2-family" ref={sectionRef} aria-labelledby="lnv2-family-title">
      <div className="lnv2-sticky lnv2-family-stage">
        <header className="lnv2-head">
          <p className="lnv2-chip">가족 건강 관리</p>
          <h2 id="lnv2-family-title" className="lnv2-headline">
            내 건강에서,
            <br />
            우리 가족의 건강까지.
          </h2>
        </header>

        <div className="lnv2-family-tabs" role="tablist" aria-label="가족 구성원">
          {LANDING_FAMILY.map((item, itemIndex) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={itemIndex === index}
              className={`lnv2-family-tab${itemIndex === index ? " is-active" : ""}`}
              onClick={() => focusMember(itemIndex)}
            >
              {/* 이름 첫 글자를 원 안에 넣지 않는다 — "나" 는 한 글자라 원과 이름이
                  "나 나" 로 겹쳐 읽혔다(실측). 이름만으로 충분히 또렷하다. */}
              <span>{item.name}</span>
            </button>
          ))}
        </div>

        <article className="lnv2-family-card" key={member.id}>
          <p className="lnv2-family-relation">{member.relation}</p>
          <p className="lnv2-family-summary">{member.summary}</p>
          <div className="lnv2-family-highlight">
            <span className="lnv2-family-highlight-label">{member.highlightLabel}</span>
            <strong className="lnv2-family-highlight-value">{member.highlightValue}</strong>
            <span className="lnv2-status" data-status={member.highlightStatus}>
              {STATUS_LABEL[member.highlightStatus]}
            </span>
          </div>
          <p className="lnv2-family-note">{member.note}</p>
        </article>
      </div>
    </section>
  );
}
