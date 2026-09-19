import { useEffect, useRef } from "react";

import type { BomiDragPose } from "./useBomiDrag";
import {
  IDLE_FACE_HOLD_MS,
  JUMP_COOLDOWN_MS,
  JUMP_HOVER_DELAY_MS,
  LOOK_DEADZONE_PX,
  MIN_STATE_HOLD_MS,
  POINTER_MOVE_EPSILON_PX,
  POINTER_STILL_MS,
  RUN_LEFT,
  RUN_RIGHT,
  SERVICE_MOOD_DEBOUNCE_MS,
  SMILE_CELL,
  SQUINT_CELL,
  STARE_CELL,
  STATE_STRIP,
  animationTiming,
  canPreempt,
  isIdleFace,
  jitterHoldMs,
  lookCell,
  lookIndexFromVector,
  nextIdleFace,
  pingPongIndex,
  remapDragCell,
  shortestLookDelta,
  type IdleFace,
  type BomiState,
} from "./bomiSpriteMap";

function isCoarsePointer(): boolean {
  return window.matchMedia("(pointer: coarse)").matches;
}

export function useBomiAnimator(
  elRef: React.RefObject<HTMLElement | null>,
  options: {
    enabled: boolean;
    reducedMotion: boolean;
    serviceState: BomiState;
    poseRef: React.MutableRefObject<BomiDragPose>;
  },
) {
  const { enabled, reducedMotion, serviceState, poseRef } = options;
  const stateRef = useRef<BomiState>("idle");
  const enteredAtRef = useRef(0);
  const stepRef = useRef(0);
  const accumRef = useRef(0);
  const pauseLeftRef = useRef(0);
  const lookIndexRef = useRef(0);
  const lastJumpAtRef = useRef(-JUMP_COOLDOWN_MS);
  const hoverTimerRef = useRef<number | null>(null);
  const debounceTimerRef = useRef<number | null>(null);
  const pendingServiceRef = useRef(serviceState);
  const lastServiceRef = useRef(serviceState);
  const pointerRef = useRef({
    x: 0,
    y: 0,
    inside: false,
    lastMovedAt: 0,
    parked: false,
    holdUntil: 0,
  });
  const oneShotDoneRef = useRef(false);
  const holdFailedUntilRef = useRef(0);
  const failedPlaysLeftRef = useRef(0);

  useEffect(() => {
    pendingServiceRef.current = serviceState;
    if (debounceTimerRef.current != null) window.clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = window.setTimeout(() => {
      lastServiceRef.current = pendingServiceRef.current;
      debounceTimerRef.current = null;
    }, SERVICE_MOOD_DEBOUNCE_MS);
  }, [serviceState]);

  useEffect(() => {
    const el = elRef.current;
    if (!el || !enabled) return;
    pointerRef.current.lastMovedAt = performance.now();
    pointerRef.current.parked = false;
    pointerRef.current.holdUntil = 0;

    const paint = (row: number, column: number) => {
      const w = el.clientWidth || 96;
      const h = el.clientHeight || 104;
      el.style.backgroundPosition = `${-column * w}px ${-row * h}px`;
    };

    const enter = (next: BomiState, restart = false, force = false) => {
      const now = performance.now();
      if (!restart && !force && next === stateRef.current) return;
      if (!force && now - enteredAtRef.current < MIN_STATE_HOLD_MS && !canPreempt(stateRef.current, next)) {
        return;
      }
      if (!force && next !== stateRef.current && !canPreempt(stateRef.current, next)) return;
      stateRef.current = next;
      enteredAtRef.current = now;
      stepRef.current = 0;
      accumRef.current = 0;
      pauseLeftRef.current = 0;
      oneShotDoneRef.current = false;
      el.dataset.bomiState = next;
    };

    const frameDuration = (state: BomiState) => {
      const timing = animationTiming[state as keyof typeof animationTiming];
      return timing && "frameDuration" in timing ? timing.frameDuration : 220;
    };

    const paintState = () => {
      const pose = poseRef.current;
      if (pose.dragging) {
        const strip = pose.vx >= 0 ? RUN_RIGHT : RUN_LEFT;
        const cell = remapDragCell(strip.row, stepRef.current % strip.frames);
        paint(cell.row, cell.column);
        return;
      }
      if (stateRef.current === "staring") {
        paint(STARE_CELL.row, STARE_CELL.column);
        return;
      }
      if (stateRef.current === "squinting") {
        paint(SQUINT_CELL.row, SQUINT_CELL.column);
        return;
      }
      if (stateRef.current === "smiling") {
        paint(SMILE_CELL.row, SMILE_CELL.column);
        return;
      }

      const state = stateRef.current;
      if (state === "looking") {
        const { row, column } = lookCell(lookIndexRef.current);
        paint(row, column);
        return;
      }
      if (state === "hover" || state === "released") {
        paint(0, 0);
        return;
      }
      const strip = STATE_STRIP[state as keyof typeof STATE_STRIP];
      if (!strip) {
        paint(0, 0);
        return;
      }
      const col = strip.pingPong
        ? pingPongIndex(stepRef.current, strip.frames)
        : Math.min(stepRef.current, strip.frames - 1);
      paint(strip.row, col);
    };

    let raf = 0;
    let last = performance.now();
    let lookSampleAccum = 0;

    const tick = (now: number) => {
      const dt = Math.min(48, now - last);
      last = now;

      if (document.hidden) {
        raf = requestAnimationFrame(tick);
        return;
      }

      const pose = poseRef.current;
      if (pose.dragging) {
        if (hoverTimerRef.current != null) {
          window.clearTimeout(hoverTimerRef.current);
          hoverTimerRef.current = null;
        }
        pointerRef.current.parked = false;
        pointerRef.current.holdUntil = 0;
        if (stateRef.current !== "dragging") enter("dragging", true, true);
        accumRef.current += dt;
        const dur = animationTiming.dragging.frameDuration;
        while (accumRef.current >= dur) {
          accumRef.current -= dur;
          stepRef.current += 1;
        }
        paintState();
        raf = requestAnimationFrame(tick);
        return;
      }

      if (stateRef.current === "dragging") {
        enter("released", true, true);
      }

      const pointer = pointerRef.current;
      const service = lastServiceRef.current;
      const canParkSmile =
        !reducedMotion &&
        !isCoarsePointer() &&
        service === "idle" &&
        stateRef.current !== "jumping" &&
        stateRef.current !== "failed" &&
        stateRef.current !== "released";

      const beginIdleFace = (face: IdleFace, at: number) => {
        const [min, max] = IDLE_FACE_HOLD_MS[face];
        pointer.holdUntil = at + jitterHoldMs(min, max);
        enter(face, true, true);
      };

      if (canParkSmile && !pointer.parked && now - pointer.lastMovedAt >= POINTER_STILL_MS) {
        pointer.parked = true;
        beginIdleFace("smiling", now);
      }

      if (pointer.parked && isIdleFace(stateRef.current) && now >= pointer.holdUntil) {
        beginIdleFace(nextIdleFace(stateRef.current), now);
      }

      lookSampleAccum += dt;
      if (
        lookSampleAccum >= 40 &&
        !pointer.parked &&
        !isCoarsePointer() &&
        !reducedMotion &&
        stateRef.current !== "jumping" &&
        stateRef.current !== "waving" &&
        stateRef.current !== "failed" &&
        stateRef.current !== "released" &&
        !isIdleFace(stateRef.current)
      ) {
        lookSampleAccum = 0;
        const rect = el.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const dx = pointer.x - cx;
        const dy = pointer.y - cy;
        const distance = Math.hypot(dx, dy);
        if (distance < LOOK_DEADZONE_PX) {
          if (stateRef.current === "looking") {
            enter(lastServiceRef.current === "idle" ? "idle" : lastServiceRef.current, false, true);
          }
        } else if (stateRef.current === "idle" || stateRef.current === "looking") {
          const nextIndex = lookIndexFromVector(dx, dy);
          const delta = Math.abs(shortestLookDelta(lookIndexRef.current, nextIndex));
          if (delta >= 2 || stateRef.current !== "looking") {
            lookIndexRef.current = nextIndex;
          }
          if (stateRef.current !== "looking") enter("looking");
        }
      }

      if (
        (stateRef.current === "idle" || stateRef.current === "looking" || isIdleFace(stateRef.current)) &&
        service !== "idle" &&
        canPreempt(stateRef.current, service)
      ) {
        pointer.parked = false;
        pointer.holdUntil = 0;
        enter(service);
      }

      const state = stateRef.current;
      const timing = animationTiming[state as keyof typeof animationTiming];
      const dur = frameDuration(state);

      if (reducedMotion) {
        paint(0, 0);
        raf = requestAnimationFrame(tick);
        return;
      }

      if (isIdleFace(state)) {
        paintState();
        raf = requestAnimationFrame(tick);
        return;
      }

      if (pauseLeftRef.current > 0) {
        pauseLeftRef.current -= dt;
        paintState();
        raf = requestAnimationFrame(tick);
        return;
      }

      if (state === "failed" && now < holdFailedUntilRef.current) {
        paintState();
        raf = requestAnimationFrame(tick);
        return;
      }

      accumRef.current += dt;
      const strip = STATE_STRIP[state as keyof typeof STATE_STRIP];
      if (strip && timing) {
        while (accumRef.current >= dur) {
          accumRef.current -= dur;
          stepRef.current += 1;
          const looped = "loop" in timing && timing.loop === false;
          if (looped && stepRef.current >= strip.frames) {
            stepRef.current = strip.frames - 1;
            oneShotDoneRef.current = true;
            if (state === "failed" && "holdLastFrame" in timing) {
              holdFailedUntilRef.current = now + timing.holdLastFrame;
            }
          }
        }
        if (oneShotDoneRef.current && now >= holdFailedUntilRef.current) {
          if (state === "failed" && failedPlaysLeftRef.current > 1) {
            failedPlaysLeftRef.current -= 1;
            enter("failed", true, true);
          } else {
            failedPlaysLeftRef.current = 0;
            enter(service === state ? "idle" : service, false, true);
          }
        } else if (!("loop" in timing && timing.loop === false) && strip.pingPong) {
          const cycle = strip.frames * 2 - 2;
          if (stepRef.current > 0 && stepRef.current % cycle === 0 && "loopPause" in timing) {
            pauseLeftRef.current = timing.loopPause;
          }
        } else if (strip && !strip.pingPong && !("loop" in timing && timing.loop === false)) {
          if (stepRef.current >= strip.frames) {
            stepRef.current = 0;
            if ("loopPause" in timing) pauseLeftRef.current = timing.loopPause;
          }
        }
      }

      if (state === "released" && !pose.dragging && Math.hypot(pose.x, pose.y) < 1) {
        if (pose.dizzyPlays > 0) {
          failedPlaysLeftRef.current = pose.dizzyPlays;
          pose.dizzyPlays = 0;
          enter("failed", true, true);
        } else {
          enter(service === "idle" ? "idle" : service, false, true);
        }
      }

      paintState();
      raf = requestAnimationFrame(tick);
    };

    const onPointerMove = (event: PointerEvent) => {
      const prev = pointerRef.current;
      const dx = event.clientX - prev.x;
      const dy = event.clientY - prev.y;
      const moved = Math.hypot(dx, dy) >= POINTER_MOVE_EPSILON_PX;
      prev.x = event.clientX;
      prev.y = event.clientY;
      if (!moved && prev.lastMovedAt !== 0) return;
      prev.lastMovedAt = performance.now();
      if (prev.parked) {
        prev.parked = false;
        prev.holdUntil = 0;
        if (isIdleFace(stateRef.current)) {
          enter("idle", true, true);
        }
      }
    };

    const onEnter = (event: PointerEvent) => {
      if (event.pointerType === "touch" || isCoarsePointer() || reducedMotion) return;
      pointerRef.current.inside = true;
      if (hoverTimerRef.current != null) return;
      if (performance.now() - lastJumpAtRef.current < JUMP_COOLDOWN_MS) return;
      hoverTimerRef.current = window.setTimeout(() => {
        hoverTimerRef.current = null;
        if (poseRef.current.dragging || stateRef.current === "failed") return;
        lastJumpAtRef.current = performance.now();
        enter("jumping", true, true);
      }, JUMP_HOVER_DELAY_MS);
    };

    const onLeave = () => {
      pointerRef.current.inside = false;
      if (hoverTimerRef.current != null) {
        window.clearTimeout(hoverTimerRef.current);
        hoverTimerRef.current = null;
      }
    };

    el.addEventListener("pointerenter", onEnter);
    el.addEventListener("pointerleave", onLeave);
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      if (hoverTimerRef.current != null) window.clearTimeout(hoverTimerRef.current);
      if (debounceTimerRef.current != null) window.clearTimeout(debounceTimerRef.current);
      el.removeEventListener("pointerenter", onEnter);
      el.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("pointermove", onPointerMove);
    };
  }, [elRef, enabled, reducedMotion, poseRef]);
}
