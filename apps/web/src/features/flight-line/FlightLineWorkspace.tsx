import type { OperationBoard } from "@rundflug/contracts";
import { useCallback } from "react";
import { AppShell as Shell } from "../../app/AppShell";
import { useOperationIdentity } from "../operations/operation-identity";
import {
  ConnectionNotice,
  EmergencyNotice,
  InterruptionNotice,
  OperationalNotice,
} from "../operations/operation-notices";
import { useOperationBoard } from "../operations/use-operation-board";
import { FlightLineAircraftSelector, FlightLineAircraftSummary } from "./FlightLineAircraftPanel";
import { FlightLineDispositionPanel } from "./FlightLineDispositionPanel";
import { FlightLineLegacyQueue } from "./FlightLineLegacyQueue";
import { FlightLineOperationalConsole } from "./FlightLineOperationalConsole";
import { FlightLineRotationDetails } from "./FlightLineRotationDetails";
import { FlightLineWorkspaceDialogs } from "./FlightLineWorkspaceDialogs";
import { useFlightDirectorOperations } from "./use-flight-director-operations";
import { useFlightDirectorPlanning } from "./use-flight-director-planning";
import { useFlightLineAircraftCommands } from "./use-flight-line-aircraft-commands";
import { useFlightLineDispositionCommands } from "./use-flight-line-disposition-commands";
import { useFlightLineHistory } from "./use-flight-line-history";
import { useFlightLineRotationCommands } from "./use-flight-line-rotation-commands";
import { useFlightLineWorkspaceState } from "./use-flight-line-workspace-state";

const actionForState = {
  DRAFT: { label: "Belegung bestätigen & Boarding starten", command: "CALL_NEXT" },
  CALLED: { label: "Offblock", command: "MARK_OFF_BLOCK" },
  IN_FLIGHT: { label: "Onblock", command: "MARK_ON_BLOCK" },
  LANDED: { label: "Umlauf abschließen", command: "COMPLETE_TURNAROUND" },
  COMPLETED: null,
} as const;

type Rotation = OperationBoard["rotations"][number];
type QueueGroup = OperationBoard["queueGroups"][number];

