/**
 * 랜딩페이지의 정점. **검은 화면 안에서 몸 위에 기록이 하나씩 쌓인다.**
 *
 * 다섯 장면이 스크롤 하나로 이어진다(`landingStory.BODY_SCENES`).
 *   1. 인체가 떠오른다                      "몸이 기억하는 건강까지."
 *   2. "오른쪽 무릎이 아파요"  → 무릎에 표식
 *   3. "어깨가 뻐근해요"       → 어깨에 표식 (무릎은 남는다)
 *   4. 사용자가 복부를 고름     → 부위 정보 패널
 *   5. 카메라가 물러서고 큰 카피
 *
 * 3D 는 장식이 아니라 실제 기능이므로 **뷰포트를 크게 쓰고 카드 안에 가두지 않는다.**
 * 앱과 같은 Vanatome 아틀라스를 쓴다(`scene/LandingBodyScene.tsx` 머리말 참고).
 */

import { Suspense, lazy, useRef, useState } from "react";

import {
  BODY_MARKER_LABEL,
  BODY_SCENES,
  INSPECT_PANEL,
  type BodyMarkerId,
} from "../landingStory";
import { useInView, useSceneIndex, useSectionProgress } from "../scrollProgress";

/**
 * three.js 와 장면 코드는 랜딩 첫 화면이 그려지는 데 필요하지 않다. 섹션이 가까이
 * 올 때 청크째로 받는다 — 히어로를 보는 사람이 700 KB 를 먼저 기다리지 않는다.
 */
const LandingBodyScene = lazy(() =>
  import("../scene/LandingBodyScene").then((module) => ({ default: module.LandingBodyScene })),
);

interface BodySectionProps {
  reducedMotion: boolean;
}

/** 데이터 절약 모드에서는 7 MiB 를 말없이 내려받지 않는다. 사용자가 누르면 받는다. */
function prefersLightAssets(): boolean {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return connection?.saveData === true;
}

export function BodySection({ reducedMotion }: BodySectionProps) {
  const progressRef = useRef(0);
  const { index, update } = useSceneIndex(BODY_SCENES.length);
  const sectionRef = useSectionProgress<HTMLElement>({
    onProgress: (progress) => {
      progressRef.current = progress;
      update(progress);
    },
  });

  // 한 화면 앞에서 미리 받기 시작한다. 첫 화면에서는 받지 않는다.
  const { ref: nearRef, inView: near } = useInView<HTMLDivElement>({ rootMargin: "80% 0px" });
  // **받기 시작하는 조건과 그리는 조건은 다르다.** 위의 `near` 는 한 번 켜지면
  // 안 꺼지므로(자산을 두 번 받지 않으려고) 렌더 스위치로 쓸 수 없다. 화면에
  // 걸쳐 있는 동안만 켜지는 값을 따로 둔다 — 이걸 안 나눴더니 인체 섹션을
  // 지난 뒤에도 WebGL 이 계속 돌아 아래쪽 섹션이 전부 버벅였다.
  const { ref: viewRef, inView: onScreen } = useInView<HTMLDivElement>({
    rootMargin: "10% 0px",
    once: false,
  });
  const [optedIn, setOptedIn] = useState(() => !prefersLightAssets());
  const [failure, setFailure] = useState<string>();
  const [loading, setLoading] = useState({ loading: true, percent: 0 });

  const active = near && optedIn && !failure;
  const scene = BODY_SCENES[index] ?? BODY_SCENES[0];

  return (
    <section className="ln-body ln-scroll" ref={sectionRef} aria-labelledby="ln-body-title">
      <div
        className="ln-sticky ln-body-stage"
        ref={(node) => {
          nearRef.current = node;
          viewRef.current = node;
        }}
        data-scene={index}
      >
        {failure ? (
          <BodyFallback reason={failure} />
        ) : optedIn ? (
          <Suspense fallback={null}>
            <LandingBodyScene
              active={active}
              visible={onScreen}
              progressRef={progressRef}
              reducedMotion={reducedMotion}
              onLoadingChange={setLoading}
              onFailure={setFailure}
            />
          </Suspense>
        ) : (
          <div className="ln-body-optin">
            <p>데이터 절약 모드가 켜져 있어 3D 인체를 자동으로 불러오지 않았습니다.</p>
            <button type="button" className="ln-button ln-button-quiet" onClick={() => setOptedIn(true)}>
              3D 인체 불러오기 (약 7 MB)
            </button>
          </div>
        )}

        {optedIn && !failure && loading.loading ? (
          <p className="ln-body-loading" role="status">
            3D 인체를 준비하는 중… {loading.percent}%
          </p>
        ) : null}

        <div className="ln-body-overlay">
          <header className="ln-body-head">
            <p className="ln-eyebrow ln-eyebrow-dark">인터랙티브 3D 인체</p>
            <h2 id="ln-body-title" className="ln-sr-only">
              몸 위에 남는 건강 기록
            </h2>
          </header>

          {/* 장면 텍스트. 스크롤이 살아 있을 때는 **한 번에 하나만** 보인다 —
              두 개가 겹치면 어느 쪽을 읽어야 할지 알 수 없다.
              모션을 끄면 장면이 바뀌지 않으므로 다섯 장면을 **전부 세로로 편다.**
              안 그러면 첫 장면 한 줄만 남고 대화도 마지막 카피도 영영 안 보인다. */}
          <div className="ln-body-copy" key={reducedMotion ? "all" : index}>
            {(reducedMotion ? BODY_SCENES : [scene]).map((item, itemIndex) => (
              <div className="ln-body-scene-block" key={itemIndex}>
                {item.headline ? <p className="ln-body-headline">{item.headline}</p> : null}
                {item.message ? (
                  <p className="ln-chat-bubble" data-from={item.message.from}>
                    {item.message.text}
                  </p>
                ) : null}
                {item.sub ? <p className="ln-body-sub">{item.sub}</p> : null}
                {/* 좁은 화면에서는 이 패널이 글 바로 아래에 이어 붙고, 넓은 화면에서는
                    CSS 가 절대 위치로 띄워 오른쪽에 세운다. 부모를 나누면 모바일에서
                    줄 하나가 더 생겨 몸이 잘린다(실측). */}
                {item.inspect ? <InspectPanel marker={item.inspect} /> : null}
              </div>
            ))}
          </div>

          <ol className="ln-body-trail" aria-hidden="true">
            {BODY_SCENES.map((item, itemIndex) => (
              <li key={itemIndex} data-done={itemIndex <= index} />
            ))}
          </ol>
        </div>

        {/* 연출 없이 읽는 사람을 위한 같은 이야기. */}
        <p className="ln-sr-only">
          챗봇 대화에서 말한 부위와 직접 고른 부위가 3D 인체 위에 기록으로 남습니다. 예시 기록:{" "}
          {BODY_SCENES[BODY_SCENES.length - 1].markers.map((marker) => BODY_MARKER_LABEL[marker]).join(", ")}.
        </p>
      </div>
    </section>
  );
}

