import type { OperationBoard } from "@rundflug/contracts";
import {
  Ban,
  BellRing,
  ChevronDown,
  CircleCheckBig,
  CircleOff,
  Coffee,
  Fuel,
  MapPin,
  MoreHorizontal,
  Plane,
  RefreshCw,
  RotateCcw,
  UnlockKeyhole,
  UserCheck,
  Users,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useActionMessageBridge } from "./app/PageNotifications";
import {
  Button,
  IconButton,
  PageHeader,
  Panel,
  StatusPill,
  Tabs,
} from "./design-system/components";
import {
  activeRotationForAircraft,
  aircraftStatusLabel,
  CompactCurrentRotation,
  CompactHistory,
  type FlightLineFleetState,
  FlightProgress,
  flightLineStateClass,
  flightLineStatusTone,
  formatFlightLineTime,
  latestRotationForAircraft,
  operationalRotationForAircraft,
  PilotAssignmentDialogs,
  PilotChangeIcon,
  PilotIcon,
  primaryAircraftActionLabel,
  primaryAircraftActionPresentation,
  rotationHistoryForAircraft,
  visibleAircraftState,
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

function groupLabel(group: QueueGroup) {
  return `${group.productCode}-${String(group.communicationNumber).padStart(3, "0")}`;
}

function AircraftPickerMeta({
  aircraft,
  rotation,
  timeZone,
}: {
  aircraft: Aircraft;
  rotation: Rotation | undefined;
  timeZone: string;
}) {
  const status = visibleAircraftState(aircraft, rotation);
  return (
    <div className="assist-v15-picker-meta">
      <StatusPill
        className={`assist-v15-operational-state ${flightLineStateClass(status)}`}
        tone={flightLineStatusTone(status)}
      >
        {aircraftStatusLabel(aircraft, rotation)}
      </StatusPill>
      <span>
        {rotation?.communicationLabel ?? "Keine Gruppe"} · {aircraft.passengerSeats} Plätze
      </span>
      <span className="assist-v15-gate">
        <MapPin aria-hidden="true" />
        {rotation?.gateLabel ?? aircraft.resourceGroupName}
      </span>
      <small>seit {formatFlightLineTime(aircraft.operationalStateChangedAt, timeZone)}</small>
    </div>
  );
}

export function FlightLineAssist({
  board,
  aircraft,
  canAssignPilot,
  onAssignPilot,
  onClaim,
  onClaimUnavailable,
  onGroupAttendance,
  onGroupMissing,
  onGroupRecall,
  onGroupDefer,
  onPause,
  onRelease,
  onRunRotation,
  onSelectAircraft,
  onSetAircraftState,
  onToggleGroup,
  selectedQueueGroupIds,
  turnaroundNextState,
  onTurnaroundNextStateChange,
}: {
  board: OperationBoard;
  aircraft: Aircraft[];
  canAssignPilot: boolean;
  onAssignPilot: (aircraftId: string, pilotId: string, reassign: boolean) => Promise<void>;
  onClaim: (aircraftId: string) => Promise<void>;
  onClaimUnavailable: () => void;
  onGroupAttendance: (ticketGroupId: string, checkedIn: boolean) => void;
  onGroupMissing: (ticketGroupId: string) => void;
  onGroupRecall: (ticketGroupId: string) => void;
  onGroupDefer: (ticketGroupId: string) => void;
  onPause: (aircraftId: string) => void;
  onRelease: (aircraftId: string) => Promise<void>;
  onRunRotation: (rotation: Rotation) => void;
  onSelectAircraft: (aircraftId: string) => void;
  onSetAircraftState: (aircraftId: string, state: FlightLineFleetState) => void;
  onToggleGroup: (ticketGroupId: string, selected: boolean) => void;
  selectedQueueGroupIds: string[];
  turnaroundNextState: "AVAILABLE" | "REFUELING" | "PAUSED" | "INACTIVE";
  onTurnaroundNextStateChange: (state: "AVAILABLE" | "REFUELING" | "PAUSED" | "INACTIVE") => void;
}) {
  const assistClaims = board.assistClaims ?? [];
  const ownServerClaim = assistClaims.find((claim) => claim.claimedByCurrentSession);
  const [claimedAircraftId, setClaimedAircraftId] = useState<string | null>(
    ownServerClaim?.aircraftId ?? null,
  );
  const [serverClaimSeen, setServerClaimSeen] = useState(Boolean(ownServerClaim));
  const [releasing, setReleasing] = useState(false);
  const [visibleAircraftCount, setVisibleAircraftCount] = useState(5);
  const [claimError, setClaimError] = useState<string | null>(null);
  useActionMessageBridge(claimError, setClaimError);
  const [openGroupMenuId, setOpenGroupMenuId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<"current" | "history">("current");
  const [pilotOpen, setPilotOpen] = useState(false);

  const availableAircraft = aircraft.filter((entry) => {
    const claim = assistClaims.find((candidate) => candidate.aircraftId === entry.id);
    return !claim || claim.claimedByCurrentSession || entry.id === claimedAircraftId;
  });
  const activeAircraft = aircraft.find((entry) => entry.id === claimedAircraftId);
  const activeRotation = activeAircraft
    ? operationalRotationForAircraft(activeAircraft, board.rotations, board.products)
    : undefined;
  const assignedRotation = activeAircraft
    ? activeRotationForAircraft(activeAircraft.id, board.rotations)
    : undefined;
  const displayedRotation = activeAircraft
    ? latestRotationForAircraft(activeAircraft.id, board.rotations)
    : undefined;
  const history = activeAircraft
    ? rotationHistoryForAircraft(activeAircraft.id, board.rotations)
    : [];
  const visibleStatus = activeAircraft
    ? visibleAircraftState(activeAircraft, assignedRotation)
    : "AVAILABLE";
  const waitingGroups = activeAircraft
    ? board.queueGroups.filter(
        (group) =>
          group.resourceGroupId === activeAircraft.resourceGroupId &&
          ["QUEUED", "PRESENT", "MISSING"].includes(group.status),
      )
    : [];
  const selectedSeatCount = waitingGroups
    .filter((group) => selectedQueueGroupIds.includes(group.id))
    .reduce((sum, group) => sum + queuedSegmentTicketCount(group), 0);
  const assignmentReady =
    activeAircraft?.operationalState === "AVAILABLE" && activeRotation?.status === "DRAFT";
  const requiresAvailableReset = Boolean(
    activeAircraft &&
      ["REFUELING", "PAUSED", "INTERRUPTED", "INACTIVE", "TURNAROUND"].includes(
        activeAircraft.operationalState,
      ),
  );
  const primaryDisabled =
    !activeAircraft ||
    (!requiresAvailableReset &&
      !assignedRotation &&
      (activeRotation?.status !== "DRAFT" ||
        selectedQueueGroupIds.length === 0 ||
        !activeAircraft.currentPilotId ||
        board.event.emergencyMode ||
        board.event.status !== "ACTIVE" ||
        board.event.operationalInterrupted));
  const secondaryAllowed =
    activeAircraft?.operationalState === "AVAILABLE" &&
    (!assignedRotation || assignedRotation.status === "DRAFT");
  const pilotChangeAllowed =
    canAssignPilot && (!assignedRotation || ["DRAFT", "CALLED"].includes(assignedRotation.status));
  const primaryPresentation = activeAircraft
    ? primaryAircraftActionPresentation(activeAircraft, activeRotation)
    : null;
  const PrimaryActionIcon = primaryPresentation?.Icon;

  useEffect(() => {
    if (!ownServerClaim) return;
    setClaimedAircraftId(ownServerClaim.aircraftId);
    setServerClaimSeen(true);
  }, [ownServerClaim]);

  useEffect(() => {
    if (releasing || !serverClaimSeen || ownServerClaim || !claimedAircraftId) return;
    setClaimedAircraftId(null);
    setServerClaimSeen(false);
    setOpenGroupMenuId(null);
    setClaimError(
      "Die Flugzeugübernahme ist abgelaufen oder wurde aufgehoben. Bitte erneut auswählen.",
    );
    onClaimUnavailable();
  }, [claimedAircraftId, onClaimUnavailable, ownServerClaim, releasing, serverClaimSeen]);

  useEffect(() => {
    if (!claimedAircraftId) return;
    const renewal = window.setInterval(() => {
      void onClaim(claimedAircraftId).catch(() => {
        setClaimedAircraftId(null);
        setServerClaimSeen(false);
        setClaimError(
          "Die Flugzeugübernahme konnte nicht erneuert werden. Bitte erneut auswählen.",
        );
        onClaimUnavailable();
      });
    }, 25_000);
    return () => window.clearInterval(renewal);
  }, [claimedAircraftId, onClaim, onClaimUnavailable]);

  async function claim(entry: Aircraft) {
    try {
      await onClaim(entry.id);
      setClaimedAircraftId(entry.id);
      setClaimError(null);
      onSelectAircraft(entry.id);
    } catch (cause) {
      setClaimError(
        cause instanceof Error ? cause.message : "Betreuung konnte nicht übernommen werden.",
      );
    }
  }

  async function finishClaim() {
    if (!claimedAircraftId) return;
    setReleasing(true);
    try {
      await onRelease(claimedAircraftId);
      setClaimedAircraftId(null);
      setServerClaimSeen(false);
      setOpenGroupMenuId(null);
      setPilotOpen(false);
      setClaimError(null);
    } catch (cause) {
      setClaimError(
        cause instanceof Error ? cause.message : "Betreuung konnte nicht beendet werden.",
      );
    } finally {
      setReleasing(false);
    }
  }

  function runPrimary() {
    if (!activeAircraft) return;
    if (requiresAvailableReset) {
      onSetAircraftState(activeAircraft.id, "AVAILABLE");
      return;
    }
    if (activeRotation) onRunRotation(activeRotation);
  }

  function runGroupAction(groupId: string, callback: (ticketGroupId: string) => void) {
    callback(groupId);
    setOpenGroupMenuId(null);
  }

  function renderGroup(group: QueueGroup) {
    const selected = selectedQueueGroupIds.includes(group.id);
    const segmentTicketCount = queuedSegmentTicketCount(group);
    const segmentPresentCount = queuedSegmentPresentCount(group);
    const capacityExceeded =
      !selected && selectedSeatCount + segmentTicketCount > (activeAircraft?.passengerSeats ?? 0);
    return (
      <div className={`assist-v15-group-row ${selected ? "is-selected" : ""}`} key={group.id}>
        <label className="assist-v15-group-select">
          <input
            checked={selected}
            disabled={!assignmentReady || group.status === "MISSING" || capacityExceeded}
            onChange={(event) => onToggleGroup(group.id, event.target.checked)}
            type="checkbox"
          />
          <Users aria-hidden="true" />
          <strong>{groupLabel(group)}</strong>
          <StatusPill tone={group.status === "MISSING" ? "danger" : selected ? "info" : "neutral"}>
            {group.segmentCount && group.segmentCount > 1
              ? `${segmentTicketCount} von ${group.ticketCount} · Teil ${group.segmentIndex ?? 1}/${group.segmentCount}`
              : `${segmentTicketCount} ${segmentTicketCount === 1 ? "Person" : "Personen"}`}
          </StatusPill>
        </label>
        <span className="assist-v15-presence">
          {group.status === "PRESENT"
            ? "Anwesend"
            : group.status === "MISSING"
              ? "Nicht da"
              : `${segmentPresentCount}/${segmentTicketCount} vor Ort`}
        </span>
        <div className="assist-v15-group-actions">
          <Button
            aria-label={group.status === "PRESENT" ? "Anwesenheit aufheben" : "Anwesend"}
            onClick={() => onGroupAttendance(group.id, group.status !== "PRESENT")}
            size="compact"
            title={group.status === "PRESENT" ? "Anwesenheit aufheben" : undefined}
            variant="ghost"
          >
            {group.status === "PRESENT" ? (
              <RotateCcw aria-hidden="true" />
            ) : (
              <UserCheck aria-hidden="true" />
            )}
            {group.status === "PRESENT" ? "Aufheben" : "Anwesend"}
          </Button>
          <Button onClick={() => onGroupMissing(group.id)} size="compact" variant="danger">
            <Ban aria-hidden="true" /> Nicht da
          </Button>
          <Button onClick={() => onGroupRecall(group.id)} size="compact" variant="ghost">
            <BellRing aria-hidden="true" /> Nachrufen
          </Button>
          <Button onClick={() => onGroupDefer(group.id)} size="compact" variant="ghost">
            <RotateCcw aria-hidden="true" /> Zurückstellen
          </Button>
        </div>
        <div className="assist-v15-group-menu">
          <IconButton
            aria-expanded={openGroupMenuId === group.id}
            label={`Aktionen für ${groupLabel(group)}`}
            onClick={() =>
              setOpenGroupMenuId((current) => (current === group.id ? null : group.id))
            }
            size="touch"
          >
            <MoreHorizontal aria-hidden="true" />
          </IconButton>
        </div>
        {openGroupMenuId === group.id ? (
          <div className="assist-v15-group-popover">
            <Button
              onClick={() =>
                runGroupAction(group.id, (id) => onGroupAttendance(id, group.status !== "PRESENT"))
              }
              size="touch"
              variant="ghost"
            >
              {group.status === "PRESENT" ? (
                <RotateCcw aria-hidden="true" />
              ) : (
                <UserCheck aria-hidden="true" />
              )}
              {group.status === "PRESENT" ? "Anwesenheit aufheben" : "Anwesend"}
            </Button>
            <Button
              onClick={() => runGroupAction(group.id, onGroupMissing)}
              size="touch"
              variant="ghost"
            >
              <Ban aria-hidden="true" /> Nicht da
            </Button>
            <Button
              onClick={() => runGroupAction(group.id, onGroupRecall)}
              size="touch"
              variant="ghost"
            >
              <BellRing aria-hidden="true" /> Nachrufen
            </Button>
            <Button
              onClick={() => runGroupAction(group.id, onGroupDefer)}
              size="touch"
              variant="ghost"
            >
              <RotateCcw aria-hidden="true" /> Zurückstellen
            </Button>
          </div>
        ) : null}
      </div>
    );
  }

  if (!activeAircraft) {
    return (
      <section className="flight-assist flight-assist-v15 is-selection-mode">
        <Panel className="assist-v15-picker" padding="compact">
          <PageHeader
            actions={
              <IconButton
                label="Flugzeugliste aktualisieren"
                onClick={() => window.location.reload()}
              >
                <RefreshCw aria-hidden="true" />
              </IconButton>
            }
            description="Verfügbare Flugzeuge"
            level={2}
            title="Flugzeug übernehmen"
          />
          <div className="assist-v15-aircraft-list">
            {availableAircraft.slice(0, visibleAircraftCount).map((entry) => {
              const rotation = operationalRotationForAircraft(
                entry,
                board.rotations,
                board.products,
              );
              return (
                <article key={entry.id}>
                  <span className="assist-v15-plane-icon">
                    <Plane aria-hidden="true" />
                  </span>
                  <div className="assist-v15-aircraft-copy">
                    <div className="assist-v15-aircraft-title">
                      <strong>{entry.registration}</strong>
                    </div>
                    <AircraftPickerMeta
                      aircraft={entry}
                      rotation={rotation}
                      timeZone={board.event.timeZone}
                    />
                  </div>
                  <Button
                    className="assist-v15-claim"
                    onClick={() => void claim(entry)}
                    size="compact"
                    variant="primary"
                  >
                    Übernehmen
                  </Button>
                </article>
              );
            })}
          </div>
          {visibleAircraftCount < availableAircraft.length ? (
            <Button
              className="assist-v15-more"
              onClick={() => setVisibleAircraftCount((current) => current + 5)}
              variant="ghost"
            >
              <ChevronDown aria-hidden="true" /> Weitere anzeigen
            </Button>
          ) : null}
        </Panel>
      </section>
    );
  }

  return (
    <section className="flight-assist flight-assist-v15 has-claim is-work-mode">
      <div className="assist-v15-active-column">
        <Panel className="assist-v15-aircraft-panel" padding="compact">
          <div className="assist-v15-active-heading">
            <span className="assist-v15-plane-icon">
              <Plane aria-hidden="true" />
            </span>
            <div>
              <div className="assist-v15-active-title">
                <strong>{activeAircraft.registration}</strong>
                <StatusPill
                  className={flightLineStateClass(visibleStatus)}
                  tone={flightLineStatusTone(visibleStatus)}
                >
                  {aircraftStatusLabel(activeAircraft, assignedRotation)}
                </StatusPill>
              </div>
              <span className="assist-v15-aircraft-meta">
                <span>{activeAircraft.passengerSeats} Plätze</span>
                <span>·</span>
                <span>{activeAircraft.resourceGroupName}</span>
                <span>·</span>
                <small>
                  seit{" "}
                  {formatFlightLineTime(
                    activeAircraft.operationalStateChangedAt,
                    board.event.timeZone,
                  )}
                </small>
              </span>
            </div>
            <div className="assist-v15-active-tools">
              <span className="assist-v15-pilot-code">
                <PilotIcon aria-hidden="true" /> Pilot{" "}
                {activeAircraft.currentPilotOperationalCode ?? "–"}
              </span>
              {pilotChangeAllowed ? (
                <Button onClick={() => setPilotOpen(true)} size="compact" variant="ghost">
                  <PilotChangeIcon aria-hidden="true" /> Pilot wechseln
                </Button>
              ) : null}
              <Button
                disabled={releasing}
                onClick={() => void finishClaim()}
                size="compact"
                variant="danger"
              >
                <UnlockKeyhole aria-hidden="true" /> Flugzeug freigeben
              </Button>
            </div>
          </div>
          <div className="assist-v15-progress-row">
            <span>Ist-Zeitlinie</span>
            <FlightProgress
              aircraft={activeAircraft}
              rotation={assignedRotation ?? displayedRotation}
              timeZone={board.event.timeZone}
              variant="detailed"
            />
          </div>
        </Panel>

        <Panel className="assist-v15-operations" padding="compact">
          <div className="assist-v15-action-bar">
            {activeRotation?.status === "LANDED" ? (
              <fieldset className="assist-v15-turnaround">
                <legend>Zustand nach Abschluss</legend>
                {[
                  { state: "AVAILABLE" as const, label: "Verfügbar", Icon: CircleCheckBig },
                  { state: "REFUELING" as const, label: "Tanken", Icon: Fuel },
                  { state: "PAUSED" as const, label: "Pause", Icon: Coffee },
                  { state: "INACTIVE" as const, label: "Nicht verfügbar", Icon: CircleOff },
                ].map(({ state, label, Icon }) => (
                  <IconButton
                    aria-pressed={turnaroundNextState === state}
                    className={`flight-line-status-action state-${state.toLocaleLowerCase("en-US")}`}
                    key={state}
                    label={`Folgestatus ${label}`}
                    onClick={() => onTurnaroundNextStateChange(state)}
                    size="touch"
                  >
                    <Icon aria-hidden="true" />
                  </IconButton>
                ))}
              </fieldset>
            ) : null}
            <Button
              aria-label={primaryAircraftActionLabel(
                activeAircraft,
                activeRotation,
                "Belegung bestätigen & Boarding starten",
              )}
              className="assist-v15-primary-action"
              disabled={primaryDisabled}
              onClick={runPrimary}
              size="touch"
              title={primaryAircraftActionLabel(
                activeAircraft,
                activeRotation,
                "Belegung bestätigen & Boarding starten",
              )}
              variant="primary"
            >
              {PrimaryActionIcon ? <PrimaryActionIcon aria-hidden="true" /> : null}
              {primaryPresentation?.shortLabel}
            </Button>
            <fieldset className="assist-v15-secondary-actions" aria-label="Flugzeugstatus">
              <IconButton
                aria-pressed={activeAircraft.operationalState === "REFUELING"}
                className="flight-line-status-action state-refueling"
                disabled={!secondaryAllowed}
                label="Tanken"
                onClick={() => onSetAircraftState(activeAircraft.id, "REFUELING")}
                size="touch"
              >
                <Fuel aria-hidden="true" />
              </IconButton>
              <IconButton
                aria-pressed={activeAircraft.operationalState === "PAUSED"}
                className="flight-line-status-action state-paused"
                disabled={!secondaryAllowed}
                label="Pause"
                onClick={() => onPause(activeAircraft.id)}
                size="touch"
              >
                <Coffee aria-hidden="true" />
              </IconButton>
              <IconButton
                aria-pressed={["INACTIVE", "INTERRUPTED"].includes(activeAircraft.operationalState)}
                className="flight-line-status-action state-inactive"
                disabled={!secondaryAllowed}
                label="Nicht verfügbar"
                onClick={() => onSetAircraftState(activeAircraft.id, "INACTIVE")}
                size="touch"
              >
                <CircleOff aria-hidden="true" />
              </IconButton>
            </fieldset>
          </div>
          <Tabs
            items={[
              { value: "current", label: "Aktueller Umlauf" },
              { value: "history", label: "Historie" },
            ]}
            label="Flugzeuginformationen"
            onChange={setDetailTab}
            value={detailTab}
          />
          <div className="assist-v15-rotation-detail">
            {detailTab === "current" ? (
              <CompactCurrentRotation
                aircraft={activeAircraft}
                rotation={displayedRotation}
                timeZone={board.event.timeZone}
              />
            ) : (
              <CompactHistory history={history} timeZone={board.event.timeZone} />
            )}
          </div>
        </Panel>

        <Panel className="assist-v15-groups" padding="compact">
          <PageHeader
            actions={
              <span className="assist-v15-capacity">
                <Users aria-hidden="true" /> {selectedSeatCount} von {activeAircraft.passengerSeats}{" "}
                Plätzen
              </span>
            }
            description="Wähle vollständige Gruppen aus und kombiniere bis zur verfügbaren Platzzahl."
            level={2}
            title={
              <>
                <span className="assist-v15-title-wide">
                  Buchungsgruppen auswählen & kombinieren
                </span>
                <span className="assist-v15-title-phone">Gruppen auswählen</span>
              </>
            }
          />
          <div className="assist-v15-group-section">
            <h3>Ausgewählt ({selectedQueueGroupIds.length} Gruppen)</h3>
            <div className="assist-v15-group-list">
              {waitingGroups
                .filter((group) => selectedQueueGroupIds.includes(group.id))
                .map(renderGroup)}
              {selectedQueueGroupIds.length === 0 ? (
                <p className="assist-v15-no-groups">Noch keine Gruppe ausgewählt.</p>
              ) : null}
            </div>
          </div>
          <div className="assist-v15-group-section">
            <h3>Verfügbare Alternativen</h3>
            <div className="assist-v15-group-list">
              {waitingGroups
                .filter((group) => !selectedQueueGroupIds.includes(group.id))
                .map(renderGroup)}
              {waitingGroups.length === selectedQueueGroupIds.length ? (
                <p className="assist-v15-no-groups">Keine weitere passende Gruppe.</p>
              ) : null}
            </div>
          </div>
          <Button
            className="assist-v15-release-phone"
            disabled={releasing}
            onClick={() => void finishClaim()}
            size="touch"
            variant="danger"
          >
            <UnlockKeyhole aria-hidden="true" /> Flugzeug freigeben
          </Button>
        </Panel>
      </div>

      {canAssignPilot ? (
        <PilotAssignmentDialogs
          aircraft={activeAircraft}
          board={board}
          currentRotation={assignedRotation}
          onAssignPilot={onAssignPilot}
          onClose={() => setPilotOpen(false)}
          open={pilotOpen}
        />
      ) : null}
    </section>
  );
}
