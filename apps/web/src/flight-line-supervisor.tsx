import type { OperationBoard } from "@rundflug/contracts";
import { formatBookingGroupLabel, rotationStateLabels } from "@rundflug/domain";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  ArrowDown,
  ArrowUp,
  Check,
  CircleArrowRight,
  CircleCheck,
  CircleX,
  Clock3,
  Coffee,
  Fuel,
  History,
  Info,
  ListOrdered,
  Package,
  Plane,
  PlaneLanding,
  PlaneTakeoff,
  Settings2,
  Tag,
  Tickets,
  TicketsPlane,
  Users,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  Button,
  IconButton,
  ModalDialog,
  PageHeader,
  Panel,
  SearchField,
  SelectField,
} from "./design-system/components";
import {
  activeRotationForAircraft,
  BookingGroupAssignmentDialog,
  CompactHistory,
  type FlightLineFleetState,
  FlightProgress,
  formatFlightLineTime,
  operationalRotationForAircraft,
  PilotAssignmentDialogs,
  PilotChangeIcon,
  primaryAircraftActionLabel,
  primaryAircraftActionPresentation,
  rotationHistoryForAircraft,
} from "./flight-line-shared";
import { formatAbsoluteTimeWindow } from "./time-window";

type Aircraft = OperationBoard["aircraft"][number];
type Rotation = OperationBoard["rotations"][number];
type QueueGroup = OperationBoard["queueGroups"][number];
type TurnaroundNextState = "AVAILABLE" | "REFUELING" | "PAUSED" | "INACTIVE";

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
  { key: "goToGate", label: "GoToGate-Aktiv", Icon: CircleArrowRight },
  { key: "window", label: "Zeitfenster", Icon: Clock3 },
  { key: "boarding", label: "Boarding", Icon: TicketsPlane },
  { key: "offblock", label: "Off-Block", Icon: PlaneTakeoff },
  { key: "onblock", label: "On-Block", Icon: PlaneLanding },
  { key: "completion", label: "Abschluss", Icon: CircleCheck },
];

const ticketCollator = new Intl.Collator("de-DE", { numeric: true, sensitivity: "base" });

export function nextTicketSort(current: TicketSort, key: TicketSortKey): TicketSort {
  if (!current || current.key !== key) return { key, direction: "ascending" };
  if (current.direction === "ascending") return { key, direction: "descending" };
  return null;
}

function optionalTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : timestamp;
}

