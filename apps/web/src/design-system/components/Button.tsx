import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "danger";

const variantClass: Record<ButtonVariant, string> = {
  primary: "primary-action",
  secondary: "secondary-action",
  danger: "danger-action",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  children: ReactNode;
}

export function Button({ variant = "secondary", className = "", children, ...rest }: ButtonProps) {
  return (
    <button className={`${variantClass[variant]} ${className}`.trim()} {...rest}>
      {children}
    </button>
  );
}