export function FlightLineWorkspace() {
  const flightLineIdentity = useOperationIdentity("FLIGHT_DIRECTOR", "recovery-flight-lead");
  const { eventId: EVENT_ID, deviceId: FLIGHT_LINE_DEVICE_ID, deviceToken } = flightLineIdentity;
  const deviceTokenFor = useCallback((_deviceId: string) => deviceToken, [deviceToken]);
  const FLIGHT_LINE_ASSIST_MODE = window.location.pathname === "/flight-line";
  const { board, error, lastConfirmedAt, backendConfirmed, confirmEvent, refresh, refreshAndGet } =
    useOperationBoard(flightLineIdentity);
  const state = useFlightLineWorkspaceState({
    assistMode: FLIGHT_LINE_ASSIST_MODE,
    board,
    deviceId: FLIGHT_LINE_DEVICE_ID,
    deviceToken,
    eventId: EVENT_ID,
    refreshAndGet,
  });
  const {
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
    missingTickets,
    moveReason,
    moveTargetId,
    moveTargets,
    nextAircraftId,
    noShowReady,
    operationalAircraft,
    operationalRotations,
    operationalSummary,
    operationalSummaryTone,
    operationsBusy,
    operationsSection,
    presentCount,
    queueDeviationReasonRequired,
    queueReason,
    reloadLatestAssignment,
    replacement,
    selected,
    selectedAircraft,
    selectedQueueGroupIds,
    selectedQueueProductId,
    selectedQueueSeatCount,
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
  } = state;
  const action = selected ? actionForState[selected.status] : null;
  const {
    advance,
    clearTicketGroupRecall,
    setGroupAttendance,
    startTicketGroupRecall,
    updateGroupPresence,
  } = useFlightLineRotationCommands({
    board,
    busyRotationIdsRef,
    callDeviationReason,
    confirmEvent,
    deviceId: FLIGHT_LINE_DEVICE_ID,
    deviceToken: deviceTokenFor(FLIGHT_LINE_DEVICE_ID),
    dispatchLease,
    eventId: EVENT_ID,
    refresh,
    selectedAircraft,
    selectedGroupIds: selectedQueueGroupIds,
    selectedRotation: selected,
    setBusyRotationIds,
    setMessage,
    turnaroundNextState,
  });
  const {
    assignAircraftPilot,
    openAircraftPauseDialog,
    requestAircraftState,
    setFlightLineAircraftState,
    startAircraftPause,
  } = useFlightLineAircraftCommands({
    board,
    confirmEvent,
    deviceId: FLIGHT_LINE_DEVICE_ID,
    deviceToken: deviceTokenFor(FLIGHT_LINE_DEVICE_ID),
    eventId: EVENT_ID,
    operationalAircraft,
    operationalRotations: operationalRotations ?? [],
    refresh,
    selectedAircraft,
    setAircraftPauseOpen,
    setMessage,
    setSelectedAircraftId,
    setTechnicalAbort,
    setTechnicalAbortReason,
  });
  const {
    openOperationsDialog,
    setEventInterruption,
    setEventNotice,
    setResourceGroupStatus,
    setResourceNoticeCommand,
    triggerEmergency,
  } = useFlightDirectorOperations({
    board,
    canManageAircraft,
    deviceId: FLIGHT_LINE_DEVICE_ID,
    deviceToken: deviceTokenFor(FLIGHT_LINE_DEVICE_ID),
    eventId: EVENT_ID,
    refresh,
    setMessage,
    setOperationsBusy,
    setOperationsSection,
  });
  const {
    cancelPlannedOperation,
    confirmPlannedOperation,
    disableRecurringRule,
    upsertPlannedOperation,
    upsertRecurringRule,
  } = useFlightDirectorPlanning({
    board,
    deviceId: FLIGHT_LINE_DEVICE_ID,
    deviceToken: deviceTokenFor(FLIGHT_LINE_DEVICE_ID),
    eventId: EVENT_ID,
    refresh,
    setEventInterruption,
    setMessage,
    setOperationsBusy,
    setResourceGroupStatus,
  });
  const {
    abortRotation,
    abortTechnicalRotation,
    confirmAttendanceDecision,
    deferTicketGroup,
    markTicketNoShow,
    moveTicketGroup,
    mutateQueue,
    revokeCall,
    setAttendance,
    setRotationCapacity,
  } = useFlightLineDispositionCommands({
    board,
    deviceId: FLIGHT_LINE_DEVICE_ID,
    deviceToken: deviceTokenFor(FLIGHT_LINE_DEVICE_ID),
    dispositionCapacity,
    eventId: EVENT_ID,
    noShowReady,
    queueReason,
    refresh,
    selected,
    setDispositionOpen,
    setMessage,
    setMoveReason,
    setQueueReason,
    setSelectedGroupIds: setSelectedQueueGroupIds,
    setSelectedId,
    setTechnicalAbort,
    setTechnicalAbortReason,
    technicalAbort,
    technicalAbortReason,
  });
  const { loadAllForecastHistory, loadResourceHistory } = useFlightLineHistory({
    deviceId: FLIGHT_LINE_DEVICE_ID,
    deviceToken: deviceTokenFor(FLIGHT_LINE_DEVICE_ID),
    eventId: EVENT_ID,
  });

  function toggleLegacyQueueGroup(group: QueueGroup, checked: boolean) {
    setSelectedQueueGroupIds((current) => {
      if (checked) return [...current, group.id];
      return current.filter((id) => id !== group.id);
    });
    if (checked) {
      const rotation = aircraftRotations?.find(
        (entry) =>
          entry.ticketGroupId === group.id ||
          entry.bookingGroups.some((bookingGroup) => bookingGroup.id === group.id),
      );
      if (rotation) setSelectedId(rotation.id);
      return;
    }
    if (selectedQueueGroupIds.length === 1) setCallDeviationReason("");
  }

  function selectLegacyRotation(rotation: Rotation, openDisposition: boolean) {
    setSelectedId(rotation.id);
    setDispositionCapacity(rotation.usableCapacity);
    setMoveTargetId("");
    setMoveReason("");
    if (openDisposition) setDispositionOpen(true);
  }

  return (
    <Shell
      className={FLIGHT_LINE_ASSIST_MODE ? "flight-line-shell assist-shell" : "flight-line-shell"}
      connection={{ backendConfirmed, error, lastConfirmedAt }}
      title={FLIGHT_LINE_ASSIST_MODE ? "Flight Line" : "Flight Director"}
      notifications={
        <>
          <EmergencyNotice active={board?.event.emergencyMode ?? false} />
          <InterruptionNotice active={board?.event.operationalInterrupted ?? false} />
          <ConnectionNotice error={error} lastConfirmedAt={lastConfirmedAt} />
          <OperationalNotice note={board?.event.operationalNote} />
        </>
      }
    >
      <FlightLineOperationalConsole
        assistMode={FLIGHT_LINE_ASSIST_MODE}
        board={board}
        busyRotationIds={busyRotationIds}
        canManageAircraft={canManageAircraft}
        deviceId={FLIGHT_LINE_DEVICE_ID}
        deviceToken={deviceToken}
        dispatchLease={dispatchLease}
        eventId={EVENT_ID}
        loadForecastHistory={loadAllForecastHistory}
        loadResourceHistory={loadResourceHistory}
        onAssignPilot={assignAircraftPilot}
        onClearRecall={clearTicketGroupRecall}
        onDeferGroup={deferTicketGroup}
        onOpenOperations={openOperationsDialog}
        onPauseAircraft={openAircraftPauseDialog}
        onRefresh={refresh}
        onResourceGroupChange={setFilteredResourceGroupId}
        onReserveAssignment={reloadLatestAssignment}
        onRunRotation={advance}
        onSelectAircraft={(aircraftId, supervisor) => {
          setSelectedAircraftId(aircraftId || null);
          setSelectedId(null);
          setSelectedQueueGroupIds([]);
          if (supervisor) {
            setDispositionOpen(false);
            setDetailsOpen(false);
          }
        }}
        onSetAircraftState={requestAircraftState}
        onStartRecall={startTicketGroupRecall}
        onToggleGroup={(ticketGroupId, isSelected, selectRotation) => {
          setSelectedQueueGroupIds((current) =>
            isSelected
              ? [...new Set([...current, ticketGroupId])]
              : current.filter((id) => id !== ticketGroupId),
          );
          if (isSelected && selectRotation) {
            const rotation = aircraftRotations?.find(
              (entry) =>
                entry.ticketGroupId === ticketGroupId ||
                entry.bookingGroups.some((group) => group.id === ticketGroupId),
            );
            if (rotation) setSelectedId(rotation.id);
          }
        }}
        operationalSummary={operationalSummary}
        operationalSummaryTone={operationalSummaryTone}
        selectedAircraft={selectedAircraft}
        selectedGroupIds={selectedQueueGroupIds}
        turnaroundNextState={turnaroundNextState}
      />
      <section
        className={`flight-supervisor legacy-flight-line-overlay ${
          dispositionOpen ? "show-disposition" : "show-details"
        }`}
        hidden={FLIGHT_LINE_ASSIST_MODE || (!dispositionOpen && !detailsOpen)}
      >
        <button
          aria-label="Erweiterte Flight-Line-Details schließen"
          className="legacy-overlay-close"
          onClick={() => {
            setDispositionOpen(false);
            setDetailsOpen(false);
          }}
          type="button"
        >
          ×
        </button>
        <FlightLineAircraftSelector
          aircraft={operationalAircraft}
          onSelect={(aircraftId) => {
            setSelectedAircraftId(aircraftId);
            setSelectedId(null);
            setSelectedQueueGroupIds([]);
            setDispositionOpen(false);
          }}
          rotations={operationalRotations ?? []}
          selectedAircraft={selectedAircraft}
        />
        <section className="flight-workspace">
          <div className="queue-list">
            <h1>
              {selectedAircraft
                ? `Nächste Gruppen für ${selectedAircraft.registration}`
                : "Flugzeuge"}
            </h1>
            <FlightLineLegacyQueue
              aircraft={selectedAircraft}
              allRotations={operationalRotations ?? []}
              compatibleGroups={compatibleQueueGroups}
              deviationReason={callDeviationReason}
              deviationReasonRequired={queueDeviationReasonRequired}
              onClearRecall={clearTicketGroupRecall}
              onGroupAttendance={setGroupAttendance}
              onGroupPresence={updateGroupPresence}
              onSelectRotation={selectLegacyRotation}
              onSetDeviationReason={setCallDeviationReason}
              onStartRecall={startTicketGroupRecall}
              onToggleGroup={toggleLegacyQueueGroup}
              rotations={aircraftRotations ?? []}
              selectedGroupIds={selectedQueueGroupIds}
              selectedProductId={selectedQueueProductId}
              selectedRotation={selected}
              selectedSeatCount={selectedQueueSeatCount}
              skippedEarlierGroupCount={skippedEarlierProductGroups.length}
              timeZone={board?.event.timeZone ?? "Europe/Berlin"}
            />
          </div>
          <div className="rotation-detail">
            <FlightLineAircraftSummary
              aircraft={selectedAircraft}
              canManageAircraft={canManageAircraft}
              onPause={() => openAircraftPauseDialog()}
              onSetState={setFlightLineAircraftState}
              timeZone={board?.event.timeZone ?? "Europe/Berlin"}
            />
            <FlightLineRotationDetails
              action={action}
              callDeviationReason={callDeviationReason}
              event={board?.event}
              nextAircraftId={nextAircraftId}
              onAbort={abortRotation}
              onAdvance={() => advance()}
              onAttendance={setAttendance}
              onDefer={() => mutateQueue("DEFER_TICKET_GROUP")}
              onRevokeCall={revokeCall}
              onSetQueueReason={setQueueReason}
              onSetTurnaroundState={setTurnaroundNextState}
              queueDeviationReasonRequired={queueDeviationReasonRequired}
              queueReason={queueReason}
              rotations={operationalRotations ?? []}
              selected={selected}
              selectedAircraftHasPilot={Boolean(selectedAircraft?.currentPilotId)}
              turnaroundNextState={turnaroundNextState}
            />
          </div>
          {dispositionOpen && selected ? (
            <FlightLineDispositionPanel
              capacity={dispositionCapacity}
              canManage={["FLIGHT_DIRECTOR", "ADMIN"].includes(board?.currentDeviceRole ?? "")}
              missingTickets={missingTickets}
              moveReason={moveReason}
              moveTargetId={moveTargetId}
              moveTargets={moveTargets}
              noShowAfterMinutes={board?.event.noShowAfterMinutes ?? 10}
              noShowReady={noShowReady}
              onAttendanceDecision={confirmAttendanceDecision}
              onCapacityChange={setDispositionCapacity}
              onClose={() => setDispositionOpen(false)}
              onDeferTogether={() =>
                mutateQueue("DEFER_TICKET_GROUP", "Aufgerufene Gruppe gemeinsam zurückgestellt")
              }
              onMarkNoShow={markTicketNoShow}
              onMoveGroup={moveTicketGroup}
              onMoveReasonChange={setMoveReason}
              onMoveTargetChange={setMoveTargetId}
              onSetCapacity={setRotationCapacity}
              presentCount={presentCount}
              replacement={replacement}
              selected={selected}
            />
          ) : null}
        </section>
      </section>
      <FlightLineWorkspaceDialogs
        aircraftPauseOpen={aircraftPauseOpen}
        board={board}
        canManageAircraft={canManageAircraft}
        onAbortTechnicalRotation={abortTechnicalRotation}
        onCloseAircraftPause={() => setAircraftPauseOpen(false)}
        onCloseOperations={() => setOperationsSection(null)}
        onCloseTechnicalAbort={() => setTechnicalAbort(null)}
        onSetTechnicalAbortReason={setTechnicalAbortReason}
        onStartAircraftPause={startAircraftPause}
        operationsBusy={operationsBusy}
        operationsSection={operationsSection}
        operationsProps={{
          emergencyMode: board?.event.emergencyMode ?? false,
          eventInterrupted: board?.event.operationalInterrupted ?? false,
          eventNotice: board?.event.operationalNote ?? "",
          onCancelPlannedOperation: cancelPlannedOperation,
          onConfirmPlannedOperation: confirmPlannedOperation,
          onDisableRecurringRule: disableRecurringRule,
          onPublishEventNotice: setEventNotice,
          onPublishResourceNotice: setResourceNoticeCommand,
          onSetEventInterruption: setEventInterruption,
          onSetResourceGroupStatus: setResourceGroupStatus,
          onTriggerEmergency: triggerEmergency,
          onUpsertPlannedOperation: upsertPlannedOperation,
          onUpsertRecurringRule: upsertRecurringRule,
        }}
        selectedAircraft={selectedAircraft}
        technicalAbortOpen={technicalAbort !== null}
        technicalAbortReason={technicalAbortReason}
      />
    </Shell>
  );
}
