import type {
  DispatchRecommendationLease,
  ForecastHistory,
  OperationBoard,
  ResourceDayHistory,
} from "@rundflug/contracts";
import { rotationStateLabels } from "@rundflug/domain";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  ArrowDown,
  ArrowUp,
  ChartNoAxesCombined,
  Check,
  CircleArrowRight,
  CircleCheck,
  CircleX,
  Clock3,
  Coffee,
  Download,
  Fuel,
  Info,
  ListOrdered,
  Package,
  PanelBottomClose,
  PanelBottomOpen,
  Plane,
  PlaneLanding,
  PlaneTakeoff,
  Settings2,
  Tag,
  Tickets,
  TicketsPlane,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { analysisSnapshotRequiresRefresh, downloadAnalysisSnapshot } from "./api";
import {
  Button,
  IconButton,
  PageHeader,
  Panel,
  SearchField,
  SelectField,
  StatusPill,
} from "./design-system/components";
import type { DispatchRecommendationLeaseController } from "./dispatch-recommendation-lease";
import {
  buildAnalysisClientContext,
  recordAnalysisUiEvent,
} from "./features/analysis/analysis-client-diagnostics";
import {
  FlightDirectorAnalyticsDialog,
  type FlightDirectorAnalyticsSelection,
} from "./features/flight-line/FlightDirectorAnalyticsDialog";
import type { FlightDirectorOperationsSection } from "./features/flight-line/FlightDirectorOperationsDialog";
import {
  activeRotationForAircraft,
  BookingGroupAssignmentDialog,
  type FlightLineFleetState,
  FlightProgress,
  formatFlightLineTime,
  operationalRotationForAircraft,
  PilotAssignmentDialogs,
  PilotChangeIcon,
  primaryAircraftActionLabel,
  primaryAircraftActionPresentation,
  rotationBookingGroupLabel,
} from "./flight-line-shared";
import { formatAbsoluteTimeWindow } from "./time-window";

type Aircraft = OperationBoard["aircraft"][number];
type Rotation = OperationBoard["rotations"][number];
type QueueGroup = OperationBoard["queueGroups"][number];
type TurnaroundNextState = "AVAILABLE" | "REFUELING" | "PAUSED" | "INACTIVE";
type TicketPanelSize = "compact" | "balanced" | "expanded";

const ticketPanelSizes: TicketPanelSize[] = ["compact", "balanced", "expanded"];
const ticketPanelCollapsedStorageKey = "flight-director:sold-tickets-collapsed:v1";

function readStoredTicketPanelCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(ticketPanelCollapsedStorageKey) === "1";
  } catch {
    return false;
  }
}

function adjacentTicketPanelSize(current: TicketPanelSize, direction: -1 | 1): TicketPanelSize {
  const currentIndex = ticketPanelSizes.indexOf(current);
  const nextIndex = Math.max(0, Math.min(ticketPanelSizes.length - 1, currentIndex + direction));
  return ticketPanelSizes[nextIndex] ?? current;
}

function queuedSegmentTicketCount(group: QueueGroup): number {
  return group.nextSegmentTicketCount ?? group.ticketCount;
}

export type TicketRow = {
  group: Rotation["bookingGroups"][number];
  rotation: Rotation;
  queue: { resourceGroupName: string; sequence: number } | null;
};
export type TicketSortKey =
  | "ticketGroup"
  | "flightGroup"
  | "queue"
  | "people"
  | "status"
  | "aircraft"
  | "product"
  | "goToGate"
  | "window"
  | "boarding"
  | "offblock"
  | "onblock"
  | "completion";
export type TicketSort = {
  key: TicketSortKey;
  direction: "ascending" | "descending";
} | null;

const ticketColumns: Array<{ key: TicketSortKey; label: string; Icon: LucideIcon }> = [
  { key: "ticketGroup", label: "Ticketgruppe", Icon: Tickets },
  { key: "flightGroup", label: "Fluggruppe", Icon: Tag },
  { key: "queue", label: "Queue", Icon: ListOrdered },
  { key: "people", label: "Personen", Icon: Users },
  { key: "status", label: "Umlaufstatus", Icon: Activity },
  { key: "aircraft", label: "Flugzeug", Icon: Plane },
  { key: "product", label: "Produkt", Icon: Package },
  { key: "goToGate", label: "Voraufruf", Icon: CircleArrowRight },
  { key: "window", label: "Zeitfenster", Icon: Clock3 },
  { key: "boarding", label: "Boarding", Icon: TicketsPlane },
  { key: "offblock", label: "Off-Block", Icon: PlaneTakeoff },
  { key: "onblock", label: "On-Block", Icon: PlaneLanding },
  { key: "completion", label: "Abschluss", Icon: CircleCheck },
];

const ticketCollator = new Intl.Collator("de-DE", { numeric: true, sensitivity: "base" });

export function nextTicketSort(current: TicketSort, key: TicketSortKey): TicketSort {
  if (current?.key !== key) return { key, direction: "ascending" };
  if (current.direction === "ascending") return { key, direction: "descending" };
  return null;
}

function optionalTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : timestamp;
}

