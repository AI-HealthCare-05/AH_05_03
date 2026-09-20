/**
 * 챗봇(봄이).
 *
 * 챗봇(봄이) 소개. 플로팅 런처는 공개 랜딩에 두지 않는다 — 로그인 뒤 제품
 * 화면의 `GlobalHealthAssistant` 만 캐릭터를 띄운다. 여기서는 한 가지만 못 박는다:
 * **이 대화는 내 기록을 향한다.** 앞 장면의 검진 수치·챌린지·어깨 기록이
 * 그대로 답으로 돌아온다.
 */

import { Reveal } from "../Reveal";
import { ASSISTANT_TURNS } from "../landingStory";

export function AssistantSection() {
  return (
    <section className="ln-assistant" aria-labelledby="ln-assistant-title">
      <div className="ln-container ln-assistant-inner">
        <Reveal as="header" className="ln-section-head ln-section-head-left">
          <p className="ln-eyebrow">건강 비서 봄이</p>
          <h2 id="ln-assistant-title" className="ln-headline">
            물어보면,
            <br />
            내 기록에서 답합니다.
          </h2>
          <p className="ln-lead ln-lead-sm">
            검진표에서 읽은 수치, 몸 위에 남긴 기록, 이번 주 챌린지가 모두 같은 대화 안에 있습니다.
          </p>
        </Reveal>

        <Reveal className="ln-assistant-thread" delay={0.08}>
          {ASSISTANT_TURNS.map((turn, index) => (
            <div key={turn.question} className="ln-assistant-turn" style={{ "--d": `${index * 0.12}s` } as React.CSSProperties}>
              <p className="ln-chat-bubble" data-from="user">
                {turn.question}
              </p>
              <p className="ln-chat-bubble" data-from="bomi">
                {turn.answer}
              </p>
            </div>
          ))}
        </Reveal>
      </div>
    </section>
  );
}
