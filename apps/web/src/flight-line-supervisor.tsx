import type { OperationBoard } from "@rundflug/contracts";
import { rotationStateLabels } from "@rundflug/domain";
import {
  Bell,
  CheckCircle2,
  CircleOff,
  Coffee,
  Fuel,
  History,
  Plane,
  UserRoundX,
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
  CompactHistory,
  type FlightLineFleetState,
  FlightProgress,
  flightLineGroupLabel,
  formatFlightLineTime,
  operationalRotationForAircraft,
  PilotAssignmentDialogs,
  PilotChangeIcon,
  PilotIcon,
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

function queuedSegmentPresentCount(group: QueueGroup): number {
  return group.nextSegmentPresentCount ?? group.presentCount;
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
    return board.rotations
      .flatMap((rotation) => rotation.bookingGroups.map((group) => ({ group, rotation })))
      .filter(({ rotation }) => !onlyOpenTickets || rotation.status !== "COMPLETED")
      .filter(({ group, rotation }) => {
        if (!query) return true;
        return `${flightLineGroupLabel(rotation.productCode, group.communicationNumber)} ${rotation.productName} ${rotation.aircraftRegistration ?? ""}`
          .toLocaleLowerCase("de-DE")
          .includes(query);
      })
      .sort(
        (left, right) =>
          right.group.soldAt.localeCompare(left.group.soldAt) ||
          right.group.id.localeCompare(left.group.id),
      )
      .slice(0, 30);
  }, [board.rotations, onlyOpenTickets, ticketSearch]);

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
            <span>Buchungsgruppen</span>
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
                  <PilotIcon aria-hidden="true" />
                  <strong>{entry.currentPilotOperationalCode ?? "–"}</strong>
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
          <CompactTickets rows={ticketRows} timeZone={board.event.timeZone} />
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

      <ModalDialog
        description={
          selectedAircraft
            ? `${selectedAircraft.registration} · ${selectedAircraft.passengerSeats} Plätze · Gruppen bleiben vollständig zusammen.`
            : undefined
        }
        footer={
          <>
            <Button onClick={() => setAssignmentOpen(false)} type="button">
              Abbrechen
            </Button>
            <Button
              disabled={assignmentBlocked}
              onClick={() => {
                onConfirmAssignment();
                setAssignmentOpen(false);
              }}
              type="button"
              variant="primary"
            >
              <CheckCircle2 aria-hidden="true" /> Belegung bestätigen & Boarding starten
            </Button>
          </>
        }
        onClose={() => setAssignmentOpen(false)}
        open={assignmentOpen}
        size="wide"
        title="Buchungsgruppen zuweisen"
      >
        <div className="flight-director-assignment-dialog">
          <section className="flight-director-queue">
            {compatibleGroups.length > 0 ? (
              compatibleGroups.map((group) => (
                <QueueGroupRow
                  capacity={selectedAircraft?.passengerSeats ?? 0}
                  group={group}
                  key={group.id}
                  onAttendance={onGroupAttendance}
                  onMissing={onGroupMissing}
                  onRecall={onGroupRecall}
                  onToggle={onToggleGroup}
                  selected={selectedQueueGroupIds.includes(group.id)}
                  selectedSeats={selectedSeats}
                />
              ))
            ) : (
              <p>Keine passende Buchungsgruppe in der Warteschlange.</p>
            )}
          </section>
          <aside className="flight-director-selection">
            <div>
              <span>Ausgewählt</span>
              {selectedGroups.length > 0 ? (
                selectedGroups.map((group) => (
                  <strong key={group.id}>
                    {flightLineGroupLabel(group.productCode, group.communicationNumber)}
                    <small>
                      {queuedSegmentTicketCount(group)}
                      {group.segmentCount && group.segmentCount > 1
                        ? ` von ${group.ticketCount} · Teil ${group.segmentIndex ?? 1}/${group.segmentCount}`
                        : ""}{" "}
                      Pers.
                    </small>
                  </strong>
                ))
              ) : (
                <small>Noch keine Gruppe gewählt</small>
              )}
            </div>
            <div className="flight-director-selection-total">
              <span>Gesamt</span>
              <strong>
                {selectedSeats} von {selectedAircraft?.passengerSeats ?? 0} Plätzen
              </strong>
            </div>
            {capacityExceeded ? (
              <p className="flight-director-dialog-warning">
                Die Auswahl überschreitet die Kapazität.
              </p>
            ) : null}
            {!selectedAircraft?.currentPilotId ? (
              <p className="flight-director-dialog-warning">
                Vor Belegung bitte über „Pilot zuweisen“ einen Pilotencode am Flugzeug hinterlegen.
              </p>
            ) : (
              <p className="flight-director-dialog-pilot">
                <PilotIcon aria-hidden="true" /> Pilot{" "}
                {selectedAircraft.currentPilotOperationalCode}
              </p>
            )}
          </aside>
        </div>
      </ModalDialog>

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