function precallDecisionLabel(rotation: Rotation): string {
  if (rotation.status !== "DRAFT") return "–";
  if (rotation.precalledAt || rotation.precallDecision?.status === "GO_TO_GATE") {
    return "GO TO GATE";
  }
  if (rotation.precallDecision?.status === "PREPARE") return "Voraufruf fällig";
  switch (rotation.precallDecision?.reason) {
    case "DISABLED":
      return "Automatik aus";
    case "OPERATIONS_BLOCKED":
      return "Betrieb blockiert";
    case "NOT_QUEUE_FRONT":
      return "Nicht Queue-Front";
    case "NO_FORECAST_CAPACITY":
      return "Keine Prognosekapazität";
    case "NO_FITTING_AIRCRAFT":
      return "Kein passendes Flugzeug";
    case "TOO_EARLY":
      return "Noch zu früh";
    default:
      return "Entscheidung ausstehend";
  }
}

type TicketSortValue = string | number | null;

function ticketSortValue(row: TicketRow, key: TicketSortKey): TicketSortValue {
  const { group, rotation } = row;
  switch (key) {
    case "ticketGroup":
      return group.communicationNumber;
    case "flightGroup":
      return rotation.communicationNumber;
    case "queue":
      return row.queue ? `${row.queue.resourceGroupName}\u0000${row.queue.sequence}` : null;
    case "people":
      return group.ticketCount;
    case "status":
      return rotationStateLabels[rotation.status];
    case "aircraft":
      return rotation.aircraftRegistration;
    case "product":
      return rotation.productName;
    case "goToGate":
      return precallDecisionLabel(rotation);
    case "window":
      return optionalTimestamp(rotation.boardingWindowLowerAt);
    case "boarding":
      return optionalTimestamp(rotation.timeline.actual.boardingAt);
    case "offblock":
      return optionalTimestamp(rotation.timeline.actual.departureAt);
    case "onblock":
      return optionalTimestamp(rotation.timeline.actual.landingAt);
    case "completion":
      return optionalTimestamp(rotation.timeline.actual.completionAt);
  }
}

export function compareTicketRows(left: TicketRow, right: TicketRow, sort: TicketSort): number {
  if (!sort) {
    return (
      right.group.soldAt.localeCompare(left.group.soldAt) ||
      right.group.id.localeCompare(left.group.id)
    );
  }
  const leftValue = ticketSortValue(left, sort.key);
  const rightValue = ticketSortValue(right, sort.key);
  if (leftValue === null && rightValue !== null) return 1;
  if (leftValue !== null && rightValue === null) return -1;
  if (leftValue === null && rightValue === null) {
    return (
      right.group.soldAt.localeCompare(left.group.soldAt) ||
      right.group.id.localeCompare(left.group.id)
    );
  }
  const comparison =
    typeof leftValue === "number" && typeof rightValue === "number"
      ? leftValue - rightValue
      : ticketCollator.compare(String(leftValue), String(rightValue));
  if (comparison !== 0) return sort.direction === "ascending" ? comparison : -comparison;
  return (
    right.group.soldAt.localeCompare(left.group.soldAt) ||
    right.group.id.localeCompare(left.group.id)
  );
}

function operationalStatusTone(
  tone: "critical" | "warning" | "notice" | "normal",
): "danger" | "warning" | "info" | "neutral" {
  switch (tone) {
    case "critical":
      return "danger";
    case "warning":
      return "warning";
    case "notice":
      return "info";
    default:
      return "neutral";
  }
}

function initialAnalyticsSelection(
  aircraft: Aircraft[],
  board: OperationBoard,
): FlightDirectorAnalyticsSelection {
  if (aircraft[0]) return { tab: "aircraft", id: aircraft[0].id };
  if (board.pilots[0]) return { tab: "pilots", id: board.pilots[0].id };
  return {
    tab: "groups",
    id: board.rotations[0]?.bookingGroups[0]?.id ?? board.rotations[0]?.ticketGroupId ?? "",
  };
}

