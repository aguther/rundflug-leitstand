import type { OperationBoard } from "@rundflug/contracts";
import {
  ChevronDown,
  CircleX,
  Coffee,
  Fuel,
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
  Tabs,
} from "./design-system/components";
import type { DispatchRecommendationLeaseController } from "./dispatch-recommendation-lease";
import {
  activeRotationForAircraft,
  BookingGroupAssignmentDialog,
  CompactCurrentRotation,
  CompactHistory,
  CurrentAircraftStateMarker,
  type FlightLineFleetState,
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
type TurnaroundNextState = "AVAILABLE" | "REFUELING" | "PAUSED" | "INACTIVE";

function requiresAvailableStateReset(aircraft: Aircraft | undefined): boolean {
  return Boolean(
    aircraft &&
      ["REFUELING", "PAUSED", "INTERRUPTED", "INACTIVE", "TURNAROUND"].includes(
        aircraft.operationalState,
      ),
  );
}

function primaryActionDisabled(input: {
  aircraft: Aircraft | undefined;
  assignedRotation: Rotation | undefined;
  activeRotation: Rotation | undefined;
  board: OperationBoard;
  requiresAvailableReset: boolean;
}): boolean {
  if (!input.aircraft) return true;
  if (input.requiresAvailableReset || input.assignedRotation) return false;
  return (
    input.activeRotation?.status !== "DRAFT" ||
    !input.aircraft.currentPilotId ||
    input.board.event.emergencyMode ||
    input.board.event.status !== "ACTIVE" ||
    input.board.event.operationalInterrupted
  );
}

function unavailableActionAllowed(
  aircraft: Aircraft | undefined,
  assignedRotation: Rotation | undefined,
): boolean {
  if (
    aircraft?.operationalState === "AVAILABLE" &&
    (!assignedRotation || assignedRotation.status === "DRAFT")
  ) {
    return true;
  }
  return Boolean(
    assignedRotation && ["CALLED", "IN_FLIGHT", "LANDED"].includes(assignedRotation.status),
  );
}

function assistActionAvailability(input: {
  activeAircraft: Aircraft | undefined;
  activeRotation: Rotation | undefined;
  assignedRotation: Rotation | undefined;
  board: OperationBoard;
  canAssignPilot: boolean;
}) {
  const requiresAvailableReset = requiresAvailableStateReset(input.activeAircraft);
  return {
    assignmentReady:
      input.activeAircraft?.operationalState === "AVAILABLE" &&
      input.activeRotation?.status === "DRAFT",
    pilotChangeAllowed:
      input.canAssignPilot &&
      (!input.assignedRotation || ["DRAFT", "CALLED"].includes(input.assignedRotation.status)),
    primaryDisabled: primaryActionDisabled({
      aircraft: input.activeAircraft,
      assignedRotation: input.assignedRotation,
      activeRotation: input.activeRotation,
      board: input.board,
      requiresAvailableReset,
    }),
    requiresAvailableReset,
    secondaryAllowed:
      input.activeAircraft?.operationalState === "AVAILABLE" &&
      (!input.assignedRotation || input.assignedRotation.status === "DRAFT"),
    unavailableAllowed: unavailableActionAllowed(input.activeAircraft, input.assignedRotation),
  };
}

export function AircraftPickerMeta({
  aircraft,
  gateLabel,
}: Readonly<{
  aircraft: Aircraft;
  gateLabel?: string;
}>) {
  return (
    <div className="assist-v15-picker-meta">
      <span>
        {aircraft.resourceGroupName} · {aircraft.passengerSeats} Plätze
      </span>
      {gateLabel ? (
        <span className="assist-v15-gate">
          <MapPin aria-hidden="true" />
          {gateLabel}
        </span>
      ) : null}
    </div>
  );
}

function AircraftSelection({
  aircraft,
  assistClaims,
  board,
  claimingAircraftId,
  onClaim,
  onRefresh,
  refreshing,
  visibleAircraftCount,
  onShowMore,
}: Readonly<{
  aircraft: Aircraft[];
  assistClaims: OperationBoard["assistClaims"];
  board: OperationBoard;
  claimingAircraftId: string | null;
  onClaim: (aircraft: Aircraft) => Promise<void>;
  onRefresh: () => Promise<void>;
  refreshing: boolean;
  visibleAircraftCount: number;
  onShowMore: () => void;
}>) {
  return (
    <section className="flight-assist flight-assist-v15 is-selection-mode">
      <Panel className="assist-v15-picker" padding="compact">
        <PageHeader
          actions={
            <IconButton
              busy={refreshing}
              label="Flugzeugliste aktualisieren"
              onClick={() => void onRefresh()}
            >
              <RefreshCw aria-hidden="true" />
            </IconButton>
          }
          description="Verfügbare Flugzeuge"
          level={2}
          title="Flugzeug übernehmen"
        />
        <div className="assist-v15-aircraft-list">
          {aircraft.slice(0, visibleAircraftCount).map((entry) => {
            const rotation = operationalRotationForAircraft(entry, board.rotations, board.products);
            const existingClaim = assistClaims.find(
              (candidate) => candidate.aircraftId === entry.id,
            );
            const isClaiming = claimingAircraftId === entry.id;
            const claimedByAnotherOperator =
              existingClaim && !existingClaim.claimedByCurrentOperator;
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
                    {...(rotation?.gateLabel ? { gateLabel: rotation.gateLabel } : {})}
                  />
                  {claimedByAnotherOperator ? (
                    <small className="assist-v15-claim-owner">
                      Betreut von {existingClaim.ownerLoginCode}
                    </small>
                  ) : null}
                </div>
                <CurrentAircraftStateMarker
                  aircraft={entry}
                  rotation={rotation}
                  timeZone={board.event.timeZone}
                />
                <Button
                  busy={isClaiming}
                  busyLabel={`Übernahme läuft für ${entry.registration}`}
                  className={`assist-v15-claim${
                    claimedByAnotherOperator ? " assist-v15-claim--takeover" : ""
                  }`}
                  disabled={claimingAircraftId !== null}
                  onClick={() => void onClaim(entry)}
                  size="compact"
                  variant={claimedByAnotherOperator ? "ghost" : "primary"}
                >
                  {claimedByAnotherOperator ? "Bewusst übernehmen" : "Übernehmen"}
                </Button>
              </article>
            );
          })}
        </div>
        {visibleAircraftCount < aircraft.length ? (
          <Button className="assist-v15-more" onClick={onShowMore} variant="ghost">
            <ChevronDown aria-hidden="true" /> Weitere anzeigen
          </Button>
        ) : null}
      </Panel>
    </section>
  );
}

