import type { OperationBoard } from "@rundflug/contracts";
import { type ReactNode, useState } from "react";
import { Tabs } from "../../../design-system/components";
import { EventWorkspaceFrame } from "../event-workspace/EventWorkspaceFrame";
import "./operations-workspace.css";

type OperationsTab = "plan" | "sales" | "exceptions";

const operationTabs = [
  { value: "plan", label: "Plan und Freigabe" },
  { value: "sales", label: "Verkauf und Kapazität" },
  { value: "exceptions", label: "Sonderlagen" },
] satisfies Array<{ value: OperationsTab; label: string }>;

export function OperationsWorkspace({
  board,
  plan,
  sales,
  exceptions,
}: {
  board: OperationBoard;
  plan: ReactNode;
  sales: ReactNode;
  exceptions: ReactNode;
}) {
  const [activeTab, setActiveTab] = useState<OperationsTab>("plan");
  const panels: Record<OperationsTab, ReactNode> = { plan, sales, exceptions };
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
      <Tabs
        idPrefix="admin-operations"
        items={operationTabs}
        label="Betriebsbereiche"
        onChange={setActiveTab}
        value={activeTab}
      />
      {operationTabs.map((tab) => (
        <section
          aria-labelledby={`admin-operations-${tab.value}-tab`}
          className="operations-workspace-panel"
          hidden={activeTab !== tab.value}
          id={`admin-operations-${tab.value}-panel`}
          key={tab.value}
          role="tabpanel"
        >
          {panels[tab.value]}
        </section>
      ))}
    </EventWorkspaceFrame>
  );
}
