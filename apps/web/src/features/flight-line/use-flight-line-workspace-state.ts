import type { OperationBoard } from "@rundflug/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { useActionMessageBridge } from "../../app/PageNotifications";
import { useDispatchRecommendationLease } from "../../dispatch-recommendation-lease";
import {
  checkedInCount,
  eligibleMoveTargets,
  replacementSuggestion,
} from "../../operational-exceptions";
import {
  operationalSummaryPresentation,
  queuedSegmentTicketCount,
} from "./FlightLineViewPresentation";

type TurnaroundNextState = "AVAILABLE" | "REFUELING" | "PAUSED" | "INACTIVE";
type OperationsSection = "operations" | "plan" | "resources";

interface WorkspaceStateOptions {
  assistMode: boolean;
  board: OperationBoard | null | undefined;
  deviceId: string;
  deviceToken: string;
  eventId: string;
  refreshAndGet: (version?: number, force?: boolean) => Promise<OperationBoard | null | undefined>;
}

export function useFlightLineWorkspaceState(options: WorkspaceStateOptions) {
  const { assistMode, board, deviceId, deviceToken, eventId, refreshAndGet } = options;
  const [selectedAircraftId, setSelectedAircraftId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  useActionMessageBridge(message, setMessage);
  const [queueReason, setQueueReason] = useState("");
  const [callDeviationReason, setCallDeviationReason] = useState("");
  const [operationsSection, setOperationsSection] = useState<OperationsSection | null>(null);
  const [operationsBusy, setOperationsBusy] = useState(false);
  const [filteredResourceGroupId, setFilteredResourceGroupId] = useState("");
  const [nextAircraftId, setNextAircraftId] = useState("");
  const [turnaroundNextState, setTurnaroundNextState] = useState<TurnaroundNextState>("AVAILABLE");
  const [busyRotationIds, setBusyRotationIds] = useState<ReadonlySet<string>>(() => new Set());
  const busyRotationIdsRef = useRef(new Set<string>());
  const [selectedQueueGroupIds, setSelectedQueueGroupIds] = useState<string[]>([]);
  const [dispositionOpen, setDispositionOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [dispositionCapacity, setDispositionCapacity] = useState(1);
  const [moveTargetId, setMoveTargetId] = useState("");
  const [moveReason, setMoveReason] = useState("");
  const [aircraftPauseOpen, setAircraftPauseOpen] = useState(false);
  const [technicalAbort, setTechnicalAbort] = useState<{
    rotationId: string;
    rotationVersion: number;
    aircraftId: string;
    aircraftVersion: number;
  } | null>(null);
  const [technicalAbortReason, setTechnicalAbortReason] = useState("");

  const dispatchLease = useDispatchRecommendationLease({
    eventId,
    deviceId,
    deviceToken,
    expectedVersion: board?.event.version ?? 0,
    onReserved: useCallback((groupIds: string[]) => setSelectedQueueGroupIds([...groupIds]), []),
  });
  const reloadLatestAssignment = useCallback(
    async (aircraftId: string) => {
      setSelectedQueueGroupIds([]);
      const refreshedBoard = await refreshAndGet(board?.event.version ?? 0, true);
      return dispatchLease.reloadLatest(
        aircraftId,
        refreshedBoard?.event.version ?? board?.event.version ?? 0,
      );
    },
    [board?.event.version, dispatchLease.reloadLatest, refreshAndGet],
  );
  useEffect(() => {
    if (dispatchLease.mode !== "RESERVED" || !dispatchLease.lease || !board) return;
    const groups = new Map(board.queueGroups.map((group) => [group.id, group]));
    if (
      dispatchLease.lease.groupIds.some(
        (groupId) => !groups.get(groupId) || groups.get(groupId)?.dispatchReservation === "OTHER",
      )
    ) {
      dispatchLease.markInvalidated();
    }
  }, [board, dispatchLease.lease, dispatchLease.markInvalidated, dispatchLease.mode]);

  const operationalRotations =
    board?.rotations.filter((rotation) => rotation.status !== "COMPLETED") ?? [];
  const operationalAircraft = board?.aircraft ?? [];
  const canManageAircraft = ["FLIGHT_DIRECTOR", "ADMIN"].includes(board?.currentDeviceRole ?? "");
  const resourceGroup = board?.resourceGroups.find((group) => group.id === filteredResourceGroupId);
  const { summary: operationalSummary, tone: operationalSummaryTone } =
    operationalSummaryPresentation(board, resourceGroup);
  const claimedAircraftId = board?.assistClaims?.find(
    (claim) => claim.claimedByCurrentOperator,
  )?.aircraftId;
  const selectedAircraft =
    operationalAircraft.find(
      (aircraft) => aircraft.id === (selectedAircraftId ?? claimedAircraftId),
    ) ?? (assistMode ? undefined : operationalAircraft[0]);
  const aircraftRotations = operationalRotations.filter((rotation) => {
    if (!selectedAircraft) return false;
    if (rotation.aircraftId) return rotation.aircraftId === selectedAircraft.id;
    const product = board?.products.find((entry) => entry.code === rotation.productCode);
    return (
      rotation.status === "DRAFT" &&
      selectedAircraft.operationalState === "AVAILABLE" &&
      product?.resourceGroupId === selectedAircraft.resourceGroupId &&
      rotation.ticketCount <= selectedAircraft.passengerSeats
    );
  });
  const selected =
    aircraftRotations.find((rotation) => rotation.id === selectedId) ?? aircraftRotations[0];
  const compatibleQueueGroups =
    board?.queueGroups.filter(
      (group) =>
        group.resourceGroupId === selectedAircraft?.resourceGroupId &&
        ["QUEUED", "PRESENT", "MISSING"].includes(group.status),
    ) ?? [];
  const selectedGroups = compatibleQueueGroups.filter((group) =>
    selectedQueueGroupIds.includes(group.id),
  );
  const selectedQueueProductId = selectedGroups[0]?.productId ?? null;
  const earliestSequence = selectedGroups.length
    ? Math.min(...selectedGroups.map((group) => group.queueSequence))
    : null;
  const skippedEarlierProductGroups =
    earliestSequence === null
      ? []
      : compatibleQueueGroups.filter(
          (group) =>
            group.queueSequence < earliestSequence &&
            group.productId !== selectedQueueProductId &&
            group.status !== "MISSING",
        );

  useEffect(() => {
    if (assistMode) {
      if (claimedAircraftId && selectedAircraftId !== claimedAircraftId)
        setSelectedAircraftId(claimedAircraftId);
    } else if (!selectedAircraftId && operationalAircraft[0])
      setSelectedAircraftId(operationalAircraft[0].id);
  }, [assistMode, claimedAircraftId, operationalAircraft, selectedAircraftId]);
  useEffect(() => {
    if (selected?.status === "DRAFT")
      setNextAircraftId(selectedAircraft?.id ?? selected.suggestedAircraftId ?? "");
  }, [selected?.status, selected?.suggestedAircraftId, selectedAircraft?.id]);
  useEffect(() => {
    setDispositionCapacity(selected?.usableCapacity ?? 1);
    setMoveTargetId("");
    setMoveReason("");
  }, [selected?.usableCapacity]);

  return {
    aircraftPauseOpen,
    aircraftRotations,
    busyRotationIds,
    busyRotationIdsRef,
    callDeviationReason,
    canManageAircraft,
    compatibleQueueGroups,
    detailsOpen,
    dispatchLease,
    dispositionCapacity,
    dispositionOpen,
    missingTickets:
      selected?.tickets.filter((ticket) => ticket.attendanceStatus !== "CHECKED_IN") ?? [],
    moveReason,
    moveTargetId,
    moveTargets: selected ? eligibleMoveTargets(selected, operationalRotations) : [],
    nextAircraftId,
    noShowReady: Boolean(
      selected?.status === "CALLED" &&
        selected.calledAt &&
        board &&
        Date.now() - Date.parse(selected.calledAt) >= board.event.noShowAfterMinutes * 60_000,
    ),
    operationalAircraft,
    operationalRotations,
    operationalSummary,
    operationalSummaryTone,
    operationsBusy,
    operationsSection,
    presentCount: selected ? checkedInCount(selected) : 0,
    queueDeviationReasonRequired: skippedEarlierProductGroups.length > 0,
    queueReason,
    reloadLatestAssignment,
    replacement: selected ? replacementSuggestion(selected, operationalRotations) : null,
    selected,
    selectedAircraft,
    selectedQueueGroupIds,
    selectedQueueProductId,
    selectedQueueSeatCount: compatibleQueueGroups
      .filter((group) => selectedQueueGroupIds.includes(group.id))
      .reduce((sum, group) => sum + queuedSegmentTicketCount(group), 0),
    skippedEarlierProductGroups,
    technicalAbort,
    technicalAbortReason,
    turnaroundNextState,
    setAircraftPauseOpen,
    setBusyRotationIds,
    setCallDeviationReason,
    setDetailsOpen,
    setDispositionCapacity,
    setDispositionOpen,
    setFilteredResourceGroupId,
    setMessage,
    setMoveReason,
    setMoveTargetId,
    setOperationsBusy,
    setOperationsSection,
    setQueueReason,
    setSelectedAircraftId,
    setSelectedId,
    setSelectedQueueGroupIds,
    setTechnicalAbort,
    setTechnicalAbortReason,
    setTurnaroundNextState,
  };
}
