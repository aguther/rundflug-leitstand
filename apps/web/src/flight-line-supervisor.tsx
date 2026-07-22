import type { OperationBoard } from "@rundflug/contracts";
import { rotationStateLabels } from "@rundflug/domain";
import { ArrowDown, ArrowUp, CircleOff, Coffee, Fuel, History, Plane } from "lucide-react";
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
  flightLineGroupLabel,
  formatFlightLineTime,
  operationalRotationForAircraft,
  PilotAssignmentDialogs,
  PilotChangeIcon,
  primaryAircraftActionLabel,
  primaryAircraftActionPresentation,
  rotationHistoryForAircraft,
} from "./flight-line-shared";

type Aircraft = OperationBoard["aircraft"][number];
type Rotation = OperationBoard["rotations"][number];
type QueueGroup = OperationBoard["queueGroups"][number];

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
  | "queue"
  | "people"
  | "status"
  | "aircraft"
  | "product"
  | "window"
  | "boarding"
  | "offblock"
  | "onblock"
  | "completion";
export type TicketSort = {
  key: TicketSortKey;
  direction: "ascending" | "descending";
} | null;

const ticketColumns: Array<{ key: TicketSortKey; label: string }> = [
  { key: "ticketGroup", label: "Ticketgruppe" },
  { key: "queue", label: "Queue" },
  { key: "people", label: "Personen" },
  { key: "status", label: "Umlaufstatus" },
  { key: "aircraft", label: "Flugzeug" },
  { key: "product", label: "Produkt" },
  { key: "window", label: "Zeitfenster" },
  { key: "boarding", label: "Boarding" },
  { key: "offblock", label: "Off-Block" },
  { key: "onblock", label: "On-Block" },
  { key: "completion", label: "Abschluss" },
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
    case "window":
      return rotation.timeline.actual.departureAt ? null : rotation.predictedLowerMinutes;
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
  onAssignPilot,
  onConfirmAssignment,
  onRunRotation,
  onSetAircraftState,
  onPauseAircraft,
  onSelectAircraft,
  onToggleGroup,
  onGroupAttendance,
  onGroupMissing,
  onGroupRecall,
}: {
  board: OperationBoard;
  aircraft: Aircraft[];
  selectedAircraft: Aircraft | undefined;
  selectedQueueGroupIds: string[];
  onAssignPilot: (aircraftId: string, pilotId: string, reassign: boolean) => Promise<void>;
  onConfirmAssignment: () => void;
  onRunRotation: (rotation: Rotation) => void;
  onSetAircraftState: (aircraftId: string, state: FlightLineFleetState) => void;
  onPauseAircraft: (aircraftId: string) => void;
  onSelectAircraft: (aircraftId: string) => void;
  onToggleGroup: (ticketGroupId: string, selected: boolean) => void;
  onGroupAttendance: (ticketGroupId: string, checkedIn: boolean) => void;
  onGroupMissing: (ticketGroupId: string) => void;
  onGroupRecall: (ticketGroupId: string) => void;
}) {
  const [resourceGroupId, setResourceGroupId] = useState("");
  const [ticketSearch, setTicketSearch] = useState("");
  const [onlyOpenTickets, setOnlyOpenTickets] = useState(false);
  const [ticketSort, setTicketSort] = useState<TicketSort>(null);
  const [assignmentOpen, setAssignmentOpen] = useState(false);
  const [pilotOpen, setPilotOpen] = useState(false);
  const [historyAircraftId, setHistoryAircraftId] = useState<string | null>(null);

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
        return `${flightLineGroupLabel(rotation.productCode, group.communicationNumber)} ${rotation.productName} ${rotation.aircraftRegistration ?? ""} ${queue?.resourceGroupName ?? ""} ${queue?.sequence ?? ""}`
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

  function runPrimary(entry: Aircraft, rotation: Rotation | undefined) {
    selectAircraft(entry.id);
    if (entry.operationalState === "REFUELING" || entry.operationalState === "PAUSED") {
      onSetAircraftState(entry.id, "AVAILABLE");
      return;
    }
    if (["INTERRUPTED", "INACTIVE", "TURNAROUND"].includes(entry.operationalState)) {
      onSetAircraftState(entry.id, "AVAILABLE");
      return;
    }
    if (!rotation || rotation.status === "DRAFT") {
      setAssignmentOpen(true);
      return;
    }
    onRunRotation(rotation);
  }

  return (
    <section className="flight-director-v15">
      <PageHeader
        actions={
          <SelectField
            aria-label="Ressourcengruppe filtern"
            className="flight-director-resource-filter"
            label="Ressource"
            onChange={(event) => setResourceGroupId(event.target.value)}
            value={resourceGroupId}
          >
            <option value="">Alle Ressourcen</option>
            {board.resourceGroups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </SelectField>
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
            <span>Flugzeug</span>
            <span>Plätze · Ressource</span>
            <span>Pilot</span>
            <span className="flight-director-pilot-action-head">
              <span className="sr-only">Pilot wechseln</span>
            </span>
            <span className="flight-director-group-head">
              <span>Buchungs-</span>
              <span>gruppen</span>
            </span>
            <span>Zeitverlauf</span>
            <span>Aktionen</span>
          </div>
          {filteredAircraft.map((entry) => {
            const rotation = operationalRotationForAircraft(entry, board.rotations, board.products);
            const pilotChangeAllowed = !rotation || ["DRAFT", "CALLED"].includes(rotation.status);
            const startBlockAllowed = entry.operationalState === "AVAILABLE";
            const unavailableAllowed =
              startBlockAllowed ||
              Boolean(rotation && ["CALLED", "IN_FLIGHT"].includes(rotation.status));
            const primaryPresentation = primaryAircraftActionPresentation(entry, rotation);
            const PrimaryActionIcon = primaryPresentation.Icon;
            return (
              <div className="flight-director-aircraft-row" key={entry.id}>
                <span className="flight-director-aircraft-name">
                  <Plane aria-hidden="true" />
                  <span>
                    <strong>{entry.registration}</strong>
                    <small>{entry.aircraftType}</small>
                  </span>
                </span>
                <span className="flight-director-aircraft-resource">
                  <strong>{entry.passengerSeats}</strong>
                  <small>{entry.resourceGroupName}</small>
                </span>
                <span className="flight-director-pilot-code">
                  <strong>{entry.currentPilotOperationalCode ?? "–"}</strong>
                </span>
                <span className="flight-director-pilot-action">
                  <IconButton
                    disabled={!pilotChangeAllowed}
                    label={`Pilot für ${entry.registration} zuweisen`}
                    onClick={(event) => {
                      event.stopPropagation();
                      openPilot(entry);
                    }}
                    size="compact"
                    type="button"
                  >
                    <PilotChangeIcon aria-hidden="true" />
                  </IconButton>
                </span>
                <span className="flight-director-group-chips">
                  {rotation && rotation.status !== "DRAFT" ? (
                    rotation.bookingGroups.map((group) => (
                      <small key={group.id}>
                        {flightLineGroupLabel(rotation.productCode, group.communicationNumber)}
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
                    disabled={rotation?.status === "COMPLETED"}
                    onClick={(event) => {
                      event.stopPropagation();
                      runPrimary(entry, rotation);
                    }}
                    size="touch"
                    type="button"
                  >
                    <PrimaryActionIcon aria-hidden="true" />
                  </IconButton>
                  <IconButton
                    aria-pressed={entry.operationalState === "REFUELING"}
                    className="flight-line-status-action state-refueling"
                    disabled={!unavailableAllowed}
                    label={`${entry.registration} zum Tanken setzen`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSetAircraftState(entry.id, "REFUELING");
                    }}
                    size="touch"
                    type="button"
                  >
                    <Fuel aria-hidden="true" />
                  </IconButton>
                  <IconButton
                    aria-pressed={entry.operationalState === "PAUSED"}
                    className="flight-line-status-action state-paused"
                    disabled={!startBlockAllowed}
                    label={`${entry.registration} in Pause setzen`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onPauseAircraft(entry.id);
                    }}
                    size="touch"
                    type="button"
                  >
                    <Coffee aria-hidden="true" />
                  </IconButton>
                  <IconButton
                    aria-pressed={["INACTIVE", "INTERRUPTED"].includes(entry.operationalState)}
                    className="flight-line-status-action state-inactive"
                    disabled={!unavailableAllowed}
                    label={`${entry.registration} nicht verfügbar setzen`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSetAircraftState(entry.id, "INACTIVE");
                    }}
                    size="touch"
                    type="button"
                  >
                    <CircleOff aria-hidden="true" />
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
        onConfirm={() => {
          onConfirmAssignment();
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
  return (
    <div className="flight-director-compact-table tickets">
      <div className="flight-director-compact-head">
        {ticketColumns.map((column) => {
          const active = sort?.key === column.key;
          return (
            <span key={column.key}>
              <button
                aria-label={`${column.label} sortieren · ${active ? (sort.direction === "ascending" ? "aufsteigend" : "absteigend") : "Standardsortierung"}`}
                aria-pressed={active}
                onClick={() => onSort(column.key)}
                type="button"
              >
                <span>{column.label}</span>
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
            <strong>{flightLineGroupLabel(rotation.productCode, group.communicationNumber)}</strong>
            <span>{queue ? `${queue.resourceGroupName} · ${queue.sequence}` : "–"}</span>
            <span>{group.ticketCount}</span>
            <span>{rotationStateLabels[rotation.status]}</span>
            <span>{rotation.aircraftRegistration ?? "Noch offen"}</span>
            <span>{rotation.productName}</span>
            <span>
              {rotation.timeline.actual.departureAt
                ? "–"
                : `${rotation.predictedLowerMinutes}–${rotation.predictedUpperMinutes} Min.`}
            </span>
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
