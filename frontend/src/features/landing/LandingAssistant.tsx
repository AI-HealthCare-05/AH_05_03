/**
 * 랜딩페이지 오른쪽 아래에 늘 떠 있는 봄이.
 *
 * ## 왜 `GlobalHealthAssistant` 를 그대로 걸지 않나
 *
 * 그 컴포넌트는 로컬 도메인 런타임과 활성 프로필이 없으면 **스스로 `null` 을
 * 반환한다**(로그인 뒤에만 뜬다). 랜딩은 관문 밖이라 프로필이 없다. 그래서 진짜
 * 대화 대신 **미리 준비한 세 가지 질문**을 눌러 보는 미리보기를 둔다 — 런처의
 * 생김새·마스코트·CSS 는 앱의 것을 그대로 쓰고(`globalHealthAssistant.css`),
 * 대화 내용만 `landingStory` 에서 온다.
 *
 * 미리보기라는 사실을 감추지 않는다. 패널 머리에 "미리보기" 를 적고, 실제 대화는
 * 시작하기로 이어진다.
 */

import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { BomiAvatar } from "../health-assistant/BomiAvatar";
import "../health-assistant/globalHealthAssistant.css";
import { ASSISTANT_TURNS } from "./landingStory";

interface Line {
  from: "user" | "bomi";
  text: string;
}

const INTRO: Line = {
  from: "bomi",
  text: "안녕하세요, 건강 비서 봄이예요. 아래 질문을 눌러 어떤 답을 받는지 볼 수 있어요.",
};

export function LandingAssistant() {
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
    }, 520);
    timersRef.current.push(timer);
  };

  const remaining = ASSISTANT_TURNS.filter((turn) => !asked.includes(turn.question));

  return (
    <>
      {open ? (
        <aside className="ln-assistant-panel" id={panelId} role="dialog" aria-label="봄이 건강 비서 미리보기">
          <header className="ln-assistant-panel-head">
            <BomiAvatar mood="idle" still />
            <span>
              <strong>봄이</strong>
              <small>건강 비서 · 미리보기</small>
            </span>
            <button type="button" onClick={() => setOpen(false)} aria-label="미리보기 닫기">
              ✕
            </button>
          </header>

          <div className="ln-assistant-panel-body" ref={listRef} aria-live="polite">
            {lines.map((line, index) => (
              <p key={`${line.from}-${index}`} className="ln-chat-bubble" data-from={line.from}>
                {line.text}
              </p>
            ))}
          </div>

          <div className="ln-assistant-panel-foot">
            {remaining.length > 0 ? (
              <ul className="ln-assistant-suggestions">
                {remaining.map((turn) => (
                  <li key={turn.question}>
                    <button type="button" onClick={() => ask(turn.question, turn.answer)}>
                      {turn.question}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="ln-assistant-panel-close-note">
                실제 대화는 내 검진 기록과 챌린지를 함께 봅니다.
              </p>
            )}
            <Link className="ln-button ln-button-primary ln-button-sm ln-button-block" to="/signup">
              이어봄 시작하기
            </Link>
          </div>
        </aside>
      ) : null}

      <div className="channel-talk-launcher">
        <button
          type="button"
          className={`channel-talk-launcher-btn${open ? " is-open" : ""}`}
          onClick={() => setOpen((previous) => !previous)}
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={open ? "건강 비서 미리보기 닫기" : "건강 비서 봄이 미리보기 열기"}
        >
          <BomiAvatar mood="idle" className="icon-chat icon-chat-mascot" />
          <svg
            className="icon-close"
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </>
  );
}
