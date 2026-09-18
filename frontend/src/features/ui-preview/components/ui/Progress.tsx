import type { HTMLAttributes } from "react";

export interface ProgressProps extends HTMLAttributes<HTMLDivElement> {
  value: number; // 0 to 100
}

export function Progress({ value, className = "", ...props }: ProgressProps) {
  const percentage = Math.min(Math.max(value, 0), 100);
  return (
    <div
      role="progressbar"
      aria-valuenow={percentage}
      aria-valuemin={0}
      aria-valuemax={100}
      className={`sp-progress-bar-wrap ${className}`.trim()}
      {...props}
    >
      <div
        className="sp-progress-bar-fill"
        style={{ width: `${percentage}%` }}
      />
    </div>
  );
}
