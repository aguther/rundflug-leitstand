import type { OperationBoard } from "@rundflug/contracts";
import type { useDispatchRecommendationLease } from "../../dispatch-recommendation-lease";
import { compareTechnicalStrings } from "../../technical-order";
import { operationalTimeLabel } from "../operations/operation-labels";

type Rotation = OperationBoard["rotations"][number];
type Aircraft = OperationBoard["aircraft"][number];
type QueueGroup = OperationBoard["queueGroups"][number];
type PlannedOperation = OperationBoard["plannedOperations"][number];

export function queuedSegmentTicketCount(group: QueueGroup): number {
  return group.nextSegmentTicketCount ?? group.ticketCount;
}

function queuedSegmentPresentCount(group: QueueGroup): number {
  return group.nextSegmentPresentCount ?? group.presentCount;
}

type OperationalSummaryTone = "critical" | "warning" | "notice" | "normal" | "neutral";

export function operationalSummaryPresentation(
  board: OperationBoard | null | undefined,
  resourceGroup: OperationBoard["resourceGroups"][number] | undefined,
): { summary: string; tone: OperationalSummaryTone } {
  if (!board) return { summary: "Stand wird geladen", tone: "neutral" };
  if (board.event.emergencyMode) return { summary: "Not-Halt aktiv", tone: "critical" };
  if (board.event.status === "PREPARATION") {
    return { summary: "Betrieb nicht freigegeben", tone: "warning" };
  }
  if (board.event.status === "CLOSED") {
    return { summary: "Betrieb geschlossen", tone: "neutral" };
  }
  if (board.event.status === "ARCHIVED") {
    return { summary: "Veranstaltung archiviert", tone: "neutral" };
  }
  if (board.event.operationalInterrupted) {
    return { summary: "Betrieb unterbrochen", tone: "warning" };
  }
  const notice = board.event.operationalNote || resourceGroup?.operationalNote;
  if (notice) return { summary: notice, tone: "notice" };
  return { summary: "Betrieb normal", tone: "normal" };
}

export function rotationTicketGroupIds(
  selectedQueueGroupIds: string[],
  rotation: Rotation,
): string[] {
  if (selectedQueueGroupIds.length > 0) return selectedQueueGroupIds;
  if (rotation.bookingGroups.length > 0) {
    return rotation.bookingGroups.map((group) => group.id);
  }
  return [rotation.ticketGroupId];
}

export function callNextRecommendationPayload(
  dispatchLease: ReturnType<typeof useDispatchRecommendationLease>,
  ticketGroupIds: string[],
) {
  if (dispatchLease.mode !== "RESERVED" || !dispatchLease.lease) return null;
  if (dispatchLease.lease.groupIds.length !== ticketGroupIds.length) return null;
  const selectedIds = [...ticketGroupIds].sort(compareTechnicalStrings);
  const leaseMatches = [...dispatchLease.lease.groupIds]
    .sort(compareTechnicalStrings)
    .every((groupId, index) => groupId === selectedIds[index]);
  if (!leaseMatches) return null;
  return {
    recommendation: {
      planRevision: dispatchLease.lease.planRevision,
      batchId: dispatchLease.lease.batchId,
    },
    leaseId: dispatchLease.lease.leaseId,
  };
}

export function plannedAircraftState(
  plan: PlannedOperation,
  activate: boolean,
): "AVAILABLE" | "REFUELING" | "PAUSED" | "INTERRUPTED" {
  if (!activate) return "AVAILABLE";
  if (plan.kind === "REFUELING") return "REFUELING";
  if (plan.kind === "PAUSE") return "PAUSED";
  return "INTERRUPTED";
}

export function plannedResourceGroupStatus(
  plan: PlannedOperation,
  activate: boolean,
): "ACTIVE" | "PAUSED" | "INTERRUPTED" {
  if (!activate) return "ACTIVE";
  return plan.kind === "PAUSE" ? "PAUSED" : "INTERRUPTED";
}

export function QueueGroupPassengerSummary({ group }: Readonly<{ group: QueueGroup }>) {
  const segmentCount = queuedSegmentTicketCount(group);
  const personLabel = segmentCount === 1 ? "Person" : "Personen";
  return (
    <small>
      {group.segmentCount && group.segmentCount > 1 ? (
        <>
          {segmentCount} von {group.ticketCount} Personen · Teil {group.segmentIndex ?? 1}/
          {group.segmentCount} ·{" "}
        </>
      ) : (
        <>
          {segmentCount} {personLabel} ·{" "}
        </>
      )}
      {queuedSegmentPresentCount(group)}/{segmentCount} anwesend
    </small>
  );
}

export function LegacyAircraftActions({
  aircraft,
  canManageAircraft,
  onPause,
  onSetState,
}: Readonly<{
  aircraft: Aircraft;
  canManageAircraft: boolean;
  onPause: () => void;
  onSetState: (state: "AVAILABLE" | "REFUELING" | "INACTIVE") => void;
}>) {
  if (!canManageAircraft) {
    return <span>Flottenstatus wird durch die Flight-Line-Leitung gesteuert.</span>;
  }
  if (aircraft.operationalState === "AVAILABLE") {
    return (
      <>
        <button onClick={onPause} type="button">
          Pause
        </button>
        <button onClick={() => onSetState("REFUELING")} type="button">
          Tanken
        </button>
        <button onClick={() => onSetState("INACTIVE")} type="button">
          Herausnehmen
        </button>
      </>
    );
  }
  if (["PAUSED", "REFUELING", "INACTIVE", "INTERRUPTED"].includes(aircraft.operationalState)) {
    return (
      <button className="primary-action" onClick={() => onSetState("AVAILABLE")} type="button">
        Wieder verfügbar
      </button>
    );
  }
  return null;
}

export function RotationOvertimeNotice({
  rotation,
  timeZone,
}: Readonly<{ rotation: Rotation; timeZone: string }>) {
  if (!rotation.timeline.extendsBeyondOperationsEnd) return null;
  return (
    <output className="rotation-timeline-overtime">
      Voraussichtlicher Abschluss nach Betriebsende:{" "}
      {operationalTimeLabel(rotation.timeline.predicted.completionAt, timeZone)} · +
      {rotation.timeline.overtimeMinutes} Min.
    </output>
  );
}
