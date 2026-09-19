/**
 * 화면 오른쪽 아래에 늘 떠 있는 봄이 — 캡슐 런처와 미리보기 패널.
 *
 * ## 왜 `GlobalHealthAssistant` 를 그대로 걸지 않나
 *
 * 그 컴포넌트는 로컬 도메인 런타임과 활성 프로필이 없으면 **스스로 `null` 을
 * 반환한다**(로그인 뒤에만 뜬다). 랜딩은 관문 밖이라 프로필이 없다. 그래서 진짜
 * 대화 대신 **미리 준비한 세 가지 질문**을 눌러 보는 미리보기를 둔다.
 *
 * ## v1 과 다른 것 — 껍데기만이다
 *
 * v1 런처는 앱의 `globalHealthAssistant.css` 를 그대로 입었다. v2 는 디자인 시스템이
 * 달라서(캡슐·오버진·고스트 라벤더) 그 CSS 를 쓰면 페이지 한가운데 앱의 파란 버튼이
 * 하나 남는다. 그래서 **마스코트 그림은 앱의 것을 그대로 쓰고 껍데기만** v2 로 짠다 —
 * 마스코트는 브랜드이고 캡슐은 디자인 시스템이다.
 *
 * 미리보기라는 사실을 감추지 않는다. 패널 머리에 "미리보기" 를 적고, 실제 대화는
 * 시작하기로 이어진다.
 */

import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { BomiAvatar } from "../health-assistant/BomiAvatar";
import { ASSISTANT_TURNS } from "../landing/landingStory";

interface Line {
  from: "user" | "bomi";
  text: string;
}

const INTRO: Line = {
  from: "bomi",
  text: "안녕하세요, 건강 비서 봄이예요. 아래 질문을 눌러 어떤 답을 받는지 볼 수 있어요.",
};

/** 답이 돌아오기까지. 즉시 답하면 미리 적어 둔 글을 읽는 것처럼 보인다. */
const REPLY_DELAY_MS = 520;

export function AssistantLauncherV2() {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<Line[]>([INTRO]);
  const [asked, setAsked] = useState<string[]>([]);
  const panelId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const timersRef = useRef<number[]>([]);

  useEffect(() => {
    // 화면을 떠날 때 예약된 답변이 남아 있으면 없는 컴포넌트에 state 를 쓴다.
    const timers = timersRef.current;
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [lines]);

  const ask = (question: string, answer: string) => {
    setAsked((previous) => [...previous, question]);
    setLines((previous) => [...previous, { from: "user", text: question }]);
    const timer = window.setTimeout(() => {
      setLines((previous) => [...previous, { from: "bomi", text: answer }]);
    }, REPLY_DELAY_MS);
    timersRef.current.push(timer);
  };

  const remaining = ASSISTANT_TURNS.filter((turn) => !asked.includes(turn.question));

  return (
    <div className="lnv2-launcher-root">
      {open ? (
        <aside className="lnv2-panel" id={panelId} role="dialog" aria-label="봄이 건강 비서 미리보기">
          <header className="lnv2-panel-head">
            <BomiAvatar mood="idle" still />
            <span className="lnv2-panel-who">
              <strong>봄이</strong>
              <small>건강 비서 · 미리보기</small>
            </span>
            <button type="button" className="lnv2-panel-close" onClick={() => setOpen(false)} aria-label="미리보기 닫기">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </header>

          <div className="lnv2-panel-body" ref={listRef} aria-live="polite">
            {lines.map((line, index) => (
              <p key={`${line.from}-${index}`} className="lnv2-bubble" data-from={line.from}>
                {line.text}
              </p>
            ))}
          </div>

          <div className="lnv2-panel-foot">
            {remaining.length > 0 ? (
              <ul className="lnv2-panel-suggest">
                {remaining.map((turn) => (
                  <li key={turn.question}>
                    <button type="button" onClick={() => ask(turn.question, turn.answer)}>
                      {turn.question}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="lnv2-panel-note">실제 대화는 내 검진 기록과 챌린지를 함께 봅니다.</p>
            )}
            <Link className="lnv2-btn lnv2-btn-primary lnv2-btn-sm lnv2-btn-block" to="/signup">
              이어봄 시작하기
            </Link>
          </div>
        </aside>
      ) : null}

      <button
        type="button"
        className={`lnv2-launcher${open ? " is-open" : ""}`}
        onClick={() => setOpen((previous) => !previous)}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={open ? "건강 비서 미리보기 닫기" : "건강 비서 봄이 미리보기 열기"}
      >
        <BomiAvatar mood="idle" />
        <span className="lnv2-launcher-word">봄이에게 묻기</span>
      </button>
    </div>
  );
}
