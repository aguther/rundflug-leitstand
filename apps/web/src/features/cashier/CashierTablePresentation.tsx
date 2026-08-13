import type { TicketSearchResult } from "@rundflug/contracts";
import { CircleCheck, CircleEllipsis } from "lucide-react";
import type { ReactNode } from "react";
import { cashierTicketCompletionIndicator } from "../../cashier-guidance";

export function TableIconHeader({
  children,
  label,
}: Readonly<{ children: ReactNode; label: string }>) {
  return (
    <span className="cashier-icon-heading" title={label}>
      {children}
      <span className="visually-hidden">{label}</span>
    </span>
  );
}

export function CashierCompletionIcon({ result }: Readonly<{ result: TicketSearchResult }>) {
  const indicator = cashierTicketCompletionIndicator(result.groupStatus, result.rotationStatuses);
  if (indicator === "NONE") return null;
  const completed = indicator === "COMPLETED";
  const label = completed ? "Alle Fluggruppen abgeschlossen" : "Boarding oder Flugbetrieb begonnen";
  return (
    <span
      aria-label={label}
      className={`cashier-completion-icon${completed ? " is-complete" : ""}`}
      role="img"
      title={label}
    >
      {completed ? (
        <CircleCheck aria-hidden="true" size={17} />
      ) : (
        <CircleEllipsis aria-hidden="true" size={17} />
      )}
    </span>
  );
}
