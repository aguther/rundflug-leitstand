import type { OperationBoard } from "@rundflug/contracts";
import { useState, type ReactNode } from "react";
import { Button, Tabs } from "../../../design-system/components";
import { EventWorkspaceFrame } from "../event-workspace/EventWorkspaceFrame";
import "./completion-workspace.css";

type CompletionTab = "summary" | "operations" | "forecasts" | "audit" | "corrections";

const completionTabs = [
  { value: "summary", label: "Tagesübersicht" },
  { value: "operations", label: "Betriebshistorie" },
  { value: "forecasts", label: "Prognosegüte" },
  { value: "audit", label: "Auditprotokoll" },
  { value: "corrections", label: "Administrative Korrekturen" },
] satisfies Array<{ value: CompletionTab; label: string }>;

export function CompletionWorkspace({
  board,
  summary,
  history,
  corrections,
  onHistoryTabChange,
}: {
  board: OperationBoard;
  summary: ReactNode;
  history: ReactNode;
  corrections: ReactNode;
  onHistoryTabChange: (tab: "OPERATIONS" | "FORECASTS" | "AUDIT") => void;
}) {
  const [activeTab, setActiveTab] = useState<CompletionTab>("summary");
  const [correctionStarted, setCorrectionStarted] = useState(false);
  const panels: Record<Exclude<CompletionTab, "corrections">, ReactNode> = {
    summary,
    operations: history,
    forecasts: history,
    audit: history,
  };

  function changeTab(next: CompletionTab) {
    setActiveTab(next);
    if (next === "operations") onHistoryTabChange("OPERATIONS");
    if (next === "forecasts") onHistoryTabChange("FORECASTS");
    if (next === "audit") onHistoryTabChange("AUDIT");
  }

  return (
    <EventWorkspaceFrame event={board.event} variant="wide">
      <Tabs
        idPrefix="admin-completion"
        items={completionTabs}
        label="Abschlussbereiche"
        onChange={changeTab}
        value={activeTab}
      />
      {completionTabs.map((tab) => (
        <section
          aria-labelledby={`admin-completion-${tab.value}-tab`}
          className={`completion-workspace-panel ${tab.value === "corrections" ? "completion-correction-panel" : ""}`}
          hidden={activeTab !== tab.value}
          id={`admin-completion-${tab.value}-panel`}
          key={tab.value}
          role="tabpanel"
        >
          {activeTab !== tab.value ? null : tab.value === "corrections" ? (
            correctionStarted ? corrections : (
              <div className="completion-correction-gate">
                <span className="admin-only-badge">Nur Administration</span>
                <h2>Dokumentierte Besetzung korrigieren</h2>
                <p>
                  Dieser Sonderweg berichtigt ausschließlich die Dokumentation. Er besitzt keine
                  flugbetriebliche oder sicherheitsbezogene Freigabewirkung.
                </p>
                <Button onClick={() => setCorrectionStarted(true)} type="button" variant="primary">
                  Korrektur beginnen
                </Button>
              </div>
            )
          ) : panels[tab.value]}
        </section>
      ))}
    </EventWorkspaceFrame>
  );
}
