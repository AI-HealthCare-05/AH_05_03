import { useEffect, useRef } from "react";

import {
  DIZZY_PLAYS,
  DRAG_HOLD_LIFT_PX,
  DRAG_INERTIA_DAMP,
  DRAG_INERTIA_MIN_SPEED,
  DRAG_INERTIA_MS,
  DRAG_SNAP_HOME_MS,
  DRAG_THRESHOLD_PX,
  isVigorousShake,
} from "./bomiSpriteMap";

export type BomiDragPose = {
  x: number;
  y: number;
  rotate: number;
  scaleX: number;
  scaleY: number;
  dragging: boolean;
  vx: number;
  vy: number;
  dizzyPlays: number;
};

const HOME: BomiDragPose = {
  x: 0,
  y: 0,
  rotate: 0,
  scaleX: 1,
  scaleY: 1,
  dragging: false,
  vx: 0,
  vy: 0,
  dizzyPlays: 0,
};

export function useBomiDrag(
  elRef: React.RefObject<HTMLElement | null>,
  options: {
    enabled: boolean;
    reducedMotion: boolean;
    onDragChange?: (dragging: boolean) => void;
    poseRef: React.MutableRefObject<BomiDragPose>;
  },
) {
  const { enabled, reducedMotion, onDragChange, poseRef } = options;
  const pointerIdRef = useRef<number | null>(null);
  const startRef = useRef({ px: 0, py: 0, x: 0, y: 0 });
  const prevRef = useRef({ x: 0, y: 0, t: 0 });
  const passedThresholdRef = useRef(false);
  const motionRafRef = useRef<number | null>(null);
  const shakeRef = useRef({ pathPx: 0, reversals: 0, peakSpeed: 0, lastSign: 0 });

  useEffect(() => {
    const el = elRef.current;
    if (!el || !enabled) return;

    const applyPose = () => {
      const pose = poseRef.current;
      const lift = pose.dragging ? DRAG_HOLD_LIFT_PX : 0;
      const scale = pose.dragging ? 1.06 : pose.scaleX;
      el.style.transform = `translate3d(${pose.x}px, ${pose.y - lift}px, 0) rotate(${pose.rotate}deg) scale(${scale}, ${pose.dragging ? 1.06 : pose.scaleY})`;
      el.dataset.dragging = pose.dragging ? "true" : "false";
      document.documentElement.classList.toggle("bomi-is-dragging", pose.dragging);
    };

    const clampToViewport = (x: number, y: number) => {
      const rect = el.getBoundingClientRect();
      const lift = poseRef.current.dragging ? DRAG_HOLD_LIFT_PX : 0;
      const homeLeft = rect.left - poseRef.current.x;
      const homeTop = rect.top - (poseRef.current.y - lift);
      const w = rect.width;
      const h = rect.height;
      const minX = -homeLeft + 8;
      const minY = -homeTop + 8;
      const maxX = window.innerWidth - homeLeft - w - 8;
      const maxY = window.innerHeight - homeTop - h - 8;
      return {
        x: Math.min(Math.max(x, minX), Math.max(minX, maxX)),
        y: Math.min(Math.max(y, minY), Math.max(minY, maxY)),
      };
    };

    const stopMotion = () => {
      if (motionRafRef.current != null) {
        cancelAnimationFrame(motionRafRef.current);
        motionRafRef.current = null;
      }
    };

    const snapHome = () => {
      if (reducedMotion) {
        poseRef.current = { ...HOME };
        applyPose();
        onDragChange?.(false);
        return;
      }
      const start = performance.now();
      const from = { ...poseRef.current };
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / DRAG_SNAP_HOME_MS);
        const ease = 1 - (1 - t) * (1 - t) * (1 - t);
        poseRef.current = {
          ...HOME,
          x: from.x * (1 - ease),
          y: from.y * (1 - ease),
          rotate: from.rotate * (1 - ease),
          dizzyPlays: from.dizzyPlays,
        };
        applyPose();
        if (t < 1) {
          motionRafRef.current = requestAnimationFrame(tick);
        } else {
          poseRef.current = { ...HOME, dizzyPlays: from.dizzyPlays };
          applyPose();
          onDragChange?.(false);
        }
      };
      motionRafRef.current = requestAnimationFrame(tick);
    };

    const releaseWithInertia = () => {
      const shaken = !reducedMotion && isVigorousShake(shakeRef.current);
      poseRef.current.dragging = false;
      poseRef.current.y -= DRAG_HOLD_LIFT_PX;
      poseRef.current.dizzyPlays = shaken ? DIZZY_PLAYS : 0;
      document.documentElement.classList.remove("bomi-is-dragging");
      applyPose();
      if (reducedMotion) {
        snapHome();
        return;
      }
      const start = performance.now();
      let vx = poseRef.current.vx;
      let vy = poseRef.current.vy;
      let last = start;
      const tick = (now: number) => {
        const dt = Math.min(32, now - last) / 1000;
        last = now;
        vx *= DRAG_INERTIA_DAMP;
        vy *= DRAG_INERTIA_DAMP;
        const next = clampToViewport(poseRef.current.x + vx * dt, poseRef.current.y + vy * dt);
        poseRef.current.x = next.x;
        poseRef.current.y = next.y;
        poseRef.current.vx = vx;
        poseRef.current.vy = vy;
        poseRef.current.rotate *= 0.88;
        applyPose();
        if (now - start < DRAG_INERTIA_MS && Math.hypot(vx, vy) > DRAG_INERTIA_MIN_SPEED) {
          motionRafRef.current = requestAnimationFrame(tick);
        } else {
          snapHome();
        }
      };
      motionRafRef.current = requestAnimationFrame(tick);
    };

    const onDown = (event: PointerEvent) => {
      if (event.button != null && event.button !== 0) return;
      stopMotion();
      pointerIdRef.current = event.pointerId;
      passedThresholdRef.current = false;
      el.setPointerCapture(event.pointerId);
      startRef.current = {
        px: event.clientX,
        py: event.clientY,
        x: poseRef.current.x,
        y: poseRef.current.y,
      };
      prevRef.current = { x: poseRef.current.x, y: poseRef.current.y, t: event.timeStamp };
      shakeRef.current = { pathPx: 0, reversals: 0, peakSpeed: 0, lastSign: 0 };
      poseRef.current.dizzyPlays = 0;
    };

    const onMove = (event: PointerEvent) => {
      if (pointerIdRef.current !== event.pointerId) return;
      const dx = event.clientX - startRef.current.px;
      const dy = event.clientY - startRef.current.py;
      if (!passedThresholdRef.current) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
        passedThresholdRef.current = true;
        poseRef.current.dragging = true;
        onDragChange?.(true);
      }
      const nextX = startRef.current.x + dx;
      const nextY = startRef.current.y + dy;
      const dt = Math.max(0.008, (event.timeStamp - prevRef.current.t) / 1000);
      const vx = (nextX - prevRef.current.x) / dt;
      const vy = (nextY - prevRef.current.y) / dt;
      const speed = Math.hypot(vx, vy);
      const sign = vx > 280 ? 1 : vx < -280 ? -1 : vy > 280 ? 1 : vy < -280 ? -1 : 0;
      const shake = shakeRef.current;
      shake.pathPx += Math.hypot(nextX - prevRef.current.x, nextY - prevRef.current.y);
      shake.peakSpeed = Math.max(shake.peakSpeed, speed);
      if (sign !== 0 && shake.lastSign !== 0 && sign !== shake.lastSign) {
        shake.reversals += 1;
      }
      if (sign !== 0) shake.lastSign = sign;
      const clamped = clampToViewport(nextX, nextY);
      poseRef.current = {
        x: clamped.x,
        y: clamped.y,
        rotate: Math.max(-8, Math.min(8, vx / 220)),
        scaleX: 1,
        scaleY: 1,
        dragging: true,
        vx,
        vy,
        dizzyPlays: 0,
      };
      prevRef.current = { x: nextX, y: nextY, t: event.timeStamp };
      applyPose();
    };

    const onUp = (event: PointerEvent) => {
      if (pointerIdRef.current !== event.pointerId) return;
      pointerIdRef.current = null;
      try {
        el.releasePointerCapture(event.pointerId);
      } catch {
        /* already released */
      }
      if (!passedThresholdRef.current) {
        poseRef.current.dragging = false;
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      releaseWithInertia();
    };

    const swallowClick = (event: MouseEvent) => {
      if (!passedThresholdRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      passedThresholdRef.current = false;
    };

    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    el.addEventListener("lostpointercapture", onUp);
    el.addEventListener("click", swallowClick, true);
    el.addEventListener("dragstart", (event) => event.preventDefault());

    return () => {
      stopMotion();
      document.documentElement.classList.remove("bomi-is-dragging");
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      el.removeEventListener("lostpointercapture", onUp);
      el.removeEventListener("click", swallowClick, true);
    };
  }, [elRef, enabled, reducedMotion, onDragChange, poseRef]);
}