function ticketSortValue(row: TicketRow, key: TicketSortKey): string | number | null {
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
      return rotation.status === "DRAFT" && rotation.precalledAt ? 1 : 0;
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

export function FlightLineSupervisorConsole({
  board,
  aircraft,
  selectedAircraft,
  selectedQueueGroupIds,
  operationalSummary,
  operationalSummaryTone,
  canManageOperations,
  onOpenOperations,
  onResourceGroupChange,
  onAssignPilot,
  busyRotationIds,
  onConfirmAssignment,
  onRunRotation,
  onSetAircraftState,
  onPauseAircraft,
  onSelectAircraft,
  onToggleGroup,
  onGroupAttendance,
  onGroupMissing,
  onGroupRecall,
  onGroupDefer,
}: {
  board: OperationBoard;
  aircraft: Aircraft[];
  selectedAircraft: Aircraft | undefined;
  selectedQueueGroupIds: string[];
  operationalSummary: string;
  operationalSummaryTone: "critical" | "warning" | "notice" | "normal";
  canManageOperations: boolean;
  onOpenOperations: () => void;
  onResourceGroupChange: (resourceGroupId: string) => void;
  onAssignPilot: (aircraftId: string, pilotId: string, reassign: boolean) => Promise<void>;
  busyRotationIds?: ReadonlySet<string>;
  onConfirmAssignment: () => Promise<void>;
  onRunRotation: (rotation: Rotation, nextAircraftState?: TurnaroundNextState) => Promise<void>;
  onSetAircraftState: (aircraftId: string, state: FlightLineFleetState) => Promise<void>;
  onPauseAircraft: (aircraftId: string) => void;
  onSelectAircraft: (aircraftId: string) => void;
  onToggleGroup: (ticketGroupId: string, selected: boolean) => void;
  onGroupAttendance: (ticketGroupId: string, checkedIn: boolean) => void | Promise<void>;
  onGroupMissing: (ticketGroupId: string) => void | Promise<void>;
  onGroupRecall: (ticketGroupId: string) => void | Promise<void>;
  onGroupDefer: (ticketGroupId: string) => void | Promise<void>;
}) {
  const [resourceGroupId, setResourceGroupId] = useState("");
  const [ticketSearch, setTicketSearch] = useState("");
  const [onlyOpenTickets, setOnlyOpenTickets] = useState(true);
  const [ticketSort, setTicketSort] = useState<TicketSort>(null);
  const [assignmentOpen, setAssignmentOpen] = useState(false);
  const [pilotOpen, setPilotOpen] = useState(false);
  const [historyAircraftId, setHistoryAircraftId] = useState<string | null>(null);
  const [pendingRotationActions, setPendingRotationActions] = useState<
    Record<string, "primary" | "refueling" | "paused" | "inactive">
  >({});
  const [pendingAircraftActions, setPendingAircraftActions] = useState<
    Record<string, "primary" | "refueling" | "inactive">
  >({});

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
  const historyAircraft = aircraft.find((entry) => entry.id === historyAircraftId);
  const history = historyAircraftId
    ? rotationHistoryForAircraft(historyAircraftId, board.rotations)
    : [];
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
        return `${formatBookingGroupLabel(rotation.productCode, group.communicationNumber)} ${rotation.communicationLabel} ${rotation.productName} ${rotation.aircraftRegistration ?? ""} ${queue?.resourceGroupName ?? ""} ${queue?.sequence ?? ""}`
          .toLocaleLowerCase("de-DE")
          .includes(query);
      });
    return filteredRows
      .sort((left, right) => compareTicketRows(left, right, ticketSort))
      .slice(0, 30);
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

  function runPrimary(entry: Aircraft, rotation: Rotation | undefined) {
    selectAircraft(entry.id);
    if (entry.operationalState === "REFUELING" || entry.operationalState === "PAUSED") {
      return runAircraftStateAction(entry, "primary", "AVAILABLE");
    }
    if (["INTERRUPTED", "INACTIVE", "TURNAROUND"].includes(entry.operationalState)) {
      return runAircraftStateAction(entry, "primary", "AVAILABLE");
    }
    if (!rotation || rotation.status === "DRAFT") {
      setAssignmentOpen(true);
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
            <span
              aria-live="polite"
              className={`flight-director-operational-summary tone-${operationalSummaryTone}`}
            >
              {operationalSummary}
            </span>
            <Button
              disabled={!canManageOperations}
              onClick={onOpenOperations}
              type="button"
              variant="secondary"
            >
              Betrieb
            </Button>
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
                      <small key={group.id}>
                        {formatBookingGroupLabel(rotation.productCode, group.communicationNumber)}
                      </small>
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
                    label={`Historie für ${entry.registration} anzeigen`}
                    onClick={(event) => {
                      event.stopPropagation();
                      setHistoryAircraftId(entry.id);
                    }}
                    size="touch"
                    type="button"
                  >
                    <History aria-hidden="true" />
                  </IconButton>
                </span>
              </div>
            );
          })}
        </section>
      </Panel>

      <div className="flight-director-bottom-grid is-ticket-only">
        <Panel className="flight-director-ticket-overview" padding="none">
          <header>
            <h2>
              Verkaufte Tickets <small>alle Flugzeuge</small>
            </h2>
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
          </header>
          <CompactTickets
            onSort={(key) => setTicketSort((current) => nextTicketSort(current, key))}
            rows={ticketRows}
            sort={ticketSort}
            timeZone={board.event.timeZone}
          />
        </Panel>
      </div>

      <ModalDialog
        description={
          historyAircraft ? `Abgeschlossene Umläufe von ${historyAircraft.registration}` : undefined
        }
        footer={
          <Button onClick={() => setHistoryAircraftId(null)} type="button" variant="secondary">
            Schließen
          </Button>
        }
        onClose={() => setHistoryAircraftId(null)}
        open={historyAircraftId !== null}
        size="wide"
        title="Historie anzeigen"
      >
        <div className="flight-director-history-dialog">
          <CompactHistory history={history} timeZone={board.event.timeZone} />
        </div>
      </ModalDialog>

      <BookingGroupAssignmentDialog
        aircraft={selectedAircraft}
        confirmDisabled={assignmentBlocked}
        groups={compatibleGroups}
        onClose={() => setAssignmentOpen(false)}
        onAttendance={onGroupAttendance}
        onDefer={onGroupDefer}
        onConfirm={async () => {
          await onConfirmAssignment();
          setAssignmentOpen(false);
        }}
        onMissing={onGroupMissing}
        onRecall={onGroupRecall}
        onToggle={onToggleGroup}
        open={assignmentOpen}
        selectedQueueGroupIds={selectedQueueGroupIds}
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

