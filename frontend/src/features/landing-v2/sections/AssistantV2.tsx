/**
 * 챗봇(봄이).
 *
 * 큰 섹션으로 만들지 않는다 — 챗봇은 목적지가 아니라 **모든 화면에 따라다니는
 * 보조 인터페이스**이고, 그 사실은 화면 오른쪽 아래에 늘 떠 있는 런처가 이미
 * 말하고 있다(`AssistantLauncherV2`). 여기서는 한 가지만 못 박는다:
 * **이 대화는 내 기록을 향한다.** 앞 장면의 검진 수치·챌린지·어깨 기록이
 * 그대로 답으로 돌아온다.
 */

import { Reveal } from "../../landing/Reveal";
import { ASSISTANT_TURNS } from "../../landing/landingStory";

export function AssistantV2() {
  return (
    <section className="lnv2-assistant" aria-labelledby="lnv2-assistant-title">
      <div className="lnv2-container lnv2-assistant-inner">
        <Reveal as="header" className="lnv2-head lnv2-head-left">
          <p className="lnv2-chip">건강 비서 봄이</p>
          <h2 id="lnv2-assistant-title" className="lnv2-headline">
            물어보면,
            <br />
            내 기록에서 답합니다.
          </h2>
          <p className="lnv2-lead lnv2-lead-sm">
            검진표에서 읽은 수치, 몸 위에 남긴 기록, 이번 주 챌린지가 모두 같은 대화 안에 있습니다.
          </p>
        </Reveal>

        <Reveal className="lnv2-thread" delay={0.08}>
          {ASSISTANT_TURNS.map((turn, index) => (
            <div
              key={turn.question}
              className="lnv2-turn"
              style={{ "--d": `${index * 0.12}s` } as React.CSSProperties}
            >
              <p className="lnv2-bubble" data-from="user">
                {turn.question}
              </p>
              <p className="lnv2-bubble" data-from="bomi">
                {turn.answer}
              </p>
            </div>
          ))}
        </Reveal>
      </div>
    </section>
  );
}
