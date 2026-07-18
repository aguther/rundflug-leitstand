import type { ButtonHTMLAttributes, ReactNode } from "react";

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  children: ReactNode;
  size?: "compact" | "default" | "touch";
}

export function IconButton({
  label,
  size = "default",
  className = "",
  children,
  ...rest
}: IconButtonProps) {
  return (
    <button
      aria-label={label}
      className={`ds-icon-button ds-icon-button--${size} ${className}`.trim()}
      title={label}
      {...rest}
    >
      {children}
    </button>
  );
}
