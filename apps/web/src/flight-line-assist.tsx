import type { OperationBoard } from "@rundflug/contracts";
import {
  Ban,
  BellRing,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Fuel,
  MapPin,
  MoreHorizontal,
  Pause,
  Plane,
  RefreshCw,
  RotateCcw,
  UnlockKeyhole,
  UserCheck,
  Users,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Button, IconButton, PageHeader, Panel, StatusPill } from "./design-system/components";

type Aircraft = OperationBoard["aircraft"][number];
type Rotation = OperationBoard["rotations"][number];
type QueueGroup = OperationBoard["queueGroups"][number];

type AssistAction = {
  label: string;
  command: "CALL_NEXT" | "MARK_OFF_BLOCK" | "MARK_ON_BLOCK" | "COMPLETE_TURNAROUND";
  disabled: boolean;
  run: () => void;
} | null;

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

function assistState(aircraft: Aircraft, rotation: Rotation | undefined) {
  if (aircraft.operationalState === "REFUELING") return { key: "refueling", label: "Tanken" };
  if (aircraft.operationalState === "PAUSED") return { key: "paused", label: "Pause" };
  if (["INACTIVE", "INTERRUPTED"].includes(aircraft.operationalState)) {
    return { key: "unavailable", label: "Nicht verfügbar" };
  }
  if (rotation?.status === "IN_FLIGHT" || aircraft.operationalState === "IN_FLIGHT") {
    return { key: "in-flight", label: "Off-Block" };
  }
  if (rotation?.status === "LANDED" || aircraft.operationalState === "LANDED") {
    return { key: "on-block", label: "On-Block" };
  }
  if (rotation?.status === "CALLED" || aircraft.operationalState === "BOARDING") {
    return { key: "boarding", label: "Boarding" };
  }
  return { key: "ready", label: "Verfügbar" };
}

function groupLabel(group: QueueGroup) {
  return `${group.productCode}-${String(group.communicationNumber).padStart(3, "0")}`;
}

function stateTone(key: string): "success" | "warning" | "danger" | "info" | "neutral" {
  if (["ready", "on-block"].includes(key)) return "success";
  if (["paused", "refueling"].includes(key)) return "warning";
  if (key === "unavailable") return "danger";
  if (["boarding", "in-flight"].includes(key)) return "info";
  return "neutral";
}

function StateFlow({ activeKey }: { activeKey: string }) {
  const steps = [
    { key: "on-block", label: "On-Block", Icon: CheckCircle2 },
    { key: "deboarding", label: "Ausstieg", Icon: Users },
    { key: "ready", label: "Verfügbar", Icon: UserCheck },
    { key: "refueling", label: "Tanken", Icon: Fuel },
    { key: "paused", label: "Pause", Icon: Pause },
    { key: "unavailable", label: "Nicht verfügbar", Icon: Ban },
  ];
  return (
    <ol aria-label="Turnaround und nächster Flugzeugzustand" className="assist-v15-state-flow">
      {steps.map(({ key, label, Icon }, index) => (
        <li className={`assist-v15-state-segment assist-v15-state-${key}`} key={key}>
          <div className={`assist-v15-state-step ${key === activeKey ? "is-active" : ""}`}>
            <Icon aria-hidden="true" />
            <span>{label}</span>
          </div>
          {index < steps.length - 1 ? <ChevronRight aria-hidden="true" /> : null}
        </li>
      ))}
    </ol>
  );
}

function AircraftMeta({
  aircraft,
  rotation,
}: {
  aircraft: Aircraft;
  rotation: Rotation | undefined;
}) {
  return (
    <span className="assist-v15-aircraft-meta">
      <span>{aircraft.passengerSeats} Plätze</span>
      <span>·</span>
      <span>{rotation?.communicationLabel ?? "Keine Gruppe"}</span>
      <span>·</span>
      <span className="assist-v15-gate">
        <MapPin aria-hidden="true" />
        {rotation?.gateLabel ?? aircraft.resourceGroupName}
      </span>
    </span>
  );
}