export function FlightLineSupervisorConsole({
  board,
  deviceId,
  deviceToken,
  aircraft,
  selectedAircraft,
  selectedQueueGroupIds,
  operationalSummary,
  operationalSummaryTone,
  canManageOperations,
  dispatchLease,
  onOpenOperations,
  onResourceGroupChange,
  onAssignPilot,
  busyRotationIds,
  onConfirmAssignment,
  onRunRotation,
  onSetAircraftState,
  onPauseAircraft,
  onSelectAircraft,
  onReserveAssignment,
  onToggleGroup,
  onGroupRecall,
  onGroupRecallClear,
  onGroupDefer,
  loadForecastHistory,
  loadResourceHistory,
}: Readonly<{
  board: OperationBoard;
  deviceId: string;
  deviceToken: string;
  aircraft: Aircraft[];
  selectedAircraft: Aircraft | undefined;
  selectedQueueGroupIds: string[];
  operationalSummary: string;
  operationalSummaryTone: "critical" | "warning" | "notice" | "normal";
  canManageOperations: boolean;
  dispatchLease: DispatchRecommendationLeaseController;
  onOpenOperations: (section: FlightDirectorOperationsSection) => void;
  onResourceGroupChange: (resourceGroupId: string) => void;
  onAssignPilot: (aircraftId: string, pilotId: string, reassign: boolean) => Promise<void>;
  busyRotationIds?: ReadonlySet<string>;
  onConfirmAssignment: (queueDeviationReason?: string) => Promise<boolean>;
  onRunRotation: (rotation: Rotation, nextAircraftState?: TurnaroundNextState) => Promise<boolean>;
  onSetAircraftState: (aircraftId: string, state: FlightLineFleetState) => Promise<void>;
  onPauseAircraft: (aircraftId: string) => void;
  onSelectAircraft: (aircraftId: string) => void;
  onReserveAssignment: (aircraftId: string) => Promise<DispatchRecommendationLease | null>;
  onToggleGroup: (ticketGroupId: string, selected: boolean) => void;
  onGroupRecall: (ticketGroupId: string) => void | Promise<void>;
  onGroupRecallClear: (ticketGroupId: string, recallId: string) => void | Promise<void>;
  onGroupDefer: (ticketGroupId: string) => void | Promise<void>;
  loadForecastHistory: (rotationId: string) => Promise<ForecastHistory["entries"]>;
  loadResourceHistory: (
    scopeType: "AIRCRAFT" | "PILOT",
    scopeId: string,
  ) => Promise<ResourceDayHistory>;
}>) {
  const [resourceGroupId, setResourceGroupId] = useState("");
  const [ticketSearch, setTicketSearch] = useState("");
  const [onlyOpenTickets, setOnlyOpenTickets] = useState(true);
  const [ticketSort, setTicketSort] = useState<TicketSort>(null);
  const [ticketPanelCollapsed, setTicketPanelCollapsed] = useState(readStoredTicketPanelCollapsed);
  const [ticketPanelSize, setTicketPanelSize] = useState<TicketPanelSize>("balanced");
  const [assignmentOpen, setAssignmentOpen] = useState(false);
  const [pilotOpen, setPilotOpen] = useState(false);
  const [analysisBusy, setAnalysisBusy] = useState(false);
  const [analysisStatus, setAnalysisStatus] = useState("");
  const [analyticsSelection, setAnalyticsSelection] =
    useState<FlightDirectorAnalyticsSelection | null>(null);
  const [pendingRotationActions, setPendingRotationActions] = useState<
    Record<string, "primary" | "refueling" | "paused" | "inactive">
  >({});
  const [pendingAircraftActions, setPendingAircraftActions] = useState<
    Record<string, "primary" | "refueling" | "inactive">
  >({});
  const dispatchRecommendation = dispatchLease.lease;

  useEffect(() => {
    try {
      if (ticketPanelCollapsed) {
        window.localStorage.setItem(ticketPanelCollapsedStorageKey, "1");
      } else {
        window.localStorage.removeItem(ticketPanelCollapsedStorageKey);
      }
    } catch {
      // The panel remains fully usable when browser storage is unavailable.
    }
  }, [ticketPanelCollapsed]);

  const filteredAircraft = useMemo(
    () => aircraft.filter((entry) => !resourceGroupId || entry.resourceGroupId === resourceGroupId),
    [aircraft, resourceGroupId],
  );
  const activeRotation = selectedAircraft
    ? activeRotationForAircraft(selectedAircraft.id, board.rotations)
    : undefined;
  const compatibleGroups = board.queueGroups.filter(
    (group) =>
      group.resourceGroupId === selectedAircraft?.resourceGroupId &&
      ["QUEUED", "PRESENT", "MISSING"].includes(group.status),
  );
  const selectedGroups = compatibleGroups.filter((group) =>
    selectedQueueGroupIds.includes(group.id),
  );
  const selectedSeats = selectedGroups.reduce(
    (total, group) => total + queuedSegmentTicketCount(group),
    0,
  );
  const capacityExceeded = selectedSeats > (selectedAircraft?.passengerSeats ?? 0);
  const assignmentBlocked =
    !selectedAircraft?.currentPilotId ||
    selectedSeats === 0 ||
    capacityExceeded ||
    board.event.emergencyMode ||
    board.event.status !== "ACTIVE" ||
    board.event.operationalInterrupted;
  const ticketRows = useMemo(() => {
    const query = ticketSearch.trim().toLocaleLowerCase("de-DE");
    const queueByGroupId = new Map(board.queueGroups.map((group) => [group.id, group]));
    const resourceGroupNameById = new Map(
      board.resourceGroups.map((group) => [group.id, group.name]),
    );
    const filteredRows = board.rotations
      .flatMap((rotation) =>
        rotation.bookingGroups.map((group) => {
          const queueGroup = queueByGroupId.get(group.id);
          return {
            group,
            rotation,
            queue: queueGroup
              ? {
                  resourceGroupName:
                    resourceGroupNameById.get(queueGroup.resourceGroupId) ?? queueGroup.productCode,
                  sequence: queueGroup.queueSequence,
                }
              : null,
          };
        }),
      )
      .filter(({ rotation }) => !onlyOpenTickets || rotation.status !== "COMPLETED")
      .filter(({ group, queue, rotation }) => {
        if (!query) return true;
        return `${rotationBookingGroupLabel(rotation, group)} ${rotation.communicationLabel} ${rotation.productName} ${rotation.aircraftRegistration ?? ""} ${queue?.resourceGroupName ?? ""} ${queue?.sequence ?? ""}`
          .toLocaleLowerCase("de-DE")
          .includes(query);
      });
    filteredRows.sort((left, right) => compareTicketRows(left, right, ticketSort));
    return filteredRows.slice(0, 30);
  }, [
    board.queueGroups,
    board.resourceGroups,
    board.rotations,
    onlyOpenTickets,
    ticketSearch,
    ticketSort,
  ]);

  function selectAircraft(aircraftId: string) {
    onSelectAircraft(aircraftId);
    recordAnalysisUiEvent({
      type: "AIRCRAFT_SELECTED",
      occurredAt: new Date().toISOString(),
      aircraftId,
    });
  }

  function toggleAssignmentGroup(ticketGroupId: string, selected: boolean) {
    const nextIds = selected
      ? [...new Set([...selectedQueueGroupIds, ticketGroupId])]
      : selectedQueueGroupIds.filter((id) => id !== ticketGroupId);
    recordAnalysisUiEvent({
      type: "QUEUE_GROUP_SELECTION_CHANGED",
      occurredAt: new Date().toISOString(),
      groupIds: nextIds,
    });
    onToggleGroup(ticketGroupId, selected);
  }

  function closeAssignmentDialog() {
    recordAnalysisUiEvent({
      type: "ASSIGNMENT_DIALOG_CLOSED",
      occurredAt: new Date().toISOString(),
    });
    setAssignmentOpen(false);
    void dispatchLease.release();
  }

  async function exportAnalysisSnapshot(dialogOpen: boolean) {
    if (analysisBusy) return;
    setAnalysisBusy(true);
    setAnalysisStatus("Diagnose-Momentaufnahme wird vorbereitet.");
    recordAnalysisUiEvent({
      type: "ANALYSIS_EXPORT_STARTED",
      occurredAt: new Date().toISOString(),
    });
    try {
      await downloadAnalysisSnapshot(
        board.event.eventId,
        deviceId,
        deviceToken,
        board.event.version,
        buildAnalysisClientContext({
          route: window.location.pathname,
          selectedAircraftId: selectedAircraft?.id ?? null,
          selectedRotationId: activeRotation?.id ?? null,
          selectedQueueGroupIds,
          assignmentDialogOpen: dialogOpen,
          visibleRecommendation: dispatchRecommendation
            ? {
                planRevision: dispatchRecommendation.planRevision,
                batchId: dispatchRecommendation.batchId,
                groupIds: dispatchRecommendation.groupIds,
              }
            : null,
          connectionState: navigator.onLine ? "CONNECTED" : "OFFLINE",
        }),
      );
      recordAnalysisUiEvent({
        type: "ANALYSIS_EXPORT_COMPLETED",
        occurredAt: new Date().toISOString(),
      });
      setAnalysisStatus("Diagnose-Momentaufnahme wurde heruntergeladen.");
    } catch (error) {
      recordAnalysisUiEvent({
        type: "ANALYSIS_EXPORT_FAILED",
        occurredAt: new Date().toISOString(),
      });
      setAnalysisStatus(
        analysisSnapshotRequiresRefresh(error)
          ? "Der Betriebsstand hat sich geändert. Ansicht aktualisieren und Export erneut starten."
          : "Diagnose-Momentaufnahme konnte nicht erstellt werden. Bitte erneut versuchen.",
      );
    } finally {
      setAnalysisBusy(false);
    }
  }

  function openPilot(entry: Aircraft) {
    selectAircraft(entry.id);
    setPilotOpen(true);
  }

  async function runRotationAction(
    rotation: Rotation,
    action: "primary" | "refueling" | "paused" | "inactive",
    nextAircraftState?: TurnaroundNextState,
  ) {
    setPendingRotationActions((current) => ({ ...current, [rotation.id]: action }));
    try {
      await onRunRotation(rotation, nextAircraftState);
    } finally {
      setPendingRotationActions((current) => {
        const next = { ...current };
        delete next[rotation.id];
        return next;
      });
    }
  }

  async function runAircraftStateAction(
    entry: Aircraft,
    action: "primary" | "refueling" | "inactive",
    state: FlightLineFleetState,
  ) {
    setPendingAircraftActions((current) => ({ ...current, [entry.id]: action }));
    try {
      await onSetAircraftState(entry.id, state);
    } finally {
      setPendingAircraftActions((current) => {
        const next = { ...current };
        delete next[entry.id];
        return next;
      });
    }
  }

  async function runPrimary(entry: Aircraft, rotation: Rotation | undefined) {
    selectAircraft(entry.id);
    if (entry.operationalState === "REFUELING" || entry.operationalState === "PAUSED") {
      return runAircraftStateAction(entry, "primary", "AVAILABLE");
    }
    if (["INTERRUPTED", "INACTIVE", "TURNAROUND"].includes(entry.operationalState)) {
      return runAircraftStateAction(entry, "primary", "AVAILABLE");
    }
    if (!rotation || rotation.status === "DRAFT") {
      setAssignmentOpen(true);
      recordAnalysisUiEvent({
        type: "ASSIGNMENT_DIALOG_OPENED",
        occurredAt: new Date().toISOString(),
        rotationId: rotation?.id ?? null,
      });
      const recommendation = await onReserveAssignment(entry.id);
      if (recommendation) {
        recordAnalysisUiEvent({
          type: "DISPATCH_RECOMMENDATION_APPLIED",
          occurredAt: new Date().toISOString(),
          planRevision: recommendation.planRevision,
          batchId: recommendation.batchId,
          groupIds: recommendation.groupIds,
        });
      }
      return;
    }
    return runRotationAction(
      rotation,
      "primary",
      rotation.status === "LANDED" ? "AVAILABLE" : undefined,
    );
  }

  return (
    <section className="flight-director-v15">
      <PageHeader
        actions={
          <div className="flight-director-header-actions">
            <StatusPill
              aria-live="polite"
              className={`flight-director-operational-summary tone-${operationalSummaryTone}`}
              tone={operationalStatusTone(operationalSummaryTone)}
            >
              {operationalSummary}
            </StatusPill>
            <fieldset className="flight-director-operation-shortcuts">
              <legend className="visually-hidden">Betriebssteuerung</legend>
              <Button
                disabled={!canManageOperations}
                onClick={() => onOpenOperations("operations")}
                size="compact"
                type="button"
                variant="secondary"
              >
                Betrieb
              </Button>
              <Button
                disabled={!canManageOperations}
                onClick={() => onOpenOperations("plan")}
                size="compact"
                type="button"
                variant="secondary"
              >
                Betriebsplan
              </Button>
              <Button
                disabled={!canManageOperations}
                onClick={() => onOpenOperations("resources")}
                size="compact"
                type="button"
                variant="secondary"
              >
                Ressourcengruppen
              </Button>
            </fieldset>
            <IconButton
              className="flight-director-analytics-action"
              label="Auswertungen"
              onClick={() => setAnalyticsSelection(initialAnalyticsSelection(aircraft, board))}
              size="compact"
              type="button"
            >
              <ChartNoAxesCombined aria-hidden="true" />
            </IconButton>
            <IconButton
              busy={analysisBusy}
              className="flight-director-analysis-action"
              label="Support-sichere Diagnose-Momentaufnahme herunterladen"
              onClick={() => exportAnalysisSnapshot(false)}
              size="compact"
              type="button"
            >
              <Download aria-hidden="true" />
            </IconButton>
            <span aria-live="polite" className="visually-hidden">
              {analysisStatus}
            </span>
            <SelectField
              aria-label="Ressourcengruppe filtern"
              className="flight-director-resource-filter"
              label="Ressource"
              onChange={(event) => {
                setResourceGroupId(event.target.value);
                onResourceGroupChange(event.target.value);
              }}
              value={resourceGroupId}
            >
              <option value="">Alle Ressourcen</option>
              {board.resourceGroups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </SelectField>
          </div>
        }
        title={
          <>
            Flugzeuge <span className="flight-director-title-detail">– Übersicht</span>{" "}
            <small>{aircraft.length} insgesamt</small>
          </>
        }
      />

      <Panel className="flight-director-aircraft" padding="none">
        <section className="flight-director-aircraft-table" aria-label="Flugzeuge">
          <div className="flight-director-aircraft-head">
            <span className="flight-director-column-icon" title="Flugzeug">
              <Plane aria-hidden="true" />
              <span className="visually-hidden">Flugzeug</span>
            </span>
            <span className="flight-director-column-icon" title="Details">
              <Info aria-hidden="true" />
              <span className="visually-hidden">Details</span>
            </span>
            <span className="flight-director-column-icon" title="Buchungsgruppen">
              <Tickets aria-hidden="true" />
              <span className="visually-hidden">Buchungsgruppen</span>
            </span>
            <span className="flight-director-column-icon" title="Zeitverlauf">
              <Clock3 aria-hidden="true" />
              <span className="visually-hidden">Zeitverlauf</span>
            </span>
            <span className="flight-director-column-icon" title="Aktionen">
              <Settings2 aria-hidden="true" />
              <span className="visually-hidden">Aktionen</span>
            </span>
          </div>
          {filteredAircraft.map((entry) => {
            const rotation = operationalRotationForAircraft(entry, board.rotations, board.products);
            const pilotChangeAllowed = !rotation || ["DRAFT", "CALLED"].includes(rotation.status);
            const startBlockAllowed = entry.operationalState === "AVAILABLE";
            const unavailableAllowed =
              startBlockAllowed ||
              Boolean(rotation && ["CALLED", "IN_FLIGHT", "LANDED"].includes(rotation.status));
            const turnaroundActionAllowed = rotation?.status === "LANDED";
            const actionBusy =
              Boolean(pendingAircraftActions[entry.id]) ||
              (rotation ? Boolean(busyRotationIds?.has(rotation.id)) : false);
            const pendingAction =
              (rotation ? pendingRotationActions[rotation.id] : undefined) ??
              pendingAircraftActions[entry.id];
            const primaryPresentation = primaryAircraftActionPresentation(entry, rotation);
            const PrimaryActionIcon = primaryPresentation.Icon;
            return (
              <div className="flight-director-aircraft-row" key={entry.id}>
                <span className="flight-director-aircraft-name">
                  <span>
                    <strong>{entry.registration}</strong>
                    <small>{entry.aircraftType}</small>
                  </span>
                </span>
                <span className="flight-director-aircraft-details">
                  <small>{entry.passengerSeats} Plätze</small>
                  <small title={entry.resourceGroupName}>{entry.resourceGroupShortCode}</small>
                  <strong>{entry.currentPilotOperationalCode ?? "–"}</strong>
                </span>
                <span className="flight-director-group-chips">
                  {rotation && rotation.status !== "DRAFT" ? (
                    rotation.bookingGroups.map((group) => (
                      <small key={group.id}>{rotationBookingGroupLabel(rotation, group)}</small>
                    ))
                  ) : (
                    <small>–</small>
                  )}
                </span>
                <span className="flight-director-timeline">
                  <FlightProgress
                    aircraft={entry}
                    rotation={rotation}
                    timeZone={board.event.timeZone}
                    variant="detailed"
                  />
                </span>
                <span className="flight-director-row-actions">
                  <IconButton
                    className="flight-director-primary-action"
                    data-label-density={
                      primaryPresentation.shortLabel.length > 16 ? "compact" : undefined
                    }
                    label={primaryAircraftActionLabel(entry, rotation)}
                    disabled={rotation?.status === "COMPLETED" || actionBusy}
                    busy={pendingAction === "primary"}
                    onClick={(event) => {
                      event.stopPropagation();
                      return runPrimary(entry, rotation);
                    }}
                    size="touch"
                    type="button"
                  >
                    <PrimaryActionIcon aria-hidden="true" />
                    <span>{primaryPresentation.shortLabel}</span>
                  </IconButton>
                  <IconButton
                    aria-pressed={entry.operationalState === "REFUELING"}
                    className="flight-line-status-action state-refueling"
                    disabled={(!startBlockAllowed && !turnaroundActionAllowed) || actionBusy}
                    label={`${entry.registration} zum Tanken setzen`}
                    onClick={async (event) => {
                      event.stopPropagation();
                      if (turnaroundActionAllowed && rotation) {
                        await runRotationAction(rotation, "refueling", "REFUELING");
                      } else {
                        await runAircraftStateAction(entry, "refueling", "REFUELING");
                      }
                    }}
                    size="touch"
                    busy={pendingAction === "refueling"}
                    type="button"
                  >
                    <Fuel aria-hidden="true" />
                  </IconButton>
                  <IconButton
                    aria-pressed={entry.operationalState === "PAUSED"}
                    className="flight-line-status-action state-paused"
                    disabled={(!startBlockAllowed && !turnaroundActionAllowed) || actionBusy}
                    label={`${entry.registration} in Pause setzen`}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (turnaroundActionAllowed && rotation) {
                        void runRotationAction(rotation, "paused", "PAUSED");
                      } else {
                        onPauseAircraft(entry.id);
                      }
                    }}
                    size="touch"
                    busy={pendingAction === "paused"}
                    type="button"
                  >
                    <Coffee aria-hidden="true" />
                  </IconButton>
                  <IconButton
                    aria-pressed={["INACTIVE", "INTERRUPTED"].includes(entry.operationalState)}
                    className="flight-line-status-action state-inactive"
                    disabled={!unavailableAllowed || actionBusy}
                    label={`${entry.registration} nicht verfügbar setzen`}
                    onClick={async (event) => {
                      event.stopPropagation();
                      if (turnaroundActionAllowed && rotation) {
                        await runRotationAction(rotation, "inactive", "INACTIVE");
                      } else {
                        await runAircraftStateAction(entry, "inactive", "INACTIVE");
                      }
                    }}
                    size="touch"
                    busy={pendingAction === "inactive"}
                    type="button"
                  >
                    <CircleX aria-hidden="true" />
                  </IconButton>
                  <IconButton
                    disabled={!pilotChangeAllowed || actionBusy}
                    label={`Pilot für ${entry.registration} zuweisen`}
                    onClick={(event) => {
                      event.stopPropagation();
                      openPilot(entry);
                    }}
                    size="touch"
                    type="button"
                  >
                    <PilotChangeIcon aria-hidden="true" />
                  </IconButton>
                  <IconButton
                    label={`Tagesauswertung für ${entry.registration} anzeigen`}
                    onClick={(event) => {
                      event.stopPropagation();
                      setAnalyticsSelection({ tab: "aircraft", id: entry.id });
                    }}
                    size="touch"
                    type="button"
                  >
                    <ChartNoAxesCombined aria-hidden="true" />
                  </IconButton>
                </span>
              </div>
            );
          })}
        </section>
      </Panel>

      <div
        className={`flight-director-bottom-grid is-ticket-only size-${ticketPanelSize}${
          ticketPanelCollapsed ? " is-collapsed" : ""
        }`}
      >
        <Panel
          aria-label="Verkaufte Tickets"
          className={`flight-director-ticket-overview${
            ticketPanelCollapsed ? " is-collapsed" : ""
          }`}
          padding="none"
        >
          <header>
            <h2>
              Verkaufte Tickets <small>alle Flugzeuge</small>
            </h2>
            {!ticketPanelCollapsed ? (
              <>
                <SearchField
                  className="flight-director-ticket-search"
                  label="Verkaufte Tickets suchen"
                  onChange={(event) => setTicketSearch(event.target.value)}
                  placeholder="Nach Ticket-ID oder Produkt suchen"
                  value={ticketSearch}
                />
                <label className="flight-director-open-filter">
                  <input
                    checked={onlyOpenTickets}
                    onChange={(event) => setOnlyOpenTickets(event.target.checked)}
                    type="checkbox"
                  />
                  <span>Nur offene Tickets</span>
                </label>
              </>
            ) : null}
            <div className="flight-director-ticket-size-actions">
              {!ticketPanelCollapsed ? (
                <>
                  <IconButton
                    disabled={ticketPanelSize === "compact"}
                    label="Verkaufte Tickets verkleinern"
                    onClick={() =>
                      setTicketPanelSize((current) => adjacentTicketPanelSize(current, -1))
                    }
                    size="compact"
                  >
                    <span aria-hidden="true">−</span>
                  </IconButton>
                  <IconButton
                    disabled={ticketPanelSize === "expanded"}
                    label="Verkaufte Tickets vergrößern"
                    onClick={() =>
                      setTicketPanelSize((current) => adjacentTicketPanelSize(current, 1))
                    }
                    size="compact"
                  >
                    <span aria-hidden="true">+</span>
                  </IconButton>
                </>
              ) : null}
              <IconButton
                aria-expanded={!ticketPanelCollapsed}
                label={
                  ticketPanelCollapsed
                    ? "Verkaufte Tickets ausklappen"
                    : "Verkaufte Tickets einklappen"
                }
                onClick={() => setTicketPanelCollapsed((collapsed) => !collapsed)}
                size="compact"
              >
                {ticketPanelCollapsed ? (
                  <PanelBottomOpen aria-hidden="true" />
                ) : (
                  <PanelBottomClose aria-hidden="true" />
                )}
              </IconButton>
            </div>
          </header>
          {!ticketPanelCollapsed ? (
            <CompactTickets
              onOpenAnalytics={(ticketGroupId, rotationId) =>
                setAnalyticsSelection({ tab: "groups", id: ticketGroupId, rotationId })
              }
              onSort={(key) => setTicketSort((current) => nextTicketSort(current, key))}
              rows={ticketRows}
              sort={ticketSort}
              timeZone={board.event.timeZone}
            />
          ) : null}
        </Panel>
      </div>

      <FlightDirectorAnalyticsDialog
        board={board}
        initialSelection={analyticsSelection}
        loadForecastHistory={loadForecastHistory}
        loadResourceHistory={loadResourceHistory}
        onClose={() => setAnalyticsSelection(null)}
        open={analyticsSelection !== null}
      />

      <BookingGroupAssignmentDialog
        aircraft={selectedAircraft}
        confirmDisabled={assignmentBlocked}
        dispatchLease={dispatchLease}
        groups={compatibleGroups}
        headerActions={
          <IconButton
            busy={analysisBusy}
            label="Support-sichere Diagnose-Momentaufnahme herunterladen"
            onClick={() => exportAnalysisSnapshot(true)}
            size="compact"
            type="button"
          >
            <Download aria-hidden="true" />
          </IconButton>
        }
        onClose={closeAssignmentDialog}
        onDefer={onGroupDefer}
        onConfirm={async (queueDeviationReason) => {
          if (await onConfirmAssignment(queueDeviationReason)) closeAssignmentDialog();
        }}
        onRecall={onGroupRecall}
        onRecallClear={onGroupRecallClear}
        onReserveRecommendation={async () => {
          if (selectedAircraft) await onReserveAssignment(selectedAircraft.id);
        }}
        onToggle={toggleAssignmentGroup}
        open={assignmentOpen}
        selectedQueueGroupIds={selectedQueueGroupIds}
        timeZone={board.event.timeZone}
      />

      <PilotAssignmentDialogs
        aircraft={selectedAircraft}
        board={board}
        currentRotation={activeRotation}
        onAssignPilot={onAssignPilot}
        onClose={() => setPilotOpen(false)}
        open={pilotOpen}
      />
    </section>
  );
}

