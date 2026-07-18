import type { HTMLAttributes, ReactNode } from "react";

export interface PanelProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode;
  as?: "section" | "article" | "div";
  padding?: "none" | "compact" | "default";
}

export function Panel({
  as: Element = "section",
  padding = "default",
  className = "",
  children,
  ...rest
}: PanelProps) {
  return (
    <Element className={`ds-panel ds-panel--${padding} ${className}`.trim()} {...rest}>
      {children}
    </Element>
  );
}
