import type { HTMLAttributes, ReactNode } from "react";

export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral";

export interface StatusPillProps extends HTMLAttributes<HTMLSpanElement> {
  tone: StatusTone;
  children: ReactNode;
}

export function StatusPill({ tone, children, className = "", ...span }: Readonly<StatusPillProps>) {
  return (
    <span className={`ds-status-pill ds-status-pill--${tone} ${className}`.trim()} {...span}>
      {children}
    </span>
  );
}
