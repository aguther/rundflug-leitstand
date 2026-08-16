import type { CommandResult, OperationBoard } from "@rundflug/contracts";
import type { Dispatch, SetStateAction } from "react";
import { sendCommand } from "../../api";
import { expectedReviewAtFromPause } from "../../flight-line-pause";

type Aircraft = OperationBoard["aircraft"][number];
type AircraftState = "AVAILABLE" | "REFUELING" | "PAUSED" | "INTERRUPTED" | "INACTIVE";
type TechnicalAbort = {
  aircraftId: string;
  aircraftVersion: number;
  rotationId: string;
  rotationVersion: number;
};

interface AircraftCommandOptions {
  board: OperationBoard | null | undefined;
  confirmEvent: (event: CommandResult["event"]) => void;
  deviceId: string;
  deviceToken: string;
  eventId: string;
  operationalAircraft: Aircraft[];
  operationalRotations: OperationBoard["rotations"];
  refresh: (version?: number) => Promise<unknown>;
  selectedAircraft: Aircraft | null | undefined;
  setAircraftPauseOpen: Dispatch<SetStateAction<boolean>>;
  setMessage: Dispatch<SetStateAction<string | null>>;
  setSelectedAircraftId: Dispatch<SetStateAction<string | null>>;
  setTechnicalAbort: Dispatch<SetStateAction<TechnicalAbort | null>>;
  setTechnicalAbortReason: Dispatch<SetStateAction<string>>;
}

export function useFlightLineAircraftCommands(options: AircraftCommandOptions) {
  const {
    board,
    confirmEvent,
    deviceId,
    deviceToken,
    eventId,
    operationalAircraft,
    operationalRotations,
    refresh,
    selectedAircraft,
    setAircraftPauseOpen,
    setMessage,
    setSelectedAircraftId,
    setTechnicalAbort,
    setTechnicalAbortReason,
  } = options;

  async function setFlightLineAircraftState(
    state: AircraftState,
    expectedReviewAt: string | null = null,
    aircraftOverride: Aircraft | undefined = selectedAircraft ?? undefined,
  ) {
    if (!board || !aircraftOverride) return;
    const reasonByState = {
      AVAILABLE: "Flugzeug durch Flight Line wieder verfügbar gemeldet",
      REFUELING: "Tanken durch Flight Line begonnen",
      PAUSED: "Flugzeugpause durch Flight Line begonnen",
      INTERRUPTED: "Flugzeugbetrieb durch Flight Line unterbrochen",
      INACTIVE: "Flugzeug durch Flight Line vorübergehend inaktiv gemeldet",
    } as const;
    try {
      const result = await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId,
          deviceId,
          expectedVersion: board.event.version,
          observedEventVersion: board.event.version,
          preconditions: [
            {
              aggregateType: "AIRCRAFT",
              aggregateId: aircraftOverride.id,
              expectedVersion: aircraftOverride.version,
            },
          ],
          issuedAt: new Date().toISOString(),
          type: "SET_AIRCRAFT_OPERATIONAL_STATE",
          payload: {
            aircraftId: aircraftOverride.id,
            state,
            reason: reasonByState[state],
            expectedReviewAt,
          },
        },
        deviceToken,
      );
      setAircraftPauseOpen(false);
      confirmEvent(result.event);
      await refresh(result.event.version);
    } catch (cause) {
      setMessage(
        cause instanceof Error ? cause.message : "Flugzeugstatus konnte nicht geändert werden.",
      );
    }
  }

  function startAircraftPause(minutes: 10 | 20 | 30 | null) {
    if (!selectedAircraft) return;
    return setFlightLineAircraftState("PAUSED", expectedReviewAtFromPause(minutes));
  }

  function openAircraftPauseDialog(aircraftId?: string) {
    if (aircraftId) setSelectedAircraftId(aircraftId);
    setAircraftPauseOpen(true);
  }

  async function requestAircraftState(
    aircraftId: string,
    state: "AVAILABLE" | "REFUELING" | "PAUSED" | "INACTIVE",
  ) {
    const aircraft = operationalAircraft.find((entry) => entry.id === aircraftId);
    const rotation = operationalRotations.find(
      (entry) => entry.aircraftId === aircraftId && ["CALLED", "IN_FLIGHT"].includes(entry.status),
    );
    if (state === "INACTIVE" && rotation && aircraft) {
      setSelectedAircraftId(aircraftId);
      setTechnicalAbort({
        aircraftId,
        aircraftVersion: aircraft.version,
        rotationId: rotation.id,
        rotationVersion: rotation.version,
      });
      setTechnicalAbortReason("");
      return;
    }
    await setFlightLineAircraftState(state, null, aircraft);
  }

  async function assignAircraftPilot(aircraftId: string, pilotId: string, reassign: boolean) {
    if (!board) return;
    try {
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId,
          deviceId,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "ASSIGN_AIRCRAFT_PILOT",
          payload: { aircraftId, pilotId, reassign },
        },
        deviceToken,
      );
      await refresh();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Pilotzuweisung fehlgeschlagen.");
      throw reason;
    }
  }

  return {
    assignAircraftPilot,
    openAircraftPauseDialog,
    requestAircraftState,
    setFlightLineAircraftState,
    startAircraftPause,
  };
}
