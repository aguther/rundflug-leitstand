import type { ReactNode } from "react";

export function EventWorkspaceToolbar({
  children,
  className = "",
}: Readonly<{
  children: ReactNode;
  className?: string;
}>) {
  return <div className={`event-workspace-toolbar ${className}`.trim()}>{children}</div>;
}
