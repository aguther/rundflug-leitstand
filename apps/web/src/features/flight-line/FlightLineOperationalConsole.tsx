import type { ForecastHistory, OperationBoard } from "@rundflug/contracts";
import type { ComponentProps } from "react";
import { claimFlightLineAircraft, releaseFlightLineAircraft } from "../../api";
import type { DispatchRecommendationLeaseController } from "../../dispatch-recommendation-lease";
import { FlightLineAssist } from "../../flight-line-assist";
import { FlightLineSupervisorConsole } from "../../flight-line-supervisor";

type Aircraft = OperationBoard["aircraft"][number];
type Rotation = OperationBoard["rotations"][number];
type TurnaroundNextState = "AVAILABLE" | "REFUELING" | "PAUSED" | "INACTIVE";
type SupervisorProps = ComponentProps<typeof FlightLineSupervisorConsole>;

interface FlightLineOperationalConsoleProps {
  assistMode: boolean;
  board: OperationBoard | null | undefined;
  busyRotationIds: ReadonlySet<string>;
  canManageAircraft: boolean;
  deviceId: string;
  deviceToken: string;
  dispatchLease: DispatchRecommendationLeaseController;
  eventId: string;
  loadForecastHistory: (rotationId: string) => Promise<ForecastHistory["entries"]>;
  loadResourceHistory: ReturnType<typeof import("../../api").getResourceDayHistory> extends Promise<
    infer Result
  >
    ? (scopeType: "AIRCRAFT" | "PILOT", scopeId: string) => Promise<Result>
    : never;
  onAssignPilot: (aircraftId: string, pilotId: string, reassign: boolean) => Promise<void>;
  onClearRecall: (ticketGroupId: string, recallId: string) => Promise<void>;
  onDeferGroup: (ticketGroupId: string, reason: string) => Promise<void>;
  onOpenOperations: (section: "operations" | "plan" | "resources") => void;
  onPauseAircraft: (aircraftId?: string) => void;
  onRefresh: () => Promise<void>;
  onResourceGroupChange: (resourceGroupId: string) => void;
  onReserveAssignment: SupervisorProps["onReserveAssignment"];
  onRunRotation: (
    rotation?: Rotation,
    aircraft?: Aircraft,
    nextState?: TurnaroundNextState,
    reason?: string,
  ) => Promise<boolean>;
  onSelectAircraft: (aircraftId: string, supervisor: boolean) => void;
  onSetAircraftState: (
    aircraftId: string,
    state: "AVAILABLE" | "REFUELING" | "PAUSED" | "INACTIVE",
  ) => Promise<void>;
  onStartRecall: (ticketGroupId: string) => Promise<void>;
  onToggleGroup: (ticketGroupId: string, selected: boolean, selectRotation: boolean) => void;
  operationalSummary: string;
  operationalSummaryTone: "critical" | "warning" | "notice" | "normal";
  selectedAircraft: Aircraft | null | undefined;
  selectedGroupIds: string[];
  turnaroundNextState: TurnaroundNextState;
}

export function FlightLineOperationalConsole(props: FlightLineOperationalConsoleProps) {
  const {
    assistMode,
    board,
    busyRotationIds,
    canManageAircraft,
    deviceId,
    deviceToken,
    dispatchLease,
    eventId,
    loadForecastHistory,
    loadResourceHistory,
    onAssignPilot,
    onClearRecall,
    onDeferGroup,
    onOpenOperations,
    onPauseAircraft,
    onRefresh,
    onResourceGroupChange,
    onReserveAssignment,
    onRunRotation,
    onSelectAircraft,
    onSetAircraftState,
    onStartRecall,
    onToggleGroup,
    operationalSummary,
    operationalSummaryTone,
    selectedAircraft,
    selectedGroupIds,
    turnaroundNextState,
  } = props;
  if (!board) return null;
  const aircraft = board.aircraft;
  if (assistMode) {
    return (
      <FlightLineAssist
        aircraft={aircraft}
        board={board}
        busyRotationIds={busyRotationIds}
        canAssignPilot={canManageAircraft}
        dispatchLease={dispatchLease}
        onAssignPilot={onAssignPilot}
        onClaim={async (aircraftId, expectedTakeoverRevision) => {
          await claimFlightLineAircraft(
            eventId,
            aircraftId,
            deviceId,
            deviceToken,
            expectedTakeoverRevision,
          );
          await onRefresh();
        }}
        onClaimUnavailable={() => onSelectAircraft("", false)}
        onGroupRecall={onStartRecall}
        onGroupRecallClear={onClearRecall}
        onGroupDefer={(ticketGroupId) =>
          onDeferGroup(ticketGroupId, "Gruppe durch Flight Line zurückgestellt")
        }
        onToggleGroup={(ticketGroupId, selected) => onToggleGroup(ticketGroupId, selected, true)}
        onPause={onPauseAircraft}
        onRefresh={onRefresh}
        onRelease={async (aircraftId) => {
          await releaseFlightLineAircraft(eventId, aircraftId, deviceId, deviceToken);
          onSelectAircraft("", false);
          await onRefresh();
        }}
        onSelectAircraft={(aircraftId) => onSelectAircraft(aircraftId, false)}
        onRunRotation={(rotation, nextState, reason) => {
          const rotationAircraft =
            aircraft.find((entry) => entry.id === rotation.aircraftId) ?? selectedAircraft;
          return onRunRotation(rotation, rotationAircraft ?? undefined, nextState, reason);
        }}
        onReserveAssignment={onReserveAssignment}
        onSetAircraftState={onSetAircraftState}
        selectedQueueGroupIds={selectedGroupIds}
      />
    );
  }
  return (
    <FlightLineSupervisorConsole
      aircraft={aircraft}
      board={board}
      deviceId={deviceId}
      deviceToken={deviceToken}
      busyRotationIds={busyRotationIds}
      canManageOperations={canManageAircraft}
      dispatchLease={dispatchLease}
      operationalSummary={operationalSummary}
      operationalSummaryTone={operationalSummaryTone}
      loadForecastHistory={loadForecastHistory}
      loadResourceHistory={loadResourceHistory}
      onOpenOperations={onOpenOperations}
      onResourceGroupChange={onResourceGroupChange}
      selectedQueueGroupIds={selectedGroupIds}
      onAssignPilot={onAssignPilot}
      onConfirmAssignment={(reason) =>
        onRunRotation(undefined, undefined, turnaroundNextState, reason)
      }
      onRunRotation={(rotation, nextState) => {
        const rotationAircraft = aircraft.find((entry) => entry.id === rotation.aircraftId);
        return onRunRotation(rotation, rotationAircraft, nextState);
      }}
      onPauseAircraft={onPauseAircraft}
      onGroupRecall={onStartRecall}
      onGroupRecallClear={onClearRecall}
      onGroupDefer={(ticketGroupId) =>
        onDeferGroup(ticketGroupId, "Gruppe durch Flight Director zurückgestellt")
      }
      onSetAircraftState={onSetAircraftState}
      onSelectAircraft={(aircraftId) => onSelectAircraft(aircraftId, true)}
      onReserveAssignment={onReserveAssignment}
      onToggleGroup={(ticketGroupId, selected) => onToggleGroup(ticketGroupId, selected, false)}
      selectedAircraft={selectedAircraft ?? undefined}
    />
  );
}
