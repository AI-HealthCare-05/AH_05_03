import type { HTMLAttributes } from "react";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: "default" | "safe" | "warning" | "danger" | "outline";
}

export function Badge({
  className = "",
  variant = "default",
  children,
  ...props
}: BadgeProps) {
  let variantClass = "sp-badge";
  if (variant === "safe") variantClass += " sp-badge-safe";
  else if (variant === "warning") variantClass += " sp-badge-warning";

  return (
    <span className={`${variantClass} ${className}`.trim()} {...props}>
      {children}
    </span>
  );
}
