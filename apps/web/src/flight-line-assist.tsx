import type { OperationBoard } from "@rundflug/contracts";
import {
  ChevronDown,
  CircleX,
  Coffee,
  Fuel,
  LoaderCircle,
  MapPin,
  Plane,
  RefreshCw,
  UnlockKeyhole,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { FlightLineAssistClaimConflictError } from "./api";
import { useActionMessageBridge } from "./app/PageNotifications";
import {
  Button,
  ConfirmationDialog,
  IconButton,
  PageHeader,
  Panel,
  StatusPill,
  Tabs,
} from "./design-system/components";
import {
  activeRotationForAircraft,
  aircraftStatusLabel,
  BookingGroupAssignmentDialog,
  CompactCurrentRotation,
  CompactHistory,
  type FlightLineFleetState,
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
type TurnaroundNextState = "AVAILABLE" | "REFUELING" | "PAUSED" | "INACTIVE";

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
  busyRotationIds,
  canAssignPilot,
  onAssignPilot,
  onClaim,
  onClaimUnavailable,
  onGroupAttendance,
  onGroupMissing,
  onGroupRecall,
  onGroupDefer,
  onPause,
  onRefresh,
  onRelease,
  onRunRotation,
  onSelectAircraft,
  onSetAircraftState,
  onToggleGroup,
  selectedQueueGroupIds,
}: {
  board: OperationBoard;
  aircraft: Aircraft[];
  busyRotationIds?: ReadonlySet<string>;
  canAssignPilot: boolean;
  onAssignPilot: (aircraftId: string, pilotId: string, reassign: boolean) => Promise<void>;
  onClaim: (aircraftId: string, expectedTakeoverRevision?: number) => Promise<void>;
  onClaimUnavailable: () => void;
  onGroupAttendance: (ticketGroupId: string, checkedIn: boolean) => void;
  onGroupMissing: (ticketGroupId: string) => void;
  onGroupRecall: (ticketGroupId: string) => void;
  onGroupDefer: (ticketGroupId: string) => void;
  onPause: (aircraftId: string) => void;
  onRefresh: () => Promise<void>;
  onRelease: (aircraftId: string) => Promise<void>;
  onRunRotation: (rotation: Rotation, nextAircraftState?: TurnaroundNextState) => Promise<void>;
  onSelectAircraft: (aircraftId: string) => void;
  onSetAircraftState: (aircraftId: string, state: FlightLineFleetState) => void;
  onToggleGroup: (ticketGroupId: string, selected: boolean) => void;
  selectedQueueGroupIds: string[];
}) {
  const assistClaims = board.assistClaims ?? [];
  const ownServerClaim = assistClaims.find((claim) => claim.claimedByCurrentOperator);
  const [claimedAircraftId, setClaimedAircraftId] = useState<string | null>(
    ownServerClaim?.aircraftId ?? null,
  );
  const [serverClaimSeen, setServerClaimSeen] = useState(Boolean(ownServerClaim));
  const [releasing, setReleasing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [claimingAircraftId, setClaimingAircraftId] = useState<string | null>(null);
  const claimingAircraftIdRef = useRef<string | null>(null);
  const [visibleAircraftCount, setVisibleAircraftCount] = useState(5);
  const [claimError, setClaimError] = useState<string | null>(null);
  useActionMessageBridge(claimError, setClaimError);
  const [detailTab, setDetailTab] = useState<"current" | "history">("current");
  const [pilotOpen, setPilotOpen] = useState(false);
  const [assignmentOpen, setAssignmentOpen] = useState(false);
  const [takeoverClaim, setTakeoverClaim] = useState<OperationBoard["assistClaims"][number] | null>(
    null,
  );
  const lastActivityAt = useRef(Date.now());

  const availableAircraft = aircraft;
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
        !activeAircraft.currentPilotId ||
        board.event.emergencyMode ||
        board.event.status !== "ACTIVE" ||
        board.event.operationalInterrupted));
  const secondaryAllowed =
    activeAircraft?.operationalState === "AVAILABLE" &&
    (!assignedRotation || assignedRotation.status === "DRAFT");
  const turnaroundActionAllowed = activeRotation?.status === "LANDED";
  const unavailableAllowed =
    secondaryAllowed ||
    Boolean(
      assignedRotation && ["CALLED", "IN_FLIGHT", "LANDED"].includes(assignedRotation.status),
    );
  const pilotChangeAllowed =
    canAssignPilot && (!assignedRotation || ["DRAFT", "CALLED"].includes(assignedRotation.status));
  const primaryPresentation = activeAircraft
    ? primaryAircraftActionPresentation(activeAircraft, activeRotation)
    : null;
  const PrimaryActionIcon = primaryPresentation?.Icon;
  const actionBusy = activeRotation ? Boolean(busyRotationIds?.has(activeRotation.id)) : false;

  useEffect(() => {
    if (!ownServerClaim) return;
    setClaimedAircraftId(ownServerClaim.aircraftId);
    setServerClaimSeen(true);
  }, [ownServerClaim]);

  useEffect(() => {
    if (releasing || !serverClaimSeen || ownServerClaim || !claimedAircraftId) return;
    const externalClaim = assistClaims.find((claim) => claim.aircraftId === claimedAircraftId);
    setClaimedAircraftId(null);
    setServerClaimSeen(false);
    setAssignmentOpen(false);
    setClaimError(
      externalClaim
        ? `${externalClaim.ownerLoginCode} hat die Betreuung dieses Flugzeugs übernommen.`
        : "Die Flugzeugübernahme ist nach längerer Inaktivität abgelaufen. Bitte erneut auswählen.",
    );
    onClaimUnavailable();
  }, [
    assistClaims,
    claimedAircraftId,
    onClaimUnavailable,
    ownServerClaim,
    releasing,
    serverClaimSeen,
  ]);

  useEffect(() => {
    if (!claimedAircraftId) return;
    const noteActivity = () => {
      lastActivityAt.current = Date.now();
    };
    window.addEventListener("pointerdown", noteActivity, { passive: true });
    window.addEventListener("keydown", noteActivity);
    const renewal = window.setInterval(() => {
      if (
        document.visibilityState !== "visible" ||
        Date.now() - lastActivityAt.current > 10 * 60_000
      )
        return;
      void onClaim(claimedAircraftId).catch(() => {
        setClaimedAircraftId(null);
        setServerClaimSeen(false);
        setClaimError(
          "Die Flugzeugübernahme konnte nicht erneuert werden. Bitte erneut auswählen.",
        );
        onClaimUnavailable();
      });
    }, 5 * 60_000);
    return () => {
      window.clearInterval(renewal);
      window.removeEventListener("pointerdown", noteActivity);
      window.removeEventListener("keydown", noteActivity);
    };
  }, [claimedAircraftId, onClaim, onClaimUnavailable]);

  async function claim(entry: Aircraft) {
    if (claimingAircraftIdRef.current) return;
    claimingAircraftIdRef.current = entry.id;
    setClaimingAircraftId(entry.id);
    try {
      await onClaim(entry.id);
      setClaimedAircraftId(entry.id);
      setClaimError(null);
      onSelectAircraft(entry.id);
    } catch (cause) {
      if (cause instanceof FlightLineAssistClaimConflictError) {
        setTakeoverClaim(cause.claim);
        return;
      }
      setClaimError(
        cause instanceof Error ? cause.message : "Betreuung konnte nicht übernommen werden.",
      );
    } finally {
      claimingAircraftIdRef.current = null;
      setClaimingAircraftId(null);
    }
  }

  async function takeover() {
    if (!takeoverClaim || claimingAircraftIdRef.current) return;
    claimingAircraftIdRef.current = takeoverClaim.aircraftId;
    setClaimingAircraftId(takeoverClaim.aircraftId);
    try {
      await onClaim(takeoverClaim.aircraftId, takeoverClaim.revision);
      setClaimedAircraftId(takeoverClaim.aircraftId);
      setServerClaimSeen(true);
      setClaimError(null);
      onSelectAircraft(takeoverClaim.aircraftId);
      setTakeoverClaim(null);
    } catch (cause) {
      if (cause instanceof FlightLineAssistClaimConflictError) {
        setTakeoverClaim(cause.claim);
        setClaimError("Die Betreuung hat sich zwischenzeitlich geändert. Bitte erneut prüfen.");
        return;
      }
      setClaimError(
        cause instanceof Error ? cause.message : "Betreuung konnte nicht übernommen werden.",
      );
    } finally {
      claimingAircraftIdRef.current = null;
      setClaimingAircraftId(null);
    }
  }

  async function refreshAircraftList() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await onRefresh();
    } catch (cause) {
      setClaimError(
        cause instanceof Error ? cause.message : "Flugzeugliste konnte nicht aktualisiert werden.",
      );
    } finally {
      setRefreshing(false);
    }
  }

  async function finishClaim() {
    if (!claimedAircraftId) return;
    setReleasing(true);
    try {
      await onRelease(claimedAircraftId);
      setClaimedAircraftId(null);
      setServerClaimSeen(false);
      setPilotOpen(false);
      setAssignmentOpen(false);
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
    if (activeRotation?.status === "DRAFT") {
      setAssignmentOpen(true);
      return;
    }
    if (activeRotation) {
      void onRunRotation(
        activeRotation,
        activeRotation.status === "LANDED" ? "AVAILABLE" : undefined,
      );
    }
  }

  if (!activeAircraft) {
    return (
      <section className="flight-assist flight-assist-v15 is-selection-mode">
        <Panel className="assist-v15-picker" padding="compact">
          <PageHeader
            actions={
              <IconButton
                aria-busy={refreshing}
                disabled={refreshing}
                label="Flugzeugliste aktualisieren"
                onClick={() => void refreshAircraftList()}
              >
                {refreshing ? (
                  <LoaderCircle aria-hidden="true" className="assist-v15-spinner" />
                ) : (
                  <RefreshCw aria-hidden="true" />
                )}
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
              const existingClaim = assistClaims.find(
                (candidate) => candidate.aircraftId === entry.id,
              );
              const isClaiming = claimingAircraftId === entry.id;
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
                    {existingClaim && !existingClaim.claimedByCurrentOperator ? (
                      <small className="assist-v15-claim-owner">
                        Betreut von {existingClaim.ownerLoginCode}
                      </small>
                    ) : null}
                  </div>
                  <Button
                    aria-busy={isClaiming}
                    className={`assist-v15-claim${
                      existingClaim && !existingClaim.claimedByCurrentOperator
                        ? " assist-v15-claim--takeover"
                        : ""
                    }`}
                    disabled={claimingAircraftId !== null}
                    onClick={() => void claim(entry)}
                    size="compact"
                    variant={
                      isClaiming
                        ? "primary"
                        : existingClaim && !existingClaim.claimedByCurrentOperator
                          ? "ghost"
                          : "primary"
                    }
                  >
                    {isClaiming ? (
                      <>
                        <LoaderCircle aria-hidden="true" className="assist-v15-spinner" />
                        Wird übernommen …
                      </>
                    ) : existingClaim && !existingClaim.claimedByCurrentOperator ? (
                      "Bewusst übernehmen"
                    ) : (
                      "Übernehmen"
                    )}
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
                <PilotIcon aria-hidden="true" />
                <strong>{activeAircraft.currentPilotOperationalCode ?? "–"}</strong>
              </span>
              {pilotChangeAllowed ? (
                <IconButton
                  label={`Pilot für ${activeAircraft.registration} wechseln`}
                  onClick={() => setPilotOpen(true)}
                  size="compact"
                >
                  <PilotChangeIcon aria-hidden="true" />
                </IconButton>
              ) : null}
            </div>
            <Button
              className="assist-v15-release"
              disabled={releasing}
              onClick={() => void finishClaim()}
              size="compact"
              variant="danger"
            >
              <UnlockKeyhole aria-hidden="true" /> <span>Flugzeug freigeben</span>
            </Button>
          </div>
        </Panel>

        <Panel className="assist-v15-actions" padding="compact">
          <div className="assist-v15-action-bar">
            <IconButton
              label={primaryAircraftActionLabel(
                activeAircraft,
                activeRotation,
                "Belegung bestätigen & Boarding starten",
              )}
              className="assist-v15-primary-action"
              disabled={primaryDisabled || actionBusy}
              onClick={runPrimary}
              size="touch"
            >
              {PrimaryActionIcon ? <PrimaryActionIcon aria-hidden="true" /> : null}
            </IconButton>
            <fieldset className="assist-v15-secondary-actions" aria-label="Flugzeugstatus">
              <IconButton
                aria-pressed={activeAircraft.operationalState === "REFUELING"}
                className="flight-line-status-action state-refueling"
                disabled={(!secondaryAllowed && !turnaroundActionAllowed) || actionBusy}
                label="Tanken"
                onClick={() => {
                  if (turnaroundActionAllowed && activeRotation) {
                    void onRunRotation(activeRotation, "REFUELING");
                  } else {
                    onSetAircraftState(activeAircraft.id, "REFUELING");
                  }
                }}
                size="touch"
              >
                <Fuel aria-hidden="true" />
              </IconButton>
              <IconButton
                aria-pressed={activeAircraft.operationalState === "PAUSED"}
                className="flight-line-status-action state-paused"
                disabled={(!secondaryAllowed && !turnaroundActionAllowed) || actionBusy}
                label="Pause"
                onClick={() => {
                  if (turnaroundActionAllowed && activeRotation) {
                    void onRunRotation(activeRotation, "PAUSED");
                  } else {
                    onPause(activeAircraft.id);
                  }
                }}
                size="touch"
              >
                <Coffee aria-hidden="true" />
              </IconButton>
              <IconButton
                aria-pressed={["INACTIVE", "INTERRUPTED"].includes(activeAircraft.operationalState)}
                className="flight-line-status-action state-inactive"
                disabled={!unavailableAllowed || actionBusy}
                label="Nicht verfügbar"
                onClick={() => {
                  if (turnaroundActionAllowed && activeRotation) {
                    void onRunRotation(activeRotation, "INACTIVE");
                  } else {
                    onSetAircraftState(activeAircraft.id, "INACTIVE");
                  }
                }}
                size="touch"
              >
                <CircleX aria-hidden="true" />
              </IconButton>
            </fieldset>
          </div>
        </Panel>

        <Panel className="assist-v15-rotation-panel" padding="compact">
          <Tabs
            items={[
              { value: "current", label: "Aktueller Umlauf" },
              { value: "history", label: "Historie" },
            ]}
            label="Flugzeuginformationen"
            onChange={setDetailTab}
            value={detailTab}
          />
          <div className={`assist-v15-rotation-detail is-${detailTab}`}>
            <div
              aria-hidden={detailTab === "history" ? "true" : undefined}
              className="assist-v15-current-pane"
            >
              <CompactCurrentRotation
                aircraft={activeAircraft}
                rotation={displayedRotation}
                timeZone={board.event.timeZone}
              />
            </div>
            {detailTab === "history" ? (
              <div className="assist-v15-history-pane">
                <CompactHistory history={history} timeZone={board.event.timeZone} />
              </div>
            ) : null}
          </div>
        </Panel>
      </div>

      <BookingGroupAssignmentDialog
        aircraft={activeAircraft}
        confirmDisabled={!assignmentReady || primaryDisabled}
        groups={waitingGroups}
        onAttendance={onGroupAttendance}
        onClose={() => setAssignmentOpen(false)}
        onConfirm={() => {
          if (activeRotation) void onRunRotation(activeRotation);
          setAssignmentOpen(false);
        }}
        onDefer={onGroupDefer}
        onMissing={onGroupMissing}
        onRecall={onGroupRecall}
        onToggle={onToggleGroup}
        open={assignmentOpen}
        selectedQueueGroupIds={selectedQueueGroupIds}
      />

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
      <ConfirmationDialog
        body={
          takeoverClaim
            ? `Das Flugzeug wird derzeit von ${takeoverClaim.ownerLoginCode} betreut. Möchtest du die Übernahme wirklich überschreiben?`
            : ""
        }
        cancelLabel="Abbrechen"
        confirmLabel="Trotzdem übernehmen"
        onCancel={() => setTakeoverClaim(null)}
        onConfirm={() => void takeover()}
        open={takeoverClaim !== null}
        title="Flugzeug bereits übernommen"
      />
    </section>
  );
}