function AircraftPickerMeta({
  aircraft,
  rotation,
  state,
}: {
  aircraft: Aircraft;
  rotation: Rotation | undefined;
  state: ReturnType<typeof assistState>;
}) {
  return (
    <div className="assist-v15-picker-meta">
      <StatusPill className="assist-v15-operational-state" tone={stateTone(state.key)}>
        {state.label}
      </StatusPill>
      <span>
        {rotation?.communicationLabel ?? "Keine Gruppe"} · {aircraft.passengerSeats} Plätze
      </span>
      <span className="assist-v15-gate">
        <MapPin aria-hidden="true" />
        {rotation?.gateLabel ?? aircraft.resourceGroupName}
      </span>
    </div>
  );
}

function LifecycleFlow({ activeKey }: { activeKey: string }) {
  const steps = ["Boarding", "Off-Block", "On-Block", "Verfügbar"];
  const normalized =
    activeKey === "in-flight"
      ? "Off-Block"
      : activeKey === "on-block"
        ? "On-Block"
        : ["ready", "refueling", "paused", "unavailable"].includes(activeKey)
          ? "Verfügbar"
          : "Boarding";
  return (
    <div className="assist-v15-lifecycle">
      {steps.map((step, index) => (
        <div className="assist-v15-lifecycle-segment" key={step}>
          <span className={step === normalized ? "is-active" : ""}>{step}</span>
          {index < steps.length - 1 ? <ChevronRight aria-hidden="true" /> : null}
        </div>
      ))}
    </div>
  );
}

