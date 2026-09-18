import type { HTMLAttributes } from "react";

export interface AvatarProps extends HTMLAttributes<HTMLDivElement> {
  status?: "safe" | "warn";
}

export function Avatar({ className = "", status, children, ...props }: AvatarProps) {
  return (
    <div className={`sp-member-avatar-box ${className}`.trim()} {...props}>
      {children}
      {status && (
        <span
          className={`sp-member-status-dot ${status === "safe" ? "sp-dot-safe" : "sp-dot-warn"}`}
          aria-hidden="true"
        />
      )}
    </div>
  );
}
