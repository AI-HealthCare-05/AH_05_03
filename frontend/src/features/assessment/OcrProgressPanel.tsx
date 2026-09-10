/**
 * 검진표를 읽는 동안의 진행 화면.
 *
 * ## 왜 만들었나
 *
 * 예전에는 한 줄이었다 — `표를 읽고 있어요…`. 인식은 7~20초, 느리면 그 이상 걸리는데
 * 그동안 화면에서 움직이는 것이 하나도 없었다. 멈춘 것과 도는 것을 구분할 방법이
 * 사용자에게 없었고, 실제로 그 시간에 파일을 다시 고르는 일이 생긴다.
 *
 * ## 무엇을 보여 주나 — 셋 다 실제 신호다
 *
 * 1. **단계.** 여는 중 → 저장 → 서버 대기 → 읽는 중 → 수치 맞추기. 각 단계는 코드가
 *    실제로 지나는 자리이고, 지어낸 눈속임 진행률이 아니다.
 * 2. **흘러온 글자.** SSE `delta` 가 오는 대로 마지막 몇 줄을 띄운다. 이게 "서버가
 *    지금 이 표를 읽고 있다" 를 가장 확실하게 말한다 — 자기 검진표의 글자가 보인다.
 * 3. **경과 초.** 오래 걸릴 때 "얼마나 됐나" 를 물어볼 자리가 있어야 한다.
 *
 * ## 진행 막대에 가짜 퍼센트를 쓰지 않는다
 *
 * 전체 글자 수를 미리 알 수 없다. 임의의 목표치를 두고 채우면 90%에서 멈춰 있는
 * 막대가 되는데, 그건 없느니만 못하다. 부정형(indeterminate) 막대와 **진짜 글자
 * 수**를 같이 둔다.
 */

import { useEffect, useState } from "react";

/** 코드가 실제로 지나는 자리. 순서가 곧 진행이다. */
export const OCR_STAGES = ["opening", "storing", "queued", "reading", "matching"] as const;
export type OcrStage = (typeof OCR_STAGES)[number];

const STAGE_LABEL: Record<OcrStage, string> = {
  opening: "검진표 열기",
  storing: "브라우저에 암호화 저장",
  queued: "서버 대기",
  reading: "표 읽는 중",
  matching: "수치 맞추는 중",
};

const STAGE_DETAIL: Record<OcrStage, string> = {
  opening: "파일을 미리보기로 펼치고 있어요.",
  // 서버 런타임은 문서 저장소를 들지 않는다(`serverDomainRuntime.ts` 의
  // `documents: undefined`). 이 단계는 저장이 아니라 인식에 넘길 준비다.
  storing: "인식에 넘길 준비를 하고 있어요. 원본은 보관하지 않습니다.",
  queued: "인식 작업을 서버에 맡겼어요. 워커가 집을 때까지 잠깐 기다립니다.",
  reading: "글자가 들어오는 대로 아래에 보여 드려요.",
  matching: "읽은 표에서 판정에 쓸 수치를 골라내는 중이에요.",
};

/** 마지막 몇 줄만. 전부 흘리면 패널이 검진표보다 길어진다. */
function tail(text: string, lines = 3): string {
  const rows = text.split("\n").filter((row) => row.trim().length > 0);
  return rows.slice(-lines).join("\n");
}

export function OcrProgressPanel({
  stage,
  text,
  restarted,
  startedAt,
}: {
  stage: OcrStage;
  /** 지금까지 흘러온 글. 누적이다. */
  text: string;
  /** 앞 모델이 죽어 다른 모델로 다시 시작했나(`reset` 이벤트). */
  restarted: boolean;
  /** `Date.now()` 기준 시작 시각. 경과 초를 여기서 센다. */
  startedAt: number;
}) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    // 1초마다 다시 그린다. 흐르는 숫자 하나가 "멈춤" 과 "도는 중" 을 가른다.
    const id = window.setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 500);
    return () => window.clearInterval(id);
  }, [startedAt]);

  const at = OCR_STAGES.indexOf(stage);
  const preview = tail(text);

  return (
    <section className="ocr-progress" aria-label="검진표 인식 진행" aria-live="polite">
      <div className="ocr-progress-head">
        <strong>{STAGE_LABEL[stage]}</strong>
        <span className="ocr-progress-elapsed">
          <time>{elapsed}</time>초 경과
        </span>
      </div>

      {/* 부정형 막대. 채워지는 퍼센트가 아니라 "돌고 있다" 만 말한다. */}
      <div className="ocr-progress-bar" role="presentation">
        <i />
      </div>

      <ol className="ocr-progress-steps">
        {OCR_STAGES.map((name, index) => (
          <li
            key={name}
            className={index < at ? "is-done" : index === at ? "is-at" : undefined}
            aria-current={index === at ? "step" : undefined}
          >
            <span className="ocr-step-dot" aria-hidden="true" />
            <span className="ocr-step-label">{STAGE_LABEL[name]}</span>
          </li>
        ))}
      </ol>

      <p className="ocr-progress-detail">{STAGE_DETAIL[stage]}</p>

      {restarted ? (
        <p className="ocr-progress-restart">
          앞 모델이 도중에 멈춰 <strong>다른 모델로 다시 시작</strong>했어요. 지금까지 읽은 글은 지웠습니다.
        </p>
      ) : null}

      {text.length > 0 ? (
        <div className="ocr-progress-stream">
          <p className="ocr-stream-count">
            지금까지 <strong>{text.length.toLocaleString()}</strong>자
          </p>
          {/* 흘러온 글의 꼬리. 자기 검진표의 글자가 보이는 것이 가장 강한 신호다. */}
          <pre>{preview}</pre>
        </div>
      ) : null}
    </section>
  );
}
