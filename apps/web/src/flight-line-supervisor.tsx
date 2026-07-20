import type { OperationBoard } from "@rundflug/contracts";
import { aircraftOperationalStateLabels, rotationStateLabels } from "@rundflug/domain";
import {
  Bell,
  CheckCircle2,
  CircleOff,
  Clock3,
  Coffee,
  Fuel,
  Plane,
  UserRoundX,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  Button,
  ConfirmationDialog,
  IconButton,
  ModalDialog,
  PageHeader,
  Panel,
  SearchField,
  SelectField,
  StatusPill,
  Tabs,
} from "./design-system/components";

type Aircraft = OperationBoard["aircraft"][number];
type Rotation = OperationBoard["rotations"][number];
type QueueGroup = OperationBoard["queueGroups"][number];
type FleetState = "AVAILABLE" | "REFUELING" | "PAUSED" | "INACTIVE";

function PilotCapIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24">
      <path d="M4 14.5c1.8-4.9 4.6-7.4 8-7.4s6.2 2.5 8 7.4" />
      <path d="M3.2 15c2.5 1.2 5.4 1.8 8.8 1.8s6.3-.6 8.8-1.8" />
      <path d="M9.2 7.9 12 4.8l2.8 3.1M12 5v3" />
    </svg>
  );
}

function rotationForAircraft(
  aircraft: Aircraft,
  rotations: Rotation[],
  products: OperationBoard["products"],
): Rotation | undefined {
  const assigned = rotations.find(
    (rotation) => rotation.aircraftId === aircraft.id && rotation.status !== "COMPLETED",
  );
  if (assigned) return assigned;
  return rotations.find((rotation) => {
    if (rotation.status !== "DRAFT") return false;
    const product = products.find((entry) => entry.code === rotation.productCode);
    return (
      product?.resourceGroupId === aircraft.resourceGroupId &&
      rotation.ticketCount <= aircraft.passengerSeats
    );
  });
}

function visibleAircraftState(aircraft: Aircraft, rotation: Rotation | undefined) {
  if (aircraft.operationalState !== "AVAILABLE") return aircraft.operationalState;
  if (rotation?.status === "CALLED") return "BOARDING";
  if (rotation?.status === "IN_FLIGHT") return "IN_FLIGHT";
  if (rotation?.status === "LANDED") return "LANDED";
  return "AVAILABLE";
}

function statusTone(status: string): "success" | "warning" | "danger" | "info" | "neutral" {
  if (status === "AVAILABLE") return "success";
  if (["BOARDING", "PAUSED"].includes(status)) return "warning";
  if (["INTERRUPTED", "INACTIVE"].includes(status)) return "danger";
  if (["IN_FLIGHT", "LANDED", "REFUELING"].includes(status)) return "info";
  return "neutral";
}

