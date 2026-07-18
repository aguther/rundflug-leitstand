import type { ReactNode } from "react";

export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral";

export interface StatusPillProps {
  tone: StatusTone;
  children: ReactNode;
  className?: string;
}

export function StatusPill({ tone, children, className = "" }: StatusPillProps) {
  return <span className={`ds-status-pill ds-status-pill--${tone} ${className}`.trim()}>{children}</span>;
}