function RotationPhaseIcon({ rotation }: Readonly<{ rotation: Rotation }>) {
  const label = rotationStateLabels[rotation.status];
  let Icon = CircleCheck;
  switch (rotation.status) {
    case "DRAFT":
      Icon = Clock3;
      break;
    case "CALLED":
      Icon = TicketsPlane;
      break;
    case "IN_FLIGHT":
      Icon = PlaneTakeoff;
      break;
    case "LANDED":
      Icon = PlaneLanding;
      break;
  }
  return (
    <span className="flight-director-phase-icon" role="img" aria-label={label} title={label}>
      <Icon aria-hidden="true" size={15} />
    </span>
  );
}

function rotationWindowPhase(rotation: Rotation): "NOW" | "FORECAST" | "FINISHED" {
  if (rotation.status === "CALLED") return "NOW";
  if (rotation.status === "DRAFT" && rotation.precalledAt) return "NOW";
  if (rotation.status === "DRAFT") return "FORECAST";
  return "FINISHED";
}

function compactRotationTimeWindow(rotation: Rotation, timeZone: string): string {
  const window = formatAbsoluteTimeWindow({
    lowerAt: rotation.boardingWindowLowerAt,
    upperAt: rotation.boardingWindowUpperAt,
    timeZone,
    variant: "compact",
    quality: rotation.timeline.predictionQuality,
    phase: rotationWindowPhase(rotation),
  });
  if (!rotation.timeline.extendsBeyondOperationsEnd) return window;
  return `${window} · Ende +${rotation.timeline.overtimeMinutes} Min.`;
}

