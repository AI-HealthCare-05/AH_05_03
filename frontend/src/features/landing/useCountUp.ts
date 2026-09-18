/**
 * 숫자가 0 에서 목표까지 올라온다. 값이 바뀌었다는 것을 눈이 먼저 안다.
 *
 * `InsightSection`(v1)과 `sections/InsightV2`(v2)가 같은 연출을 쓴다. 한쪽에 두고
 * 복사하면 한쪽만 고쳐지고 테스트는 통과한다(AGENTS.md §2-5) — 그래서 여기 하나만
 * 둔다. 랜딩 폴더 밖으로는 내보내지 않는다(앱 화면은 실제 값을 즉시 보여 준다).
 *
 * 모션 축소에서는 세지 않고 목표값을 곧바로 세운다. **값을 감추지 않는다** —
 * 움직임만 뺀다.
 */

import { useEffect, useRef, useState } from "react";

import { usePrefersReducedMotion } from "./scrollProgress";

/** 끝에서 천천히 멈춘다. 등속으로 세면 계수기처럼 보인다. */
const DURATION_MS = 900;

export function useCountUp(target: number, active: boolean, decimals = 0): number {
  const [value, setValue] = useState(active ? target : 0);
  const reduced = usePrefersReducedMotion();
  const frameRef = useRef(0);

  useEffect(() => {
    if (!active) return;
    if (reduced) {
      setValue(target);
      return;
    }
    const startedAt = performance.now();
    const step = () => {
      const t = Math.min(1, (performance.now() - startedAt) / DURATION_MS);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(Number((target * eased).toFixed(decimals)));
      if (t < 1) frameRef.current = requestAnimationFrame(step);
    };
    frameRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frameRef.current);
  }, [active, target, decimals, reduced]);

  return value;
}
