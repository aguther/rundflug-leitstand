import type { EventSnapshot } from "@rundflug/contracts";
import type { ReactNode, Ref } from "react";
import { EventContextSummary } from "./EventContextSummary";
import "./event-workspace.css";

export type EventWorkspaceVariant = "form" | "master-data" | "wide";

export function EventWorkspaceFrame({
  event,
  actions,
  children,
  className = "",
  containerRef,
  variant = "form",
}: Readonly<{
  event: EventSnapshot;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  containerRef?: Ref<HTMLElement>;
  variant?: EventWorkspaceVariant;
}>) {
  return (
    <section
      className={`event-workspace-frame event-workspace-frame--${variant} ${className}`.trim()}
      ref={containerRef}
    >
      <EventContextSummary actions={actions} event={event} />
      {children}
    </section>
  );
}