export function FlightLineAssist({
  board,
  aircraft,
  busyRotationIds,
  canAssignPilot,
  dispatchLease,
  onAssignPilot,
  onClaim,
  onClaimUnavailable,
  onGroupRecall,
  onGroupRecallClear,
  onGroupDefer,
  onPause,
  onRefresh,
  onRelease,
  onReserveAssignment,
  onRunRotation,
  onSelectAircraft,
  onSetAircraftState,
  onToggleGroup,
  selectedQueueGroupIds,
}: Readonly<{
  board: OperationBoard;
  aircraft: Aircraft[];
  busyRotationIds?: ReadonlySet<string>;
  canAssignPilot: boolean;
  dispatchLease: DispatchRecommendationLeaseController;
  onAssignPilot: (aircraftId: string, pilotId: string, reassign: boolean) => Promise<void>;
  onClaim: (aircraftId: string, expectedTakeoverRevision?: number) => Promise<void>;
  onClaimUnavailable: () => void;
  onGroupRecall: (ticketGroupId: string) => void | Promise<void>;
  onGroupRecallClear: (ticketGroupId: string, recallId: string) => void | Promise<void>;
  onGroupDefer: (ticketGroupId: string) => void | Promise<void>;
  onPause: (aircraftId: string) => void;
  onRefresh: () => Promise<void>;
  onRelease: (aircraftId: string) => Promise<void>;
  onReserveAssignment: (aircraftId: string) => Promise<unknown>;
  onRunRotation: (
    rotation: Rotation,
    nextAircraftState?: TurnaroundNextState,
    queueDeviationReason?: string,
  ) => Promise<boolean>;
  onSelectAircraft: (aircraftId: string) => void;
  onSetAircraftState: (aircraftId: string, state: FlightLineFleetState) => Promise<void>;
  onToggleGroup: (ticketGroupId: string, selected: boolean) => void;
  selectedQueueGroupIds: string[];
}>) {
  const assistClaims = board.assistClaims ?? [];
  const ownServerClaim = assistClaims.find((claim) => claim.claimedByCurrentOperator);
  const [claimedAircraftId, setClaimedAircraftId] = useState<string | null>(
    ownServerClaim?.aircraftId ?? null,
  );
  const [serverClaimSeen, setServerClaimSeen] = useState(Boolean(ownServerClaim));
  const [releasing, setReleasing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [pendingRotationAction, setPendingRotationAction] = useState<
    "primary" | "refueling" | "paused" | "inactive" | null
  >(null);
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
  const history = activeAircraft
    ? rotationHistoryForAircraft(activeAircraft.id, board.rotations)
    : [];
  const waitingGroups = activeAircraft
    ? board.queueGroups.filter(
        (group) =>
          group.resourceGroupId === activeAircraft.resourceGroupId &&
          ["QUEUED", "PRESENT", "MISSING"].includes(group.status),
      )
    : [];
  const {
    assignmentReady,
    pilotChangeAllowed,
    primaryDisabled,
    requiresAvailableReset,
    secondaryAllowed,
    unavailableAllowed,
  } = assistActionAvailability({
    activeAircraft,
    activeRotation,
    assignedRotation,
    board,
    canAssignPilot,
  });
  const turnaroundActionAllowed = activeRotation?.status === "LANDED";
  const primaryPresentation = activeAircraft
    ? primaryAircraftActionPresentation(activeAircraft, activeRotation)
    : null;
  const PrimaryActionIcon = primaryPresentation?.Icon;
  const actionBusy =
    releasing || (activeRotation ? Boolean(busyRotationIds?.has(activeRotation.id)) : false);

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
    void dispatchLease.release();
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
    dispatchLease.release,
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
      await dispatchLease.release();
      setClaimError(null);
    } catch (cause) {
      setClaimError(
        cause instanceof Error ? cause.message : "Betreuung konnte nicht beendet werden.",
      );
    } finally {
      setReleasing(false);
    }
  }

  async function runRotationAction(
    action: "primary" | "refueling" | "paused" | "inactive",
    rotation: Rotation,
    nextAircraftState?: TurnaroundNextState,
  ) {
    setPendingRotationAction(action);
    try {
      await onRunRotation(rotation, nextAircraftState);
    } finally {
      setPendingRotationAction(null);
    }
  }

  async function runAircraftStateAction(
    action: "primary" | "refueling" | "inactive",
    state: FlightLineFleetState,
  ) {
    if (!activeAircraft) return;
    setPendingRotationAction(action);
    try {
      await onSetAircraftState(activeAircraft.id, state);
    } finally {
      setPendingRotationAction(null);
    }
  }

  async function runPrimary() {
    if (!activeAircraft) return;
    if (requiresAvailableReset) {
      return runAircraftStateAction("primary", "AVAILABLE");
    }
    if (activeRotation?.status === "DRAFT") {
      setAssignmentOpen(true);
      await onReserveAssignment(activeAircraft.id);
      return;
    }
    if (activeRotation) {
      return runRotationAction(
        "primary",
        activeRotation,
        activeRotation.status === "LANDED" ? "AVAILABLE" : undefined,
      );
    }
  }

  const takeoverDialog = (
    <ConfirmationDialog
      body={
        takeoverClaim
          ? `Das Flugzeug wird derzeit von ${takeoverClaim.ownerLoginCode} betreut. Möchtest du die Übernahme wirklich überschreiben?`
          : ""
      }
      cancelLabel="Abbrechen"
      confirmLabel="Trotzdem übernehmen"
      confirmBusy={claimingAircraftId === takeoverClaim?.aircraftId}
      onCancel={() => setTakeoverClaim(null)}
      onConfirm={() => void takeover()}
      open={takeoverClaim !== null}
      title="Flugzeug bereits übernommen"
    />
  );

  if (!activeAircraft) {
    return (
      <>
        <AircraftSelection
          aircraft={availableAircraft}
          assistClaims={assistClaims}
          board={board}
          claimingAircraftId={claimingAircraftId}
          onClaim={claim}
          onRefresh={refreshAircraftList}
          onShowMore={() => setVisibleAircraftCount((current) => current + 5)}
          refreshing={refreshing}
          visibleAircraftCount={visibleAircraftCount}
        />
        {takeoverDialog}
      </>
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
              </div>
              <span className="assist-v15-aircraft-meta">
                <span>{activeAircraft.passengerSeats} Plätze</span>
                <span>·</span>
                <span>{activeAircraft.resourceGroupName}</span>
              </span>
            </div>
            <div className="assist-v15-active-tools">
              <span className="assist-v15-pilot-code">
                <PilotIcon aria-hidden="true" />
                <strong>{activeAircraft.currentPilotOperationalCode ?? "–"}</strong>
              </span>
              {pilotChangeAllowed ? (
                <IconButton
                  disabled={releasing}
                  label={`Pilot für ${activeAircraft.registration} wechseln`}
                  onClick={() => setPilotOpen(true)}
                  size="compact"
                >
                  <PilotChangeIcon aria-hidden="true" />
                </IconButton>
              ) : null}
            </div>
            <Button
              aria-label="Flugzeug freigeben"
              className="assist-v15-release"
              busy={releasing}
              onClick={() => void finishClaim()}
              size="compact"
              variant="danger"
            >
              <UnlockKeyhole aria-hidden="true" />{" "}
              <span className="assist-v15-release-label">Flugzeug freigeben</span>
            </Button>
          </div>
        </Panel>

        <Panel className="assist-v15-actions" padding="compact">
          <div aria-busy={releasing} className="assist-v15-action-bar">
            <IconButton
              label={primaryAircraftActionLabel(
                activeAircraft,
                activeRotation,
                "Belegung bestätigen & Boarding starten",
              )}
              className="assist-v15-primary-action"
              disabled={primaryDisabled || actionBusy}
              busy={pendingRotationAction === "primary"}
              onClick={runPrimary}
              size="touch"
            >
              {PrimaryActionIcon ? <PrimaryActionIcon aria-hidden="true" /> : null}
              <span className="assist-v15-primary-label">
                {primaryPresentation?.shortLabel ?? "Keine Aktion"}
              </span>
            </IconButton>
            <fieldset className="assist-v15-secondary-actions" aria-label="Flugzeugstatus">
              <IconButton
                aria-pressed={activeAircraft.operationalState === "REFUELING"}
                className="flight-line-status-action state-refueling"
                disabled={(!secondaryAllowed && !turnaroundActionAllowed) || actionBusy}
                label="Tanken"
                onClick={async () => {
                  if (turnaroundActionAllowed && activeRotation) {
                    await runRotationAction("refueling", activeRotation, "REFUELING");
                  } else {
                    await runAircraftStateAction("refueling", "REFUELING");
                  }
                }}
                size="touch"
                busy={pendingRotationAction === "refueling"}
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
                    void runRotationAction("paused", activeRotation, "PAUSED");
                  } else {
                    onPause(activeAircraft.id);
                  }
                }}
                size="touch"
                busy={pendingRotationAction === "paused"}
              >
                <Coffee aria-hidden="true" />
              </IconButton>
              <IconButton
                aria-pressed={["INACTIVE", "INTERRUPTED"].includes(activeAircraft.operationalState)}
                className="flight-line-status-action state-inactive"
                disabled={!unavailableAllowed || actionBusy}
                label="Nicht verfügbar"
                onClick={async () => {
                  if (turnaroundActionAllowed && activeRotation) {
                    await runRotationAction("inactive", activeRotation, "INACTIVE");
                  } else {
                    await runAircraftStateAction("inactive", "INACTIVE");
                  }
                }}
                size="touch"
                busy={pendingRotationAction === "inactive"}
              >
                <CircleX aria-hidden="true" />
              </IconButton>
            </fieldset>
          </div>
        </Panel>

        <Panel className="assist-v15-rotation-panel" padding="compact">
          <Tabs
            items={[
              { value: "current", label: "Aktuell" },
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
                rotation={assignedRotation}
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
        dispatchLease={dispatchLease}
        groups={waitingGroups}
        onClose={() => {
          setAssignmentOpen(false);
          void dispatchLease.release();
        }}
        onConfirm={async (queueDeviationReason) => {
          if (
            activeRotation &&
            (await onRunRotation(activeRotation, undefined, queueDeviationReason))
          ) {
            setAssignmentOpen(false);
          }
        }}
        onDefer={onGroupDefer}
        onRecall={onGroupRecall}
        onRecallClear={onGroupRecallClear}
        onReserveRecommendation={async () => {
          if (activeAircraft) await onReserveAssignment(activeAircraft.id);
        }}
        onToggle={onToggleGroup}
        open={assignmentOpen}
        selectedQueueGroupIds={selectedQueueGroupIds}
        timeZone={board.event.timeZone}
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
      {takeoverDialog}
    </section>
  );
}
