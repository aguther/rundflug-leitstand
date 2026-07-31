import type { ForecastHistory, OperationBoard, ResourceDayHistory } from "@rundflug/contracts";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, ModalDialog, Tabs } from "../../design-system/components";
import { analyticsTicketGroups } from "./flight-director-analytics-model";

const FlightDirectorAnalyticsContent = lazy(() =>
  import("./FlightDirectorAnalyticsContent").then((module) => ({
    default: module.FlightDirectorAnalyticsContent,
  })),
);

export type AnalyticsTab = "groups" | "aircraft" | "pilots";
export type FlightDirectorAnalyticsSelection = {
  tab: AnalyticsTab;
  id: string;
  rotationId?: string;
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
  { value: "groups", label: "Ticketgruppen" },
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
  const [ticketGroupId, setTicketGroupId] = useState("");
  const [rotationId, setRotationId] = useState("");
  const [aircraftId, setAircraftId] = useState("");
  const [pilotId, setPilotId] = useState("");
  const wasOpen = useRef(false);
  const ticketGroups = useMemo(() => analyticsTicketGroups(board.rotations), [board.rotations]);

  const selectTicketGroup = useCallback(
    (nextTicketGroupId: string, preferredRotationId?: string) => {
      const rotationIds =
        ticketGroups.find((group) => group.id === nextTicketGroupId)?.rotationIds ?? [];
      setTicketGroupId(nextTicketGroupId);
      setRotationId(
        preferredRotationId && rotationIds.includes(preferredRotationId)
          ? preferredRotationId
          : rotationIds.length > 1
            ? "all"
            : (rotationIds[0] ?? ""),
      );
    },
    [ticketGroups],
  );

  useEffect(() => {
    if (!open) {
      wasOpen.current = false;
      return;
    }
    if (wasOpen.current) return;
    wasOpen.current = true;
    const fallbackAircraftId = board.aircraft[0]?.id ?? "";
    const fallbackPilotId = board.pilots[0]?.id ?? "";
    const fallbackTicketGroupId = ticketGroups[0]?.id ?? "";
    const next = initialSelection ?? {
      tab: "aircraft" as const,
      id: fallbackAircraftId,
    };
    const selectedRotation =
      next.tab === "groups"
        ? board.rotations.find((rotation) => rotation.id === (next.rotationId ?? next.id))
        : undefined;
    const selectedTicketGroupId =
      next.tab === "groups"
        ? (ticketGroups.find((group) => group.id === next.id)?.id ??
          selectedRotation?.bookingGroups[0]?.id ??
          selectedRotation?.ticketGroupId ??
          fallbackTicketGroupId)
        : fallbackTicketGroupId;
    setTab(next.tab);
    selectTicketGroup(
      selectedTicketGroupId,
      next.tab === "groups" ? (next.rotationId ?? selectedRotation?.id) : undefined,
    );
    setAircraftId(next.tab === "aircraft" ? next.id : fallbackAircraftId);
    setPilotId(next.tab === "pilots" ? next.id : fallbackPilotId);
  }, [
    board.aircraft,
    board.pilots,
    board.rotations,
    initialSelection,
    open,
    selectTicketGroup,
    ticketGroups,
  ]);

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
              const nextRotation = board.rotations.find(
                (rotation) => rotation.id === nextRotationId,
              );
              selectTicketGroup(
                nextRotation?.bookingGroups[0]?.id ?? nextRotation?.ticketGroupId ?? "",
                nextRotationId,
              );
              setTab("groups");
            }}
            onPilotIdChange={setPilotId}
            onRotationIdChange={setRotationId}
            onTicketGroupIdChange={selectTicketGroup}
            pilotId={pilotId}
            rotationId={rotationId}
            tab={tab}
            ticketGroupId={ticketGroupId}
          />
        </Suspense>
      </div>
    </ModalDialog>
  );
}
