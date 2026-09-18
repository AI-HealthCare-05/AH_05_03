import { useState } from "react";
import { BOMI_AVATARS, type BomiMood } from "./bomiMood";

export function BomiAvatar({
  mood,
  className,
}: {
  mood: BomiMood;
  className?: string;
}) {
  const [hasError, setHasError] = useState(false);

  if (hasError) {
    return (
      <svg
        className={className}
        width="28"
        height="28"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
      </svg>
    );
  }

  return (
    <img
      src={BOMI_AVATARS[mood]}
      alt="봄이"
      className={className}
      data-bomi-mood={mood}
      loading="eager"
      decoding="async"
      onError={() => setHasError(true)}
      aria-hidden="true"
    />
  );
}