function ticketSortAriaLabel(columnLabel: string, active: boolean, sort: TicketSort): string {
  if (!active) return `${columnLabel} sortieren · Standardsortierung`;
  const direction = sort?.direction === "ascending" ? "aufsteigend" : "absteigend";
  return `${columnLabel} sortieren · ${direction}`;
}

function TicketSortIndicator({ active, sort }: Readonly<{ active: boolean; sort: TicketSort }>) {
  if (!active) return null;
  return sort?.direction === "ascending" ? (
    <ArrowUp aria-hidden="true" />
  ) : (
    <ArrowDown aria-hidden="true" />
  );
}

function PrecallDecisionIcon({ rotation }: Readonly<{ rotation: Rotation }>) {
  if (rotation.status === "DRAFT" && rotation.precalledAt) {
    return <Check aria-hidden="true" size={14} />;
  }
  if (rotation.precallDecision?.status === "PREPARE") {
    return <Clock3 aria-hidden="true" size={14} />;
  }
  return null;
}

function CompactTicketRows({
  onOpenAnalytics,
  rows,
  timeZone,
}: Readonly<{
  onOpenAnalytics: (ticketGroupId: string, rotationId: string) => void;
  rows: TicketRow[];
  timeZone: string;
}>) {
  if (rows.length === 0) {
    return (
      <p>
        <Plane aria-hidden="true" /> Noch keine verkauften Tickets.
      </p>
    );
  }
  return rows.map(({ group, queue, rotation }) => (
    <div key={`${rotation.id}-${group.id}`}>
      <strong>{rotationBookingGroupLabel(rotation, group)}</strong>
      <span>{rotation.communicationLabel}</span>
      <span>{queue ? `${queue.resourceGroupName} · ${queue.sequence}` : "–"}</span>
      <span>{group.ticketCount}</span>
      <span>
        <RotationPhaseIcon rotation={rotation} />
      </span>
      <span>{rotation.aircraftRegistration ?? "Noch offen"}</span>
      <span>{rotation.productName}</span>
      <span
        className={`precall-decision precall-decision--${rotation.precallDecision?.status.toLowerCase() ?? "unknown"}`}
        title={precallDecisionLabel(rotation)}
      >
        <PrecallDecisionIcon rotation={rotation} />
        {precallDecisionLabel(rotation)}
      </span>
      <span>{compactRotationTimeWindow(rotation, timeZone)}</span>
      <span>{formatFlightLineTime(rotation.timeline.actual.boardingAt, timeZone)}</span>
      <span>{formatFlightLineTime(rotation.timeline.actual.departureAt, timeZone)}</span>
      <span>{formatFlightLineTime(rotation.timeline.actual.landingAt, timeZone)}</span>
      <span>{formatFlightLineTime(rotation.timeline.actual.completionAt, timeZone)}</span>
      <span className="ticket-analytics-action">
        <IconButton
          label={`Tagesauswertung für ${rotationBookingGroupLabel(rotation, group)} anzeigen`}
          onClick={() => onOpenAnalytics(group.id, rotation.id)}
          size="compact"
          type="button"
        >
          <ChartNoAxesCombined aria-hidden="true" />
        </IconButton>
      </span>
    </div>
  ));
}

