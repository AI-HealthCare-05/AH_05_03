/**
 * 스크롤 한 번에 페이지 전체가 다시 그려지지 않게 하는 장치.
 *
 * ## 스크롤 구독자는 하나다
 *
 * 섹션마다 `window.addEventListener("scroll", …)` 을 달면 한 번의 스크롤에
 * 리스너 여덟이 각각 `getBoundingClientRect()` 를 부르고, 그때마다 레이아웃이
 * 다시 계산된다(강제 리플로). 여기서 구독자를 모아 **rAF 한 프레임에 한 번만**
 * 돌린다 — 스크롤을 아무리 빨리 내려도 프레임당 한 묶음이다.
 *
 * ## 진행도는 state 가 아니라 CSS 변수로 나간다
 *
 * 0~1 이 프레임마다 바뀌는 값을 `useState` 에 담으면 초당 60회 리렌더가 된다.
 * 진행도는 DOM 노드의 `--ln-progress` 로 직접 쓰고, React 는 **장면 번호처럼
 * 드물게 바뀌는 값만** 들고 있는다(`useSceneIndex`).
 */

import { useEffect, useRef, useState } from "react";

type Subscriber = () => void;

const subscribers = new Set<Subscriber>();
let frame = 0;

function runFrame() {
  frame = 0;
  for (const subscriber of subscribers) subscriber();
}

function schedule() {
  if (frame) return;
  frame = requestAnimationFrame(runFrame);
}

/** 스크롤·리사이즈마다 한 프레임에 한 번 불린다. 반환값은 해지 함수다. */
export function subscribeScroll(subscriber: Subscriber): () => void {
  if (subscribers.size === 0) {
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
  }
  subscribers.add(subscriber);
  // 붙자마자 한 번 — 새로고침으로 페이지 중간에 들어온 경우 첫 스크롤 전에도
  // 장면이 맞아 있어야 한다.
  schedule();
  return () => {
    subscribers.delete(subscriber);
    if (subscribers.size === 0) {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    }
  };
}

/**
 * 고정(sticky) 구간의 진행도 0~1.
 *
 * `top` 은 뷰포트 기준 섹션 상단, `height` 는 섹션 전체 높이다. 고정된 화면이
 * 실제로 붙어 있는 거리는 `height - viewportHeight` 이므로 그것으로 나눈다.
 * 섹션이 뷰포트보다 짧으면(모바일에서 장면 수를 줄인 경우) 0 으로 나누게 되므로
 * 그때는 "들어왔으면 1" 로 본다.
 */
export function sectionProgress(top: number, height: number, viewportHeight: number): number {
  const travel = height - viewportHeight;
  if (travel <= 0) return top <= 0 ? 1 : 0;
  const progress = -top / travel;
  // `top` 이 정확히 0 이면 `-0` 이 나온다. CSS 로 나가면 같은 값이지만 테스트와
  // 비교에서만 다른 값처럼 굴어 헷갈린다.
  return progress <= 0 ? 0 : progress > 1 ? 1 : progress;
}

/** 진행도를 장면 번호로 바꾼다. 마지막 장면은 끝까지 유지된다. */
export function sceneIndexOf(progress: number, sceneCount: number): number {
  if (sceneCount <= 1) return 0;
  const index = Math.floor(progress * sceneCount);
  return index < 0 ? 0 : index > sceneCount - 1 ? sceneCount - 1 : index;
}

/** 장면 안에서의 진행도 0~1. 장면 하나짜리 연출(글자 등장 등)에 쓴다. */
export function sceneLocalProgress(progress: number, sceneCount: number): number {
  if (sceneCount <= 1) return progress;
  const scaled = progress * sceneCount;
  const local = scaled - Math.floor(scaled);
  return scaled >= sceneCount ? 1 : local;
}

export interface SectionProgressOptions {
  /** 프레임마다 받는 진행도. 여기서 state 를 건드리지 않는다. */
  onProgress?: (progress: number) => void;
  /** 진행도를 쓸 CSS 변수 이름. 기본 `--ln-progress`. */
  cssVariable?: string;
  /** false 면 아무것도 붙이지 않는다(모션 축소·SSR). */
  enabled?: boolean;
}

/**
 * 섹션 하나의 진행도를 CSS 변수로 흘려보낸다.
 *
 * 반환한 ref 를 **바깥 섹션**(높이가 여러 화면인 쪽)에 붙인다. 안쪽 sticky 는
 * 그 변수를 상속해서 읽는다.
 */
export function useSectionProgress<T extends HTMLElement>(options: SectionProgressOptions = {}) {
  const { onProgress, cssVariable = "--ln-progress", enabled = true } = options;
  const ref = useRef<T>(null);
  // 최신 콜백을 효과 바깥에서 갈아 끼운다. 렌더 중에 ref 를 쓰면
  // `react-hooks/refs` 가 막는다 — 앱 쪽 뷰어도 같은 모양으로 둔다.
  const onProgressRef = useRef(onProgress);
  useEffect(() => {
    onProgressRef.current = onProgress;
  }, [onProgress]);

  useEffect(() => {
    const element = ref.current;
    if (!element || !enabled) return;

    let last = -1;
    const update = () => {
      const rect = element.getBoundingClientRect();
      const progress = sectionProgress(rect.top, rect.height, window.innerHeight);
      // 소수 셋째 자리까지만 본다. 같은 값으로 CSS 변수를 다시 쓰면 그 자체가
      // 스타일 재계산이다.
      const rounded = Math.round(progress * 1000) / 1000;
      if (rounded === last) return;
      last = rounded;
      element.style.setProperty(cssVariable, String(rounded));
      onProgressRef.current?.(rounded);
    };

    return subscribeScroll(update);
  }, [cssVariable, enabled]);

  return ref;
}

/**
 * 진행도에서 장면 번호만 뽑아 state 로 준다. 장면이 바뀔 때만 리렌더된다.
 */
export function useSceneIndex(sceneCount: number) {
  const [index, setIndex] = useState(0);
  const indexRef = useRef(0);
  const update = (progress: number) => {
    const next = sceneIndexOf(progress, sceneCount);
    if (next === indexRef.current) return;
    indexRef.current = next;
    setIndex(next);
  };
  return { index, update };
}

/**
 * 뷰포트에 들어왔는지. 등장 애니메이션과 **무거운 자산의 지연 로드**에 같이 쓴다
 * (3D 인체 7 MiB 를 첫 화면에서 받지 않는 이유).
 */
export function useInView<T extends HTMLElement>(options: { rootMargin?: string; once?: boolean } = {}) {
  const { rootMargin = "0px", once = true } = options;
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setInView(true);
            if (once) observer.disconnect();
          } else if (!once) {
            setInView(false);
          }
        }
      },
      { rootMargin },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [rootMargin, once]);

  return { ref, inView };
}

/**
 * `prefers-reduced-motion: reduce`.
 *
 * 스크롤 연출은 전부 이 값 하나로 꺼진다 — 끄면 고정 구간이 풀리고 모든 장면이
 * 위에서 아래로 한 번에 서며, 3D 인체는 회전만 멈춘 채 그대로 보인다.
 * 기능을 빼지 않는다(움직임만 뺀다).
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const listener = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
  }, []);

  return reduced;
}
