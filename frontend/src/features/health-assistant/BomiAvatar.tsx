/**
 * 봄이 아바타. CSS `steps()` 무한 재생 대신 RAF 상태 머신으로 한 줄만 돌린다.
 * 잡아당기기는 런처만 켠다. 채팅창 안은 `interactive={false}`.
 */

import { useEffect, useRef, useState } from "react";

import { BOMI_AVATARS, type BomiMood } from "./bomiMood";
import { moodToServiceState } from "./bomiSpriteMap";
import spritesheet from "./assets/bomi/spritesheet.webp";
import { useBomiAnimator } from "./useBomiAnimator";
import { useBomiDrag, type BomiDragPose } from "./useBomiDrag";
import "./bomiAvatar.css";

export function BomiAvatar({
  mood,
  className,
  size = "md",
  still = false,
  interactive = false,
}: {
  mood: BomiMood;
  className?: string;
  size?: "md" | "lg";
  still?: boolean;
  interactive?: boolean;
}) {
  const [useStill, setUseStill] = useState(still);
  const [reducedMotion, setReducedMotion] = useState(false);
  const elRef = useRef<HTMLSpanElement>(null);
  const poseRef = useRef<BomiDragPose>({
    x: 0,
    y: 0,
    rotate: 0,
    scaleX: 1,
    scaleY: 1,
    dragging: false,
    vx: 0,
    vy: 0,
    dizzyPlays: 0,
  });

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReducedMotion(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (still) return;
    const probe = new Image();
    probe.onerror = () => setUseStill(true);
    probe.src = spritesheet;
  }, [still]);

  const live = !still && !useStill;
  useBomiAnimator(elRef, {
    enabled: live,
    reducedMotion,
    serviceState: moodToServiceState(mood),
    poseRef,
  });
  useBomiDrag(elRef, {
    enabled: live && interactive,
    reducedMotion,
    poseRef,
  });

  if (still || useStill) {
    return (
      <img
        src={BOMI_AVATARS[mood]}
        alt=""
        className={className}
        data-bomi-mood={mood}
        data-bomi-still=""
        loading="eager"
        decoding="async"
        aria-hidden="true"
        draggable={false}
      />
    );
  }

  const sizeClass = size === "lg" ? " is-lg" : "";
  const extra = className ? ` ${className}` : "";

  return (
    <span
      ref={elRef}
      className={`bomi-avatar bomi-avatar-sprite${sizeClass}${interactive ? " is-interactive" : ""}${extra}`}
      data-bomi-mood={mood}
      data-bomi-state="idle"
      style={{ backgroundImage: `url(${spritesheet})` }}
      aria-hidden="true"
    />
  );
}
