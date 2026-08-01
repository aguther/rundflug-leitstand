import type { OperationBoard } from "@rundflug/contracts";
import { useState } from "react";
import { Tabs } from "../../../design-system/components";
import {
  OperationalPlanPanel,
  type OperationalPlanPanelProps,
} from "../../operations/OperationalPlanPanel";
import { EventWorkspaceFrame } from "../event-workspace/EventWorkspaceFrame";

type OperationalPlanTab = "plans" | "rules";

const operationalPlanTabs = [
  { value: "plans", label: "Einschränkungen" },
  { value: "rules", label: "Wiederkehrende Regeln" },
] satisfies Array<{ value: OperationalPlanTab; label: string }>;

export function OperationalPlanWorkspace({
  board,
  panelProps,
}: {
  board: OperationBoard;
  panelProps: Omit<OperationalPlanPanelProps, "content">;
}) {
  const [activeTab, setActiveTab] = useState<OperationalPlanTab>("plans");

  return (
    <EventWorkspaceFrame event={board.event} variant="wide">
      <Tabs
        idPrefix="admin-operational-plan"
        items={operationalPlanTabs}
        label="Betriebsplanbereiche"
        onChange={setActiveTab}
        value={activeTab}
      />
      {operationalPlanTabs.map((tab) => (
        <section
          aria-labelledby={`admin-operational-plan-${tab.value}-tab`}
          className="operational-plan-workspace-panel"
          hidden={activeTab !== tab.value}
          id={`admin-operational-plan-${tab.value}-panel`}
          key={tab.value}
          role="tabpanel"
        >
          <OperationalPlanPanel
            {...panelProps}
            content={tab.value === "plans" ? "plans" : "rules"}
          />
        </section>
      ))}
    </EventWorkspaceFrame>
  );
}
