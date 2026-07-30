import type { ForecastHistory, OperationBoard, ResourceDayHistory } from "@rundflug/contracts";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Button, ModalDialog, Tabs } from "../../design-system/components";

const FlightDirectorAnalyticsContent = lazy(() =>
  import("./FlightDirectorAnalyticsContent").then((module) => ({
    default: module.FlightDirectorAnalyticsContent,
  })),
);

export type AnalyticsTab = "groups" | "aircraft" | "pilots";
export type FlightDirectorAnalyticsSelection = {
  tab: AnalyticsTab;
  id: string;
};

export interface FlightDirectorAnalyticsDialogProps {
  board: OperationBoard;
  initialSelection: FlightDirectorAnalyticsSelection | null;
  loadForecastHistory: (rotationId: string) => Promise<ForecastHistory["entries"]>;
  loadResourceHistory: (
    scopeType: "AIRCRAFT" | "PILOT",
    scopeId: string,
  ) => Promise<ResourceDayHistory>;
  onClose: () => void;
  open: boolean;
}

const tabs = [
  { value: "groups", label: "Fluggruppen" },
  { value: "aircraft", label: "Flugzeuge" },
  { value: "pilots", label: "Piloten" },
] satisfies Array<{ value: AnalyticsTab; label: string }>;

export function FlightDirectorAnalyticsDialog({
  board,
  initialSelection,
  loadForecastHistory,
  loadResourceHistory,
  onClose,
  open,
}: FlightDirectorAnalyticsDialogProps) {
  const [tab, setTab] = useState<AnalyticsTab>("aircraft");
  const [rotationId, setRotationId] = useState("");
  const [aircraftId, setAircraftId] = useState("");
  const [pilotId, setPilotId] = useState("");
  const wasOpen = useRef(false);

  useEffect(() => {
    if (!open) {
      wasOpen.current = false;
      return;
    }
    if (wasOpen.current) return;
    wasOpen.current = true;
    const fallbackAircraftId = board.aircraft[0]?.id ?? "";
    const fallbackPilotId = board.pilots[0]?.id ?? "";
    const fallbackRotationId = board.rotations[0]?.id ?? "";
    const next = initialSelection ?? {
      tab: "aircraft" as const,
      id: fallbackAircraftId,
    };
    setTab(next.tab);
    setRotationId(next.tab === "groups" ? next.id : fallbackRotationId);
    setAircraftId(next.tab === "aircraft" ? next.id : fallbackAircraftId);
    setPilotId(next.tab === "pilots" ? next.id : fallbackPilotId);
  }, [board.aircraft, board.pilots, board.rotations, initialSelection, open]);

  const footerNote =
    tab === "groups"
      ? "Prognosen sind Entscheidungshilfen und keine garantierten Zeiten."
      : tab === "pilots"
        ? "Organisatorische Übersicht · keine Dienst-, Flugzeit- oder Einsatzfreigabe."
        : "Organisatorischer Tagesverlauf · keine flugbetriebliche Freigabe.";

  return (
    <ModalDialog
      bodyClassName="flight-director-analytics-body"
      className="flight-director-analytics-dialog"
      description="Tagesbezogene Verläufe der aktuellen Veranstaltung"
      footer={
        <>
          <p className="flight-director-analytics-disclaimer">{footerNote}</p>
          <Button onClick={onClose} type="button" variant="secondary">
            Schließen
          </Button>
        </>
      }
      onClose={onClose}
      open={open}
      portal
      size="wide"
      title="Tagesauswertung"
    >
      <Tabs items={tabs} label="Auswertungsbereich" onChange={setTab} value={tab} />
      <div className="flight-director-analytics-scroll">
        <Suspense
          fallback={
            <div
              aria-busy="true"
              aria-label="Tagesauswertung wird geladen"
              className="flight-director-analytics-loading"
              role="status"
            >
              <span />
              <span />
              <span />
            </div>
          }
        >
          <FlightDirectorAnalyticsContent
            aircraftId={aircraftId}
            board={board}
            loadForecastHistory={loadForecastHistory}
            loadResourceHistory={loadResourceHistory}
            onAircraftIdChange={setAircraftId}
            onOpenRotation={(nextRotationId) => {
              setRotationId(nextRotationId);
              setTab("groups");
            }}
            onPilotIdChange={setPilotId}
            onRotationIdChange={setRotationId}
            pilotId={pilotId}
            rotationId={rotationId}
            tab={tab}
          />
        </Suspense>
      </div>
    </ModalDialog>
  );
}
