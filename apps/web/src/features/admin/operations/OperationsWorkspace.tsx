import type { OperationBoard } from "@rundflug/contracts";
import type { ReactNode } from "react";
import { productSaleBlockReason } from "../../operations/sale-availability";
import { EventWorkspaceFrame } from "../event-workspace/EventWorkspaceFrame";
import "./operations-workspace.css";

export function OperationsWorkspace({
  board,
  release,
  emergency,
}: Readonly<{
  board: OperationBoard;
  release: ReactNode;
  emergency: ReactNode;
}>) {
  const evaluatedAt = Date.now();
  const sellableProductCount = board.products.filter(
    (product) => productSaleBlockReason(board.event, product, evaluatedAt) === null,
  ).length;
  return (
    <EventWorkspaceFrame event={board.event} variant="wide">
      <div className="operations-workspace-content">
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
            <strong>{sellableProductCount}</strong> Produkte verkaufbar
          </span>
        </section>
        <div className="operations-workspace-controls">
          <div>{release}</div>
          <div>{emergency}</div>
        </div>
      </div>
    </EventWorkspaceFrame>
  );
}