function CompactTickets({
  rows,
  timeZone,
  sort,
  onSort,
  onOpenAnalytics,
}: Readonly<{
  rows: TicketRow[];
  timeZone: string;
  sort: TicketSort;
  onSort: (key: TicketSortKey) => void;
  onOpenAnalytics: (ticketGroupId: string, rotationId: string) => void;
}>) {
  return (
    <div className="flight-director-compact-table tickets">
      <div className="flight-director-compact-head">
        {ticketColumns.map((column) => {
          const active = sort?.key === column.key;
          const HeaderIcon = column.Icon;
          return (
            <span key={column.key}>
              <button
                aria-label={ticketSortAriaLabel(column.label, active, sort)}
                aria-pressed={active}
                onClick={() => onSort(column.key)}
                title={column.label}
                type="button"
              >
                <HeaderIcon aria-hidden="true" />
                <span className="visually-hidden">{column.label}</span>
                <TicketSortIndicator active={active} sort={sort} />
              </button>
            </span>
          );
        })}
        <span className="ticket-analytics-action" title="Prognoseverlauf">
          <ChartNoAxesCombined aria-hidden="true" />
          <span className="visually-hidden">Prognoseverlauf</span>
        </span>
      </div>
      <CompactTicketRows onOpenAnalytics={onOpenAnalytics} rows={rows} timeZone={timeZone} />
    </div>
  );
}
