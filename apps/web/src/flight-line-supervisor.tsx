import type { OperationBoard } from "@rundflug/contracts";
import {
  Bell,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Fuel,
  Plane,
  UserRoundX,
  Users,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  Button,
  IconButton,
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

type SupervisorAction = {
  label: string;
  disabled: boolean;
  run: () => void;
} | null;

const statusLabels = {
  AVAILABLE: "Verfügbar",
  BOARDING: "Boarding",
  IN_FLIGHT: "Off-Block",
  LANDED: "On-Block",
  REFUELING: "Tanken",
  PAUSED: "Pause",
  INTERRUPTED: "Nicht verfügbar",
  INACTIVE: "Nicht verfügbar",
} as const;

function suggestedRotationFor(
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

function statusFor(aircraft: Aircraft, rotation: Rotation | undefined) {
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

function rotationTime(rotation: Rotation | undefined, timeZone: string): string {
  if (!rotation) return "Bereit für Belegung";
  const timeline = rotation.timeline.actual;
  if (rotation.status === "CALLED")
    return `Boarding seit ${formatTime(timeline.boardingAt, timeZone)}`;
  if (rotation.status === "IN_FLIGHT") {
    return `Off-Block seit ${formatTime(timeline.departureAt, timeZone)}`;
  }
  if (rotation.status === "LANDED")
    return `On-Block seit ${formatTime(timeline.landingAt, timeZone)}`;
  return `${rotation.predictedLowerMinutes}–${rotation.predictedUpperMinutes} Min.`;
}

function nextStep(aircraft: Aircraft, rotation: Rotation | undefined): string {
  if (aircraft.operationalState === "REFUELING") return "Auftanken";
  if (aircraft.operationalState === "PAUSED") return "Rückkehr prüfen";
  if (["INTERRUPTED", "INACTIVE"].includes(aircraft.operationalState)) return "Status prüfen";
  if (!rotation || rotation.status === "DRAFT") return "Buchungsgruppen zuweisen";
  if (rotation.status === "CALLED") return "Boarding abschließen";
  if (rotation.status === "IN_FLIGHT") return "On-Block markieren";
  if (rotation.status === "LANDED") return "Turnaround abschließen";
  return "Bereit";
}

function actionLabel(rotation: Rotation | undefined): string {
  if (!rotation || rotation.status === "DRAFT") return "Belegung zuweisen";
  if (rotation.status === "CALLED") return "Off-Block";
  if (rotation.status === "IN_FLIGHT") return "On-Block";
  if (rotation.status === "LANDED") return "Umlauf abschließen";
  return "Details";
}

export function FlightLineSupervisorConsole({
  board,
  aircraft,
  selectedAircraft,
  selectedRotation,
  action,
  message,
  nextPilotId,
  selectedQueueGroupIds,
  onPilotChange,
  onSelectAircraft,
  onOpenDetails,
  onOpenDisposition,
  onPause,
  onRefuel,
  onUnavailable,
  onAvailable,
  onToggleGroup,
  onGroupAttendance,
  onGroupMissing,
  onGroupRecall,
}: {
  board: OperationBoard;
  aircraft: Aircraft[];
  selectedAircraft: Aircraft | undefined;
  selectedRotation: Rotation | undefined;
  aircraftRotations: Rotation[];
  action: SupervisorAction;
  message: string | null;
  nextPilotId: string;
  selectedQueueGroupIds: string[];
  onPilotChange: (pilotId: string) => void;
  onSelectAircraft: (aircraftId: string) => void;
  onSelectRotation: (rotationId: string) => void;
  onOpenDetails: () => void;
  onOpenDisposition: () => void;
  onPause: () => void;
  onRefuel: () => void;
  onUnavailable: () => void;
  onAvailable: () => void;
  onDeferRotation: (rotation: Rotation) => void;
  onReleaseAssist: (aircraftId: string) => void;
  onToggleGroup: (ticketGroupId: string, selected: boolean) => void;
  onGroupAttendance: (ticketGroupId: string, checkedIn: boolean) => void;
  onGroupMissing: (ticketGroupId: string) => void;
  onGroupRecall: (ticketGroupId: string) => void;
}) {
  const [resourceGroupId, setResourceGroupId] = useState("");
  const [ticketSearch, setTicketSearch] = useState("");
  const [bottomTab, setBottomTab] = useState<"current" | "history">("current");
  const filteredAircraft = useMemo(() => {
    return aircraft.filter((entry) => {
      return !resourceGroupId || entry.resourceGroupId === resourceGroupId;
    });
  }, [aircraft, resourceGroupId]);

  const compatibleGroups = board.queueGroups.filter(
    (group) =>
      group.resourceGroupId === selectedAircraft?.resourceGroupId &&
      ["QUEUED", "PRESENT", "MISSING"].includes(group.status),
  );
  const selectedGroups = compatibleGroups.filter((group) =>
    selectedQueueGroupIds.includes(group.id),
  );
  const selectedSeats = selectedGroups.reduce((total, group) => total + group.ticketCount, 0);
  const history = board.rotations
    .filter(
      (rotation) => rotation.aircraftId === selectedAircraft?.id && rotation.status === "COMPLETED",
    )
    .slice(-10)
    .reverse();
  const ticketRows = board.rotations
    .filter((rotation) => rotation.status !== "COMPLETED")
    .flatMap((rotation) => rotation.bookingGroups.map((group) => ({ group, rotation })))
    .filter(({ group, rotation }) => {
      const query = ticketSearch.trim().toLocaleLowerCase("de-DE");
      if (!query) return true;
      return `${rotation.productCode}-${group.communicationNumber} ${rotation.productName} ${rotation.aircraftRegistration ?? ""}`
        .toLocaleLowerCase("de-DE")
        .includes(query);
    })
    .slice(0, 12);

  function chooseAircraft(aircraftId: string) {
    onSelectAircraft(aircraftId);
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
        <div className="flight-director-aircraft-head">
          <span />
          <span>Kennzeichen</span>
          <span>Plätze</span>
          <span>Ressource</span>
          <span>Status</span>
          <span>Buchungsgruppen</span>
          <span>Zeitplan</span>
          <span>Nächster Schritt</span>
          <span>Aktionen</span>
        </div>
        {filteredAircraft.map((entry) => {
          const rotation = suggestedRotationFor(entry, board.rotations, board.products);
          const expanded = entry.id === selectedAircraft?.id;
          const status = statusFor(entry, rotation);
          const groups = rotation?.bookingGroups ?? [];
          const productCode = rotation?.productCode ?? "";
          return (
            <article className={expanded ? "expanded" : ""} key={entry.id}>
              <div className="flight-director-aircraft-row">
                <IconButton
                  label={`${entry.registration} ${expanded ? "zuklappen" : "aufklappen"}`}
                  onClick={() => chooseAircraft(entry.id)}
                  size="compact"
                >
                  <ChevronDown aria-hidden="true" className={expanded ? "expanded" : ""} />
                </IconButton>
                <button
                  className="flight-director-aircraft-name"
                  onClick={() => chooseAircraft(entry.id)}
                  type="button"
                >
                  <strong>{entry.registration}</strong>
                  <small>{entry.aircraftType}</small>
                </button>
                <span>{entry.passengerSeats}</span>
                <span>{entry.resourceGroupName || "–"}</span>
                <StatusPill tone={statusTone(status)}>
                  {statusLabels[status as keyof typeof statusLabels] ?? status}
                </StatusPill>
                <span className="flight-director-group-chips">
                  {groups.length > 0
                    ? groups.map((group) => (
                        <small key={group.id}>
                          {productCode}-{String(group.communicationNumber).padStart(3, "0")} (
                          {group.ticketCount})
                        </small>
                      ))
                    : "–"}
                </span>
                <span>{rotationTime(rotation, board.event.timeZone)}</span>
                <span>{nextStep(entry, rotation)}</span>
                <span className="flight-director-row-actions">
                  <Button
                    disabled={expanded && !action}
                    onClick={() => {
                      if (!expanded) chooseAircraft(entry.id);
                      else if (action) action.run();
                      else onOpenDetails();
                    }}
                    size="compact"
                    variant={expanded && action ? "primary" : "secondary"}
                  >
                    {actionLabel(rotation)}
                  </Button>
                  {expanded ? (
                    <Button onClick={onRefuel} size="compact">
                      <Fuel aria-hidden="true" /> Tanken
                    </Button>
                  ) : null}
                </span>
              </div>

              {expanded ? (
                <div className="flight-director-assignment">
                  <header>
                    <div>
                      <Users aria-hidden="true" size={18} />
                      <strong>Buchungsgruppen zuweisen</strong>
                      <small>Gruppen bleiben vollständig zusammen.</small>
                    </div>
                    <span>
                      {selectedSeats} von {entry.passengerSeats} Plätzen ausgewählt
                    </span>
                  </header>
                  <div className="flight-director-assignment-body">
                    <div className="flight-director-queue">
                      {compatibleGroups.length > 0 ? (
                        compatibleGroups.map((group) => (
                          <QueueGroupRow
                            capacity={entry.passengerSeats}
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
                    </div>
                    <aside className="flight-director-selection">
                      <div>
                        <span>Ausgewählt</span>
                        {selectedGroups.map((group) => (
                          <strong key={group.id}>
                            {group.productCode}-{String(group.communicationNumber).padStart(3, "0")}
                            <small>{group.ticketCount} Plätze</small>
                          </strong>
                        ))}
                        {selectedGroups.length === 0 ? (
                          <small>Noch keine Gruppe gewählt</small>
                        ) : null}
                      </div>
                      <SelectField
                        label="Pilotencode"
                        onChange={(event) => onPilotChange(event.target.value)}
                        value={nextPilotId}
                      >
                        <option value="">Pilot wählen</option>
                        {board.pilots
                          .filter((pilot) => pilot.active && !pilot.paused)
                          .map((pilot) => (
                            <option key={pilot.id} value={pilot.id}>
                              {pilot.operationalCode}
                            </option>
                          ))}
                      </SelectField>
                      <div className="flight-director-selection-total">
                        <span>Gesamt</span>
                        <strong>
                          {selectedSeats} von {entry.passengerSeats} Plätzen
                        </strong>
                      </div>
                      <Button
                        disabled={
                          !action ||
                          action.disabled ||
                          selectedSeats > entry.passengerSeats ||
                          (selectedSeats === 0 && !selectedRotation)
                        }
                        onClick={() => action?.run()}
                        size="touch"
                        variant="primary"
                      >
                        <CheckCircle2 aria-hidden="true" />
                        {action?.label ?? "Keine operative Aktion"}
                      </Button>
                      <div className="flight-director-secondary-actions">
                        <Button onClick={onOpenDisposition} size="compact">
                          Disposition
                        </Button>
                        <Button onClick={onPause} size="compact">
                          Pause
                        </Button>
                        {entry.operationalState === "AVAILABLE" ? (
                          <Button onClick={onUnavailable} size="compact" variant="danger">
                            Nicht verfügbar
                          </Button>
                        ) : (
                          <Button onClick={onAvailable} size="compact" variant="primary">
                            Wieder verfügbar
                          </Button>
                        )}
                      </div>
                    </aside>
                  </div>
                </div>
              ) : null}
            </article>
          );
        })}
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
            <CompactCurrentRotation rotation={selectedRotation} timeZone={board.event.timeZone} />
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
  const label = `${group.productCode}-${String(group.communicationNumber).padStart(3, "0")}`;
  return (
    <div className={selected ? "flight-director-queue-row selected" : "flight-director-queue-row"}>
      <label>
        <input
          checked={selected}
          disabled={group.status === "MISSING" || exceedsCapacity}
          onChange={(event) => onToggle(group.id, event.target.checked)}
          type="checkbox"
        />
        <strong>{label}</strong>
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
    <dl className="flight-director-current-rotation">
      <div>
        <dt>Fluggruppe</dt>
        <dd>{rotation.communicationLabel}</dd>
      </div>
      <div>
        <dt>Status</dt>
        <dd>{rotation.status}</dd>
      </div>
      <div>
        <dt>Produkt</dt>
        <dd>{rotation.productName}</dd>
      </div>
      <div>
        <dt>Off-Block</dt>
        <dd>{formatTime(rotation.timeline.actual.departureAt, timeZone)}</dd>
      </div>
      <div>
        <dt>On-Block</dt>
        <dd>{formatTime(rotation.timeline.actual.landingAt, timeZone)}</dd>
      </div>
      <div>
        <dt>Pilot</dt>
        <dd>{rotation.pilotOperationalCode ?? "–"}</dd>
      </div>
    </dl>
  );
}

function CompactHistory({ history, timeZone }: { history: Rotation[]; timeZone: string }) {
  return (
    <div className="flight-director-compact-table">
      <div className="flight-director-compact-head">
        <span>Fluggruppe</span>
        <span>Off-Block</span>
        <span>On-Block</span>
        <span>Pilot</span>
        <span>Plätze</span>
      </div>
      {history.length > 0 ? (
        history.map((rotation) => (
          <div key={rotation.id}>
            <strong>{rotation.communicationLabel}</strong>
            <span>{formatTime(rotation.timeline.actual.departureAt, timeZone)}</span>
            <span>{formatTime(rotation.timeline.actual.landingAt, timeZone)}</span>
            <span>{rotation.pilotOperationalCode ?? "–"}</span>
            <span>{rotation.ticketCount}</span>
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
            <strong>
              {rotation.productCode}-{String(group.communicationNumber).padStart(3, "0")}
            </strong>
            <span>{group.ticketCount}</span>
            <span>{rotation.status}</span>
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
