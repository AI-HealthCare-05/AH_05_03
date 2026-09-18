import type { ButtonHTMLAttributes } from "react";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "outline" | "ghost" | "link" | "alertCta";
  size?: "sm" | "md" | "lg" | "icon";
}

export function Button({
  className = "",
  variant = "primary",
  size = "md",
  children,
  ...props
}: ButtonProps) {
  let variantClass = "sp-btn-primary";
  if (variant === "secondary") variantClass = "sp-btn-secondary";
  else if (variant === "link") variantClass = "sp-link-btn";
  else if (variant === "alertCta") variantClass = "sp-alert-cta-btn";
  else if (variant === "ghost") variantClass = "sp-icon-btn";

  const sizeClass = size === "icon" ? "sp-btn-icon" : `sp-btn-${size}`;

  return (
    <button
      className={`${variantClass} ${sizeClass} ${className}`.trim()}
      {...props}
    >
      {children}
    </button>
  );
}