export function FlightLineAssist({
  board,
  aircraft,
  action,
  message,
  onSelectAircraft,
  onPause,
  onRefuel,
  onUnavailable,
  onClaim,
  onGroupAttendance,
  onGroupMissing,
  onGroupRecall,
  onGroupDefer,
  onToggleGroup,
  onRelease,
  selectedQueueGroupIds,
  turnaroundNextState,
  onTurnaroundNextStateChange,
}: {
  board: OperationBoard;
  aircraft: Aircraft[];
  action: AssistAction;
  message: string | null;
  onSelectAircraft: (aircraftId: string) => void;
  onPause: () => void;
  onRefuel: () => void;
  onUnavailable: () => void;
  onClaim: (aircraftId: string) => Promise<void>;
  onGroupAttendance: (ticketGroupId: string, checkedIn: boolean) => void;
  onGroupMissing: (ticketGroupId: string) => void;
  onGroupRecall: (ticketGroupId: string) => void;
  onGroupDefer: (ticketGroupId: string) => void;
  onToggleGroup: (ticketGroupId: string, selected: boolean) => void;
  onRelease: (aircraftId: string) => Promise<void>;
  selectedQueueGroupIds: string[];
  turnaroundNextState: "AVAILABLE" | "REFUELING" | "PAUSED" | "INACTIVE";
  onTurnaroundNextStateChange: (state: "AVAILABLE" | "REFUELING" | "PAUSED" | "INACTIVE") => void;
}) {
  const assistClaims = board.assistClaims ?? [];
  const ownServerClaim = assistClaims.find((claim) => claim.claimedByCurrentSession);
  const [claimedAircraftId, setClaimedAircraftId] = useState<string | null>(
    ownServerClaim?.aircraftId ?? null,
  );
  const [visibleAircraftCount, setVisibleAircraftCount] = useState(5);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [openGroupMenuId, setOpenGroupMenuId] = useState<string | null>(null);
  const availableAircraft = aircraft.filter((entry) => {
    const claim = assistClaims.find((candidate) => candidate.aircraftId === entry.id);
    return !claim || claim.claimedByCurrentSession || entry.id === claimedAircraftId;
  });
  const claimedAircraft = aircraft.find((entry) => entry.id === claimedAircraftId);
  const activeAircraft = claimedAircraft;
  const activeRotation = activeAircraft
    ? rotationForAircraft(activeAircraft, board.rotations, board.products)
    : undefined;
  const activeState = activeAircraft ? assistState(activeAircraft, activeRotation) : null;
  const waitingGroups = activeAircraft
    ? board.queueGroups.filter(
        (group) =>
          group.resourceGroupId === activeAircraft.resourceGroupId &&
          ["QUEUED", "PRESENT", "MISSING"].includes(group.status),
      )
    : [];
  const listedAircraft = availableAircraft;
  const selectedSeatCount = waitingGroups
    .filter((group) => selectedQueueGroupIds.includes(group.id))
    .reduce((sum, group) => sum + group.ticketCount, 0);

  useEffect(() => {
    if (!claimedAircraftId && ownServerClaim) setClaimedAircraftId(ownServerClaim.aircraftId);
  }, [claimedAircraftId, ownServerClaim]);

  useEffect(() => {
    if (!claimedAircraftId) return;
    const renewal = window.setInterval(() => {
      void onClaim(claimedAircraftId).catch(() => setClaimedAircraftId(null));
    }, 25_000);
    return () => window.clearInterval(renewal);
  }, [claimedAircraftId, onClaim]);

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
    try {
      await onRelease(claimedAircraftId);
      setClaimedAircraftId(null);
      setOpenGroupMenuId(null);
      setClaimError(null);
    } catch (cause) {
      setClaimError(
        cause instanceof Error ? cause.message : "Betreuung konnte nicht beendet werden.",
      );
    }
  }

  function runGroupAction(groupId: string, callback: (ticketGroupId: string) => void) {
    callback(groupId);
    setOpenGroupMenuId(null);
  }

  function renderGroup(group: QueueGroup) {
    const selected = selectedQueueGroupIds.includes(group.id);
    const capacityExceeded =
      !selected && selectedSeatCount + group.ticketCount > (activeAircraft?.passengerSeats ?? 0);
    return (
      <div className={`assist-v15-group-row ${selected ? "is-selected" : ""}`} key={group.id}>
        <label className="assist-v15-group-select">
          <input
            checked={selected}
            disabled={group.status === "MISSING" || capacityExceeded}
            onChange={(event) => onToggleGroup(group.id, event.target.checked)}
            type="checkbox"
          />
          <Users aria-hidden="true" />
          <strong>{groupLabel(group)}</strong>
          <StatusPill tone={group.status === "MISSING" ? "danger" : selected ? "info" : "neutral"}>
            {group.ticketCount} {group.ticketCount === 1 ? "Person" : "Personen"}
          </StatusPill>
        </label>
        <span className="assist-v15-presence">
          {group.status === "PRESENT"
            ? "Anwesend"
            : group.status === "MISSING"
              ? "Nicht da"
              : `${group.presentCount}/${group.ticketCount} vor Ort`}
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

  return (
    <section className={`flight-assist flight-assist-v15 ${claimedAircraft ? "has-claim" : ""}`}>
      {message || claimError ? (
        <p className="assist-v15-message" role="status">
          {claimError ?? message}
        </p>
      ) : null}

      <div className="assist-v15-workspace">
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
            description={
              claimedAircraft
                ? "Betreutes und weitere verfügbare Flugzeuge"
                : "Verfügbare Flugzeuge"
            }
            level={2}
            title="Flugzeug übernehmen"
          />
          <div className="assist-v15-aircraft-list">
            {listedAircraft.slice(0, visibleAircraftCount).map((entry) => {
              const rotation = rotationForAircraft(entry, board.rotations, board.products);
              const state = assistState(entry, rotation);
              const claimed = entry.id === claimedAircraftId;
              return (
                <article className={claimed ? "is-claimed" : ""} key={entry.id}>
                  <span className="assist-v15-plane-icon">
                    <Plane aria-hidden="true" />
                  </span>
                  <div className="assist-v15-aircraft-copy">
                    <div className="assist-v15-aircraft-title">
                      <strong>{entry.registration}</strong>
                      {claimed ? <StatusPill tone="info">Von dir übernommen</StatusPill> : null}
                    </div>
                    <AircraftPickerMeta aircraft={entry} rotation={rotation} state={state} />
                  </div>
                  {!claimed ? (
                    <Button
                      className="assist-v15-claim"
                      onClick={() => void claim(entry)}
                      size="compact"
                      variant="primary"
                    >
                      Übernehmen
                    </Button>
                  ) : null}
                </article>
              );
            })}
          </div>
          {visibleAircraftCount < listedAircraft.length ? (
            <Button
              className="assist-v15-more"
              onClick={() => setVisibleAircraftCount((current) => current + 5)}
              variant="ghost"
            >
              <ChevronDown aria-hidden="true" /> Weitere anzeigen
            </Button>
          ) : null}
        </Panel>

        <div className="assist-v15-active-column">
          <Panel className="assist-v15-aircraft-panel" padding="compact">
            {activeAircraft ? (
              <>
                <div className="assist-v15-active-heading">
                  <span className="assist-v15-plane-icon">
                    <Plane aria-hidden="true" />
                  </span>
                  <div>
                    <div className="assist-v15-active-title">
                      <strong>{activeAircraft.registration}</strong>
                      <StatusPill tone="info">Von dir übernommen</StatusPill>
                    </div>
                    <AircraftMeta aircraft={activeAircraft} rotation={activeRotation} />
                  </div>
                  <Button onClick={() => void finishClaim()} size="compact" variant="danger">
                    <UnlockKeyhole aria-hidden="true" /> Flugzeug freigeben
                  </Button>
                </div>
                <StateFlow activeKey={activeState?.key ?? "ready"} />
              </>
            ) : (
              <div className="assist-v15-empty">
                <Plane aria-hidden="true" />
                <p>Ein Flugzeug auswählen und übernehmen.</p>
              </div>
            )}
          </Panel>

          {claimedAircraft ? (
            <Panel className="assist-v15-groups" padding="compact">
              <PageHeader
                actions={
                  <span className="assist-v15-capacity">
                    <Users aria-hidden="true" /> {selectedSeatCount} von{" "}
                    {activeAircraft?.passengerSeats ?? 0} Plätzen
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
              <div className="assist-v15-command-bar">
                {action?.command === "COMPLETE_TURNAROUND" ? (
                  <fieldset className="assist-v15-turnaround">
                    <legend>Zustand nach Abschluss</legend>
                    {[
                      { state: "AVAILABLE" as const, label: "Verfügbar", Icon: UserCheck },
                      { state: "REFUELING" as const, label: "Tanken", Icon: Fuel },
                      { state: "PAUSED" as const, label: "Pause", Icon: Pause },
                      { state: "INACTIVE" as const, label: "Nicht verfügbar", Icon: Ban },
                    ].map(({ state, label, Icon }) => (
                      <Button
                        aria-pressed={turnaroundNextState === state}
                        key={state}
                        onClick={() => onTurnaroundNextStateChange(state)}
                        size="compact"
                        variant={turnaroundNextState === state ? "secondary" : "ghost"}
                      >
                        <Icon aria-hidden="true" /> {label}
                      </Button>
                    ))}
                  </fieldset>
                ) : null}
                {action ? (
                  <Button
                    disabled={action.disabled}
                    onClick={action.run}
                    size="touch"
                    variant="primary"
                  >
                    <Check aria-hidden="true" /> {action.label}
                  </Button>
                ) : (
                  <Button disabled size="touch" variant="primary">
                    <Check aria-hidden="true" /> Nächste Aktion noch nicht verfügbar
                  </Button>
                )}
                <Button
                  className="assist-v15-release-phone"
                  onClick={() => void finishClaim()}
                  size="touch"
                  variant="danger"
                >
                  <UnlockKeyhole aria-hidden="true" /> Flugzeug freigeben
                </Button>
                {!activeRotation || activeRotation.status === "DRAFT" ? (
                  <div className="assist-v15-follow-up">
                    <span>Anschließende Schritte:</span>
                    <Button onClick={onRefuel} size="compact" variant="ghost">
                      <Fuel aria-hidden="true" /> Tanken
                    </Button>
                    <Button onClick={onPause} size="compact" variant="ghost">
                      <Pause aria-hidden="true" /> Pause
                    </Button>
                    <Button onClick={onUnavailable} size="compact" variant="ghost">
                      <Ban aria-hidden="true" /> Nicht verfügbar
                    </Button>
                  </div>
                ) : null}
                <LifecycleFlow activeKey={activeState?.key ?? "boarding"} />
              </div>
            </Panel>
          ) : null}
        </div>
      </div>
    </section>
  );
}
