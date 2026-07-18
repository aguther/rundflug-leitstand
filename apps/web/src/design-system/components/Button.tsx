import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
type ButtonSize = "compact" | "default" | "touch";

const variantClass: Record<ButtonVariant, string> = {
  primary: "ds-button--primary",
  secondary: "ds-button--secondary",
  danger: "ds-button--danger",
  ghost: "ds-button--ghost",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
}

export function Button({
  variant = "secondary",
  size = "default",
  className = "",
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={`ds-button ${variantClass[variant]} ds-button--${size} ${className}`.trim()}
      {...rest}
    >
      {children}
    </button>
  );
}
