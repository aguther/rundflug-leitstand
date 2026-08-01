import type { OperationBoard } from "@rundflug/contracts";
import type { ReactNode } from "react";
import { EventWorkspaceFrame } from "../event-workspace/EventWorkspaceFrame";
import "./operations-workspace.css";

export function OperationsWorkspace({
  board,
  release,
  emergency,
}: {
  board: OperationBoard;
  release: ReactNode;
  emergency: ReactNode;
}) {
  return (
    <EventWorkspaceFrame event={board.event} variant="wide">
      <section className="operations-workspace-summary" aria-label="Betriebszusammenfassung">
        <span>
          <strong>{board.metrics.activeRotations}</strong> aktive Umläufe
        </span>
        <span>
          <strong>{board.metrics.openTickets}</strong> offene Tickets
        </span>
        <span>
          <strong>{board.metrics.completedRotations}</strong> abgeschlossene Umläufe
        </span>
        <span>
          <strong>{board.products.filter((product) => product.saleEnabled).length}</strong> Produkte
          im Verkauf
        </span>
      </section>
      <div className="operations-workspace-controls">
        <div>{release}</div>
        <div>{emergency}</div>
      </div>
    </EventWorkspaceFrame>
  );
}