function InspectPanel({ marker }: { marker: BodyMarkerId }) {
  return (
    <aside className="ln-inspect" aria-hidden="true">
      <p className="ln-inspect-region">{BODY_MARKER_LABEL[marker]}</p>
      <dl>
        <div>
          <dt>{INSPECT_PANEL.countLabel}</dt>
          <dd>{INSPECT_PANEL.count}</dd>
        </div>
        <div>
          <dt>{INSPECT_PANEL.latestLabel}</dt>
          <dd>
            {INSPECT_PANEL.latestText}
            <span>{INSPECT_PANEL.latestWhen}</span>
          </dd>
        </div>
      </dl>
    </aside>
  );
}

/**
 * WebGL 이 없거나 자산을 못 받았을 때. 3D 를 **다른 3D 로 바꾸지 않는다** —
 * 같은 이야기를 정지된 그림으로 옮길 뿐이고, 기능 설명은 그대로 남긴다.
 */
function BodyFallback({ reason }: { reason: string }) {
  return (
    <div className="ln-body-fallback">
      <svg viewBox="0 0 220 420" role="img" aria-label="신체 부위별 기록 예시">
        <g className="ln-body-fallback-figure">
          <circle cx="110" cy="46" r="26" />
          <rect x="84" y="76" width="52" height="18" rx="9" />
          <rect x="66" y="94" width="88" height="126" rx="38" />
          <rect x="44" y="100" width="24" height="112" rx="12" />
          <rect x="152" y="100" width="24" height="112" rx="12" />
          <rect x="76" y="212" width="30" height="170" rx="15" />
          <rect x="114" y="212" width="30" height="170" rx="15" />
        </g>
        <g className="ln-body-fallback-marks">
          <circle cx="163" cy="112" r="11" />
          <circle cx="110" cy="168" r="11" />
          <circle cx="91" cy="286" r="11" />
        </g>
      </svg>
      <p className="ln-body-sub">
        이 브라우저에서는 3D 인체를 표시할 수 없어 예시 그림으로 대신합니다. 이어봄 앱에서는 몸을 돌려 보고 부위를 직접
        골라 기록할 수 있습니다.
      </p>
      <p className="ln-body-fallback-reason">{reason}</p>
    </div>
  );
}
