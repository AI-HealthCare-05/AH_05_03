import { useEffect, useState } from "react";

import { BOMI_AVATARS, type BomiMood } from "./bomiMood";
import spritesheet from "./assets/bomi/spritesheet.webp";
import "./bomiAvatar.css";

export function BomiAvatar({
  mood,
  className,
  size = "md",
  still = false,
}: {
  mood: BomiMood;
  className?: string;
  size?: "md" | "lg";
  still?: boolean;
}) {
  const [useStill, setUseStill] = useState(still);

  useEffect(() => {
    if (still) return;
    const probe = new Image();
    probe.onerror = () => setUseStill(true);
    probe.src = spritesheet;
  }, [still]);

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
      />
    );
  }

  return (
    <span
      className={`bomi-avatar-sprite${size === "lg" ? " is-lg" : ""}${className ? ` ${className}` : ""}`}
      data-bomi-mood={mood}
      style={{ backgroundImage: `url(${spritesheet})` }}
      aria-hidden="true"
    />
  );
}