function formatTime(value: string | null | undefined, timeZone: string): string {
  if (!value) return "–";
  return new Intl.DateTimeFormat("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(new Date(value));
}

function groupLabel(productCode: string, communicationNumber: number): string {
  return `${productCode}-${String(communicationNumber).padStart(3, "0")}`;
}

function rotationGroupLabels(rotation: Rotation): string {
  const labels = rotation.bookingGroups.map((group) =>
    groupLabel(rotation.productCode, group.communicationNumber),
  );
  return labels.length > 0 ? labels.join(", ") : rotation.communicationLabel;
}

function timelineSummary(rotation: Rotation | undefined, timeZone: string): string {
  if (!rotation || rotation.status === "DRAFT") return "Bereit für Belegung";
  const timeline = rotation.timeline.actual;
  if (rotation.status === "CALLED") {
    return `Boarding ${formatTime(timeline.boardingAt, timeZone)}`;
  }
  if (rotation.status === "IN_FLIGHT") {
    return `Offblock ${formatTime(timeline.departureAt, timeZone)}`;
  }
  if (rotation.status === "LANDED") {
    return `Onblock ${formatTime(timeline.landingAt, timeZone)}`;
  }
  return `Abschluss ${formatTime(timeline.completionAt, timeZone)}`;
}

function FlightProgress({
  aircraft,
  rotation,
  timeZone,
}: {
  aircraft: Aircraft;
  rotation: Rotation | undefined;
  timeZone: string;
}) {
  const status = visibleAircraftState(aircraft, rotation);
  const currentIndex = {
    AVAILABLE: 0,
    BOARDING: 1,
    IN_FLIGHT: 2,
    LANDED: 3,
    TURNAROUND: 4,
    REFUELING: 3,
    PAUSED: 1,
    INTERRUPTED: 1,
    INACTIVE: 1,
  }[status];
  return (
    <span
      aria-label={timelineSummary(rotation, timeZone)}
      className={`flight-director-progress state-${status.toLocaleLowerCase("en-US")}`}
      role="img"
    >
      {["bereit", "boarding", "offblock", "onblock", "abschluss"].map((step, index) => (
        <span
          className={index === currentIndex ? "current" : index < currentIndex ? "done" : ""}
          key={step}
        />
      ))}
    </span>
  );
}

function nextStep(aircraft: Aircraft, rotation: Rotation | undefined): string {
  if (aircraft.operationalState === "REFUELING") return "Tanken abschließen";
  if (aircraft.operationalState === "PAUSED") return "Pause beenden";
  if (["INTERRUPTED", "INACTIVE"].includes(aircraft.operationalState)) {
    return "Verfügbar setzen";
  }
  if (!rotation || rotation.status === "DRAFT") return "Bereit für Belegung";
  if (rotation.status === "CALLED") return "Offblock markieren";
  if (rotation.status === "IN_FLIGHT") return "Onblock markieren";
  if (rotation.status === "LANDED") return "Umlauf abschließen";
  return "Bereit";
}

function primaryLabel(aircraft: Aircraft, rotation: Rotation | undefined): string {
  if (aircraft.operationalState === "REFUELING") return "Tanken abschließen";
  if (aircraft.operationalState === "PAUSED") return "Pause beenden";
  if (["INTERRUPTED", "INACTIVE", "TURNAROUND"].includes(aircraft.operationalState)) {
    return "Verfügbar setzen";
  }
  if (!rotation || rotation.status === "DRAFT") return "Belegung zuweisen";
  if (rotation.status === "CALLED") return "Offblock";
  if (rotation.status === "IN_FLIGHT") return "Onblock";
  if (rotation.status === "LANDED") return "Umlauf abschließen";
  return "Keine Aktion";
}

export function FlightLineSupervisorConsole({
  board,
  aircraft,
  selectedAircraft,
  message,
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
  message: string | null;
  selectedQueueGroupIds: string[];
  onAssignPilot: (aircraftId: string, pilotId: string, reassign: boolean) => Promise<void>;
  onConfirmAssignment: () => void;
  onRunRotation: (rotation: Rotation) => void;
  onSetAircraftState: (aircraftId: string, state: FleetState) => void;
  onPauseAircraft: (aircraftId: string) => void;
  onSelectAircraft: (aircraftId: string) => void;
  onToggleGroup: (ticketGroupId: string, selected: boolean) => void;
  onGroupAttendance: (ticketGroupId: string, checkedIn: boolean) => void;
  onGroupMissing: (ticketGroupId: string) => void;
  onGroupRecall: (ticketGroupId: string) => void;
}) {
  const [resourceGroupId, setResourceGroupId] = useState("");
  const [ticketSearch, setTicketSearch] = useState("");
  const [bottomTab, setBottomTab] = useState<"current" | "history">("current");
  const [assignmentOpen, setAssignmentOpen] = useState(false);
  const [pilotOpen, setPilotOpen] = useState(false);
  const [pilotId, setPilotId] = useState("");
  const [reassign, setReassign] = useState<{
    pilotId: string;
    code: string;
    registration: string;
  } | null>(null);

  const filteredAircraft = useMemo(
    () => aircraft.filter((entry) => !resourceGroupId || entry.resourceGroupId === resourceGroupId),
    [aircraft, resourceGroupId],
  );
  const currentRotation = board.rotations.find(
    (rotation) => rotation.aircraftId === selectedAircraft?.id && rotation.status !== "COMPLETED",
  );
  const compatibleGroups = board.queueGroups.filter(
    (group) =>
      group.resourceGroupId === selectedAircraft?.resourceGroupId &&
      ["QUEUED", "PRESENT", "MISSING"].includes(group.status),
  );
  const selectedGroups = compatibleGroups.filter((group) =>
    selectedQueueGroupIds.includes(group.id),
  );
  const selectedSeats = selectedGroups.reduce((total, group) => total + group.ticketCount, 0);
  const capacityExceeded = selectedSeats > (selectedAircraft?.passengerSeats ?? 0);
  const assignmentBlocked =
    !selectedAircraft?.currentPilotId ||
    selectedSeats === 0 ||
    capacityExceeded ||
    board.event.emergencyMode ||
    board.event.status !== "ACTIVE" ||
    board.event.operationalInterrupted;
  const history = board.rotations
    .filter(
      (rotation) => rotation.aircraftId === selectedAircraft?.id && rotation.status === "COMPLETED",
    )
    .slice(-20)
    .reverse();
  const ticketRows = board.rotations
    .flatMap((rotation) => rotation.bookingGroups.map((group) => ({ group, rotation })))
    .filter(({ group, rotation }) => {
      const query = ticketSearch.trim().toLocaleLowerCase("de-DE");
      if (!query) return true;
      return `${groupLabel(rotation.productCode, group.communicationNumber)} ${rotation.productName} ${rotation.aircraftRegistration ?? ""}`
        .toLocaleLowerCase("de-DE")
        .includes(query);
    })
    .slice(0, 30);

  function selectAircraft(aircraftId: string) {
    onSelectAircraft(aircraftId);
  }

  function openPilot(entry: Aircraft) {
    selectAircraft(entry.id);
    setPilotId(entry.currentPilotId ?? "");
    setPilotOpen(true);
  }

  async function submitPilotAssignment() {
    if (!selectedAircraft || !pilotId) return;
    const pilot = board.pilots.find((entry) => entry.id === pilotId);
    if (!pilot) return;
    const otherAircraft = board.aircraft.find(
      (entry) => entry.id !== selectedAircraft.id && entry.currentPilotId === pilotId,
    );
    if (otherAircraft) {
      setReassign({
        pilotId,
        code: pilot.operationalCode,
        registration: otherAircraft.registration,
      });
      return;
    }
    await onAssignPilot(selectedAircraft.id, pilotId, false);
    setPilotOpen(false);
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

      {message ? <p className="action-message">{message}</p> : null}

      <Panel className="flight-director-aircraft" padding="none">
        <section className="flight-director-aircraft-table" aria-label="Flugzeuge">
          <div className="flight-director-aircraft-head">
            <span>Flugzeug</span>
            <span>Plätze · Ressource</span>
            <span>Status</span>
            <span>Pilot</span>
            <span>Buchungsgruppen</span>
            <span>Zeitverlauf</span>
            <span>Nächster Schritt</span>
            <span>Aktionen</span>
          </div>
          {filteredAircraft.map((entry) => {
            const rotation = rotationForAircraft(entry, board.rotations, board.products);
            const status = visibleAircraftState(entry, rotation);
            const isSelected = entry.id === selectedAircraft?.id;
            const pilotChangeAllowed = !rotation || ["DRAFT", "CALLED"].includes(rotation.status);
            const startBlockAllowed = entry.operationalState === "AVAILABLE";
            return (
              <div
                className={
                  isSelected
                    ? "flight-director-aircraft-row selected"
                    : "flight-director-aircraft-row"
                }
                key={entry.id}
              >
                <button
                  className="flight-director-aircraft-name"
                  onClick={() => selectAircraft(entry.id)}
                  type="button"
                >
                  <Plane aria-hidden="true" />
                  <span>
                    <strong>{entry.registration}</strong>
                    <small>{entry.aircraftType}</small>
                  </span>
                </button>
                <span className="flight-director-aircraft-resource">
                  <strong>{entry.passengerSeats}</strong>
                  <small>{entry.resourceGroupName}</small>
                </span>
                <span className="flight-director-aircraft-status">
                  <StatusPill tone={statusTone(status)}>
                    {aircraftOperationalStateLabels[status]}
                  </StatusPill>
                  <small>
                    seit {formatTime(entry.operationalStateChangedAt, board.event.timeZone)}
                  </small>
                </span>
                <span className="flight-director-pilot-code">
                  <strong>{entry.currentPilotOperationalCode ?? "–"}</strong>
                </span>
                <span className="flight-director-group-chips">
                  {rotation && rotation.status !== "DRAFT" ? (
                    rotation.bookingGroups.map((group) => (
                      <small key={group.id}>
                        {groupLabel(rotation.productCode, group.communicationNumber)}
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
                  />
                </span>
                <span className="flight-director-next-step">{nextStep(entry, rotation)}</span>
                <span className="flight-director-row-actions">
                  <Button
                    disabled={rotation?.status === "COMPLETED"}
                    onClick={(event) => {
                      event.stopPropagation();
                      runPrimary(entry, rotation);
                    }}
                    size="compact"
                    variant="primary"
                  >
                    {primaryLabel(entry, rotation)}
                  </Button>
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
                    <PilotCapIcon />
                  </IconButton>
                  <IconButton
                    disabled={!startBlockAllowed}
                    label={`${entry.registration} zum Tanken setzen`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSetAircraftState(entry.id, "REFUELING");
                    }}
                    size="compact"
                    type="button"
                  >
                    <Fuel aria-hidden="true" />
                  </IconButton>
                  <IconButton
                    disabled={!startBlockAllowed}
                    label={`${entry.registration} in Pause setzen`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onPauseAircraft(entry.id);
                    }}
                    size="compact"
                    type="button"
                  >
                    <Coffee aria-hidden="true" />
                  </IconButton>
                  <IconButton
                    disabled={!startBlockAllowed}
                    label={`${entry.registration} nicht verfügbar setzen`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSetAircraftState(entry.id, "INACTIVE");
                    }}
                    size="compact"
                    type="button"
                  >
                    <CircleOff aria-hidden="true" />
                  </IconButton>
                </span>
              </div>
            );
          })}
        </section>
      </Panel>

      <div className="flight-director-bottom-grid">
        <Panel className="flight-director-bottom" padding="none">
          <Tabs
            items={[
              { value: "current", label: "Aktueller Umlauf" },
              { value: "history", label: "Historie" },
            ]}
            label="Flugzeuginformationen"
            onChange={setBottomTab}
            value={bottomTab}
          />
          {bottomTab === "current" ? (
            <CompactCurrentRotation rotation={currentRotation} timeZone={board.event.timeZone} />
          ) : (
            <CompactHistory history={history} timeZone={board.event.timeZone} />
          )}
        </Panel>
        <Panel className="flight-director-ticket-overview" padding="none">
          <header>
            <h2>
              Verkaufte Tickets <small>alle Flugzeuge</small>
            </h2>
            <SearchField
              label="Verkaufte Tickets suchen"
              onChange={(event) => setTicketSearch(event.target.value)}
              placeholder="Nach Ticket-ID oder Produkt suchen"
              value={ticketSearch}
            />
          </header>
          <CompactTickets rows={ticketRows} />
        </Panel>
      </div>

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
                    {groupLabel(group.productCode, group.communicationNumber)}
                    <small>{group.ticketCount} Pers.</small>
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
                <PilotCapIcon /> Pilot {selectedAircraft.currentPilotOperationalCode}
              </p>
            )}
          </aside>
        </div>
      </ModalDialog>

      <ModalDialog
        description="Zuweisung oder Änderung nur bis Offblock möglich. Es werden ausschließlich anonyme Codes angezeigt."
        footer={
          <>
            <Button onClick={() => setPilotOpen(false)} type="button">
              Abbrechen
            </Button>
            <Button
              disabled={!pilotId}
              onClick={() => void submitPilotAssignment()}
              type="button"
              variant="primary"
            >
              {pilotId
                ? `Pilot ${board.pilots.find((entry) => entry.id === pilotId)?.operationalCode ?? ""} zuweisen`
                : "Pilot zuweisen"}
            </Button>
          </>
        }
        onClose={() => setPilotOpen(false)}
        open={pilotOpen}
        title={
          <span className="flight-director-dialog-title">
            <PilotCapIcon /> Pilot zuweisen
            {selectedAircraft ? ` · ${selectedAircraft.registration}` : ""}
          </span>
        }
      >
        <p className="flight-director-pilot-current">
          Aktuell:{" "}
          <strong>
            {selectedAircraft?.currentPilotOperationalCode ?? "Kein Pilot zugewiesen"}
          </strong>
        </p>
        <div className="flight-director-pilot-options" role="radiogroup" aria-label="Pilotencode">
          {board.pilots.map((pilot) => {
            const assignedAircraft = board.aircraft.find(
              (entry) => entry.currentPilotId === pilot.id && entry.id !== selectedAircraft?.id,
            );
            const blockedByRotation =
              pilot.currentRotationId !== null && pilot.currentRotationId !== currentRotation?.id;
            const disabled = !pilot.active || pilot.paused || blockedByRotation;
            return (
              <label className={disabled ? "disabled" : ""} key={pilot.id}>
                <input
                  checked={pilotId === pilot.id}
                  disabled={disabled}
                  name="pilot-code"
                  onChange={() => setPilotId(pilot.id)}
                  type="radio"
                />
                <PilotCapIcon />
                <span>
                  <strong>{pilot.operationalCode}</strong>
                  <small>
                    {!pilot.active
                      ? "Inaktiv"
                      : pilot.paused
                        ? "Pausiert"
                        : blockedByRotation
                          ? "Im aktiven Umlauf"
                          : assignedAircraft
                            ? `Zugewiesen: ${assignedAircraft.registration}`
                            : "Verfügbar"}
                  </small>
                </span>
              </label>
            );
          })}
        </div>
      </ModalDialog>

      <ConfirmationDialog
        body={
          reassign
            ? `${reassign.code} ist ${reassign.registration} zugewiesen. Zu ${selectedAircraft?.registration ?? "diesem Flugzeug"} wechseln? Der andere aktive Umlauf wird nicht verändert.`
            : ""
        }
        confirmLabel="Pilot wechseln"
        onCancel={() => setReassign(null)}
        onConfirm={() => {
          if (!reassign || !selectedAircraft) return;
          void onAssignPilot(selectedAircraft.id, reassign.pilotId, true).then(() => {
            setReassign(null);
            setPilotOpen(false);
          });
        }}
        open={reassign !== null}
        title="Pilotzuweisung wechseln?"
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
  const exceedsCapacity = !selected && selectedSeats + group.ticketCount > capacity;
  return (
    <div className={selected ? "flight-director-queue-row selected" : "flight-director-queue-row"}>
      <label>
        <input
          checked={selected}
          disabled={group.status === "MISSING" || exceedsCapacity}
          onChange={(event) => onToggle(group.id, event.target.checked)}
          type="checkbox"
        />
        <strong>{groupLabel(group.productCode, group.communicationNumber)}</strong>
      </label>
      <span>
        {group.ticketCount} Person{group.ticketCount === 1 ? "" : "en"}
      </span>
      <span>
        {group.presentCount}/{group.ticketCount} anwesend
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

function CompactCurrentRotation({
  rotation,
  timeZone,
}: {
  rotation: Rotation | undefined;
  timeZone: string;
}) {
  if (!rotation) {
    return (
      <div className="flight-director-empty-detail">
        <Plane aria-hidden="true" />
        <span>Für das ausgewählte Flugzeug ist noch kein Umlauf belegt.</span>
      </div>
    );
  }
  return (
    <div className="flight-director-current-content">
      <dl className="flight-director-current-rotation">
        <div>
          <dt>Status</dt>
          <dd>{rotationStateLabels[rotation.status]}</dd>
        </div>
        <div>
          <dt>Buchungsgruppen</dt>
          <dd>{rotationGroupLabels(rotation)}</dd>
        </div>
        <div>
          <dt>Pilot</dt>
          <dd>{rotation.pilotOperationalCode ?? "–"}</dd>
        </div>
      </dl>
      <section className="flight-director-current-timeline" aria-label="Umlaufzeitlinie">
        {[
          ["Boarding", rotation.timeline.actual.boardingAt],
          ["Offblock", rotation.timeline.actual.departureAt],
          ["Onblock", rotation.timeline.actual.landingAt],
          ["Abschluss / Folgestatus", rotation.timeline.actual.completionAt],
        ].map(([label, value]) => (
          <span className={value ? "reached" : ""} key={label}>
            <strong>{label}</strong>
            <i aria-hidden="true" />
            <small>{formatTime(value, timeZone)}</small>
          </span>
        ))}
      </section>
    </div>
  );
}

function CompactHistory({ history, timeZone }: { history: Rotation[]; timeZone: string }) {
  return (
    <div className="flight-director-compact-table history">
      <div className="flight-director-compact-head">
        <span>Buchungsgruppen</span>
        <span>Pilot</span>
        <span>Boarding</span>
        <span>Offblock</span>
        <span>Onblock</span>
        <span>Abschluss</span>
      </div>
      {history.length > 0 ? (
        history.map((rotation) => (
          <div key={rotation.id}>
            <strong>{rotationGroupLabels(rotation)}</strong>
            <span>{rotation.pilotOperationalCode ?? "–"}</span>
            <span>{formatTime(rotation.timeline.actual.boardingAt, timeZone)}</span>
            <span>{formatTime(rotation.timeline.actual.departureAt, timeZone)}</span>
            <span>{formatTime(rotation.timeline.actual.landingAt, timeZone)}</span>
            <span>{formatTime(rotation.timeline.actual.completionAt, timeZone)}</span>
          </div>
        ))
      ) : (
        <p>
          <Clock3 aria-hidden="true" /> Noch keine abgeschlossenen Flüge.
        </p>
      )}
    </div>
  );
}

function CompactTickets({
  rows,
}: {
  rows: Array<{ group: Rotation["bookingGroups"][number]; rotation: Rotation }>;
}) {
  return (
    <div className="flight-director-compact-table tickets">
      <div className="flight-director-compact-head">
        <span>Ticketgruppe</span>
        <span>Personen</span>
        <span>Status</span>
        <span>Flugzeug</span>
        <span>Produkt</span>
      </div>
      {rows.length > 0 ? (
        rows.map(({ group, rotation }) => (
          <div key={`${rotation.id}-${group.id}`}>
            <strong>{groupLabel(rotation.productCode, group.communicationNumber)}</strong>
            <span>{group.ticketCount}</span>
            <span>{rotationStateLabels[rotation.status]}</span>
            <span>{rotation.aircraftRegistration ?? "Noch offen"}</span>
            <span>{rotation.productName}</span>
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