function CompactTickets({
  rows,
  timeZone,
  sort,
  onSort,
}: {
  rows: TicketRow[];
  timeZone: string;
  sort: TicketSort;
  onSort: (key: TicketSortKey) => void;
}) {
  const phaseIcon = (rotation: Rotation) => {
    const label = rotationStateLabels[rotation.status];
    const props = { "aria-hidden": true, size: 15 } as const;
    const icon =
      rotation.status === "DRAFT" ? (
        <Clock3 {...props} />
      ) : rotation.status === "CALLED" ? (
        <TicketsPlane {...props} />
      ) : rotation.status === "IN_FLIGHT" ? (
        <PlaneTakeoff {...props} />
      ) : rotation.status === "LANDED" ? (
        <PlaneLanding {...props} />
      ) : (
        <CircleCheck {...props} />
      );
    return (
      <span className="flight-director-phase-icon" role="img" aria-label={label} title={label}>
        {icon}
      </span>
    );
  };
  const timeWindow = (rotation: Rotation) =>
    formatAbsoluteTimeWindow({
      lowerAt: rotation.boardingWindowLowerAt,
      upperAt: rotation.boardingWindowUpperAt,
      timeZone,
      variant: "compact",
      quality: rotation.timeline.predictionQuality,
      phase:
        rotation.status === "CALLED" ||
        (rotation.status === "DRAFT" && Boolean(rotation.precalledAt))
          ? "NOW"
          : rotation.status === "DRAFT"
            ? "FORECAST"
            : "FINISHED",
    });
  return (
    <div className="flight-director-compact-table tickets">
      <div className="flight-director-compact-head">
        {ticketColumns.map((column) => {
          const active = sort?.key === column.key;
          const HeaderIcon = column.Icon;
          return (
            <span key={column.key}>
              <button
                aria-label={`${column.label} sortieren · ${active ? (sort.direction === "ascending" ? "aufsteigend" : "absteigend") : "Standardsortierung"}`}
                aria-pressed={active}
                onClick={() => onSort(column.key)}
                title={column.label}
                type="button"
              >
                <HeaderIcon aria-hidden="true" />
                <span className="visually-hidden">{column.label}</span>
                {active ? (
                  sort.direction === "ascending" ? (
                    <ArrowUp aria-hidden="true" />
                  ) : (
                    <ArrowDown aria-hidden="true" />
                  )
                ) : null}
              </button>
            </span>
          );
        })}
      </div>
      {rows.length > 0 ? (
        rows.map(({ group, queue, rotation }) => (
          <div key={`${rotation.id}-${group.id}`}>
            <strong>
              {formatBookingGroupLabel(rotation.productCode, group.communicationNumber)}
            </strong>
            <span>{rotation.communicationLabel}</span>
            <span>{queue ? `${queue.resourceGroupName} · ${queue.sequence}` : "–"}</span>
            <span>{group.ticketCount}</span>
            <span>{phaseIcon(rotation)}</span>
            <span>{rotation.aircraftRegistration ?? "Noch offen"}</span>
            <span>{rotation.productName}</span>
            <span>
              {rotation.status === "DRAFT" && rotation.precalledAt ? (
                <Check aria-label="GoToGate-Aktiv" size={16} />
              ) : null}
            </span>
            <span>{timeWindow(rotation)}</span>
            <span>{formatFlightLineTime(rotation.timeline.actual.boardingAt, timeZone)}</span>
            <span>{formatFlightLineTime(rotation.timeline.actual.departureAt, timeZone)}</span>
            <span>{formatFlightLineTime(rotation.timeline.actual.landingAt, timeZone)}</span>
            <span>{formatFlightLineTime(rotation.timeline.actual.completionAt, timeZone)}</span>
          </div>
        ))
      ) : (
        <p>
          <Plane aria-hidden="true" /> Noch keine verkauften Tickets.
        </p>
      )}
    </div>
  );
}