function QueueGroupRow({
  group,
  selected,
  selectedSeats,
  capacity,
  onToggle,
  onAttendance,
  onMissing,
  onRecall,
}: {
  group: QueueGroup;
  selected: boolean;
  selectedSeats: number;
  capacity: number;
  onToggle: (ticketGroupId: string, selected: boolean) => void;
  onAttendance: (ticketGroupId: string, checkedIn: boolean) => void;
  onMissing: (ticketGroupId: string) => void;
  onRecall: (ticketGroupId: string) => void;
}) {
  const segmentTicketCount = queuedSegmentTicketCount(group);
  const segmentPresentCount = queuedSegmentPresentCount(group);
  const exceedsCapacity = !selected && selectedSeats + segmentTicketCount > capacity;
  return (
    <div className={selected ? "flight-director-queue-row selected" : "flight-director-queue-row"}>
      <label>
        <input
          checked={selected}
          disabled={group.status === "MISSING" || exceedsCapacity}
          onChange={(event) => onToggle(group.id, event.target.checked)}
          type="checkbox"
        />
        <strong>{flightLineGroupLabel(group.productCode, group.communicationNumber)}</strong>
      </label>
      <span>
        {group.segmentCount && group.segmentCount > 1 ? (
          <>
            {segmentTicketCount} von {group.ticketCount} Personen · Teil {group.segmentIndex ?? 1}/
            {group.segmentCount}
          </>
        ) : (
          <>
            {segmentTicketCount} Person{segmentTicketCount === 1 ? "" : "en"}
          </>
        )}
      </span>
      <span>
        {segmentPresentCount}/{segmentTicketCount} anwesend
      </span>
      <div>
        <Button
          onClick={() => onAttendance(group.id, group.status !== "PRESENT")}
          size="compact"
          variant={group.status === "PRESENT" ? "primary" : "secondary"}
        >
          <CheckCircle2 aria-hidden="true" /> Anwesend
        </Button>
        <Button onClick={() => onMissing(group.id)} size="compact">
          <UserRoundX aria-hidden="true" /> Nicht da
        </Button>
        <Button onClick={() => onRecall(group.id)} size="compact">
          <Bell aria-hidden="true" /> Nachrufen
        </Button>
      </div>
    </div>
  );
}

function CompactTickets({
  rows,
  timeZone,
}: {
  rows: Array<{ group: Rotation["bookingGroups"][number]; rotation: Rotation }>;
  timeZone: string;
}) {
  return (
    <div className="flight-director-compact-table tickets">
      <div className="flight-director-compact-head">
        <span>Ticketgruppe</span>
        <span>Personen</span>
        <span>Umlaufstatus</span>
        <span>Flugzeug</span>
        <span>Produkt</span>
        <span>Zeitfenster</span>
        <span>Boarding</span>
        <span>Off-Block</span>
        <span>On-Block</span>
        <span>Abschluss</span>
      </div>
      {rows.length > 0 ? (
        rows.map(({ group, rotation }) => (
          <div key={`${rotation.id}-${group.id}`}>
            <strong>{flightLineGroupLabel(rotation.productCode, group.communicationNumber)}</strong>
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
