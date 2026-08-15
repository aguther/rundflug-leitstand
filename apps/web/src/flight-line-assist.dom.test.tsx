// @vitest-environment jsdom

import type { OperationBoard } from "@rundflug/contracts";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FlightLineAssistClaimConflictError } from "./api";
import { ActionNotificationProvider, ActionNotificationStack } from "./app/PageNotifications";
import type { DispatchRecommendationLeaseController } from "./dispatch-recommendation-lease";
import { FlightLineAssist } from "./flight-line-assist";

const shared = vi.hoisted(() => ({
  activeRotationForAircraft: vi.fn(),
  operationalRotationForAircraft: vi.fn(),
  rotationHistoryForAircraft: vi.fn(),
}));

vi.mock("./flight-line-shared", () => ({
  activeRotationForAircraft: shared.activeRotationForAircraft,
  BookingGroupAssignmentDialog: ({ open }: { open: boolean }) =>
    open ? (
      <div aria-label="Gruppenzuweisung" role="dialog">
        Gruppenzuweisung
      </div>
    ) : null,
  CompactCurrentRotation: () => <div>Aktueller Umlauf</div>,
  CompactHistory: () => <div>Historie</div>,
  CurrentAircraftStateMarker: () => <span>Verfügbar</span>,
  operationalRotationForAircraft: shared.operationalRotationForAircraft,
  PilotAssignmentDialogs: ({ open }: { open: boolean }) =>
    open ? (
      <div aria-label="Pilotenauswahl" role="dialog">
        Pilotenauswahl
      </div>
    ) : null,
  PilotChangeIcon: () => null,
  PilotIcon: () => null,
  primaryAircraftActionLabel: () => "Primäraktion",
  primaryAircraftActionPresentation: () => ({
    Icon: () => null,
    shortLabel: "Boarding starten",
    tone: "primary",
  }),
  rotationHistoryForAircraft: shared.rotationHistoryForAircraft,
}));

function aircraft(id: string, registration: string) {
  return {
    id,
    currentPilotId: "pilot-1",
    currentPilotOperationalCode: "P-01",
    operationalState: "AVAILABLE",
    passengerSeats: 4,
    registration,
    resourceGroupId: "resource-group-1",
    resourceGroupName: "Rundflug",
  } as OperationBoard["aircraft"][number];
}

function board(overrides: Partial<OperationBoard> = {}): OperationBoard {
  return {
    aircraft: [aircraft("aircraft-1", "D-SYN1")],
    assistClaims: [],
    currentDeviceRole: "FLIGHT_LINE",
    event: {
      emergencyMode: false,
      eventId: "synthetic-event",
      operationalInterrupted: false,
      status: "ACTIVE",
      timeZone: "Europe/Berlin",
      version: 7,
    },
    pilots: [],
    plannedOperations: [],
    products: [],
    queueGroups: [],
    recurringOperationalRules: [],
    resourceGroups: [],
    rotations: [],
    ...overrides,
  } as unknown as OperationBoard;
}

function leaseController(): DispatchRecommendationLeaseController {
  return {
    consume: vi.fn(),
    error: null,
    lease: null,
    markExpired: vi.fn(),
    markInvalidated: vi.fn(),
    mode: "IDLE",
    release: vi.fn().mockResolvedValue(undefined),
    reloadLatest: vi.fn(),
    reserve: vi.fn(),
    reservedEventVersion: null,
    serverClockOffsetMs: 0,
    switchToManual: vi.fn(),
  };
}

function rotation(status: OperationBoard["rotations"][number]["status"]) {
  return {
    id: `rotation-${status.toLowerCase()}`,
    status,
    gateLabel: "Flight Line",
  } as OperationBoard["rotations"][number];
}

function renderAssist(
  input: {
    board?: OperationBoard;
    canAssignPilot?: boolean;
    onClaim?: (aircraftId: string, expectedTakeoverRevision?: number) => Promise<void>;
    onClaimUnavailable?: () => void;
    onPause?: (aircraftId: string) => void;
    onRefresh?: () => Promise<void>;
    onRelease?: (aircraftId: string) => Promise<void>;
    onReserveAssignment?: (aircraftId: string) => Promise<unknown>;
    onRunRotation?: (
      rotation: OperationBoard["rotations"][number],
      nextAircraftState?: "AVAILABLE" | "REFUELING" | "PAUSED" | "INACTIVE",
      queueDeviationReason?: string,
    ) => Promise<boolean>;
    onSetAircraftState?: (
      aircraftId: string,
      state: "AVAILABLE" | "REFUELING" | "PAUSED" | "INACTIVE",
    ) => Promise<void>;
  } = {},
) {
  const operationBoard = input.board ?? board();
  const props = {
    board: operationBoard,
    aircraft: operationBoard.aircraft,
    canAssignPilot: input.canAssignPilot ?? false,
    dispatchLease: leaseController(),
    onAssignPilot: vi.fn(),
    onClaim: input.onClaim ?? vi.fn().mockResolvedValue(undefined),
    onClaimUnavailable: input.onClaimUnavailable ?? vi.fn(),
    onGroupRecall: vi.fn(),
    onGroupRecallClear: vi.fn(),
    onGroupDefer: vi.fn(),
    onPause: input.onPause ?? vi.fn(),
    onRefresh: input.onRefresh ?? vi.fn().mockResolvedValue(undefined),
    onRelease: input.onRelease ?? vi.fn().mockResolvedValue(undefined),
    onReserveAssignment: input.onReserveAssignment ?? vi.fn(),
    onRunRotation: input.onRunRotation ?? vi.fn(),
    onSelectAircraft: vi.fn(),
    onSetAircraftState: input.onSetAircraftState ?? vi.fn(),
    onToggleGroup: vi.fn(),
    selectedQueueGroupIds: [],
  };
  return {
    ...render(
      <ActionNotificationProvider>
        <FlightLineAssist {...props} />
        <ActionNotificationStack />
      </ActionNotificationProvider>,
    ),
    props,
  };
}

beforeEach(() => {
  shared.activeRotationForAircraft.mockReset().mockReturnValue(undefined);
  shared.operationalRotationForAircraft.mockReset().mockReturnValue(undefined);
  shared.rotationHistoryForAircraft.mockReset().mockReturnValue([]);
});

afterEach(() => cleanup());

describe("flight line assist workflow", () => {
  it("claims an aircraft once and switches from selection to work mode", async () => {
    const user = userEvent.setup();
    const onClaim = vi.fn().mockResolvedValue(undefined);
    const { props } = renderAssist({ onClaim });

    await user.click(screen.getByRole("button", { name: "Übernehmen" }));

    await waitFor(() => expect(onClaim).toHaveBeenCalledWith("aircraft-1"));
    expect(props.onSelectAircraft).toHaveBeenCalledWith("aircraft-1");
    expect(screen.getByRole("button", { name: "Flugzeug freigeben" })).toBeTruthy();
    expect(screen.getByText("Boarding starten")).toBeTruthy();
    expect(screen.getByText("Aktueller Umlauf")).toBeTruthy();
  });

  it("identifies a concurrent claim as an explicit takeover action", async () => {
    const user = userEvent.setup();
    const conflictingClaim = {
      aircraftId: "aircraft-1",
      claimedByCurrentOperator: false,
      ownerLoginCode: "FL-02",
      revision: 9,
    } as OperationBoard["assistClaims"][number];
    const onClaim = vi.fn().mockResolvedValue(undefined);
    renderAssist({ board: board({ assistClaims: [conflictingClaim] }), onClaim });

    expect(screen.getByText("Betreut von FL-02")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Bewusst übernehmen" }));

    await waitFor(() => expect(onClaim).toHaveBeenCalledWith("aircraft-1"));
    expect(screen.getByRole("button", { name: "Flugzeug freigeben" })).toBeTruthy();
  });

  it("loads additional aircraft and surfaces a refresh failure", async () => {
    const user = userEvent.setup();
    const aircraftList = Array.from({ length: 6 }, (_, index) =>
      aircraft(`aircraft-${index + 1}`, `D-SY${index + 1}`),
    );
    const onRefresh = vi.fn().mockRejectedValue(new Error("Aktualisierung fehlgeschlagen"));
    renderAssist({ board: board({ aircraft: aircraftList }), onRefresh });

    expect(screen.queryByText("D-SY6")).toBeNull();
    await user.click(screen.getByRole("button", { name: /Weitere anzeigen/ }));
    expect(screen.getByText("D-SY6")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Flugzeugliste aktualisieren" }));
    expect(await screen.findByText("Aktualisierung fehlgeschlagen")).toBeTruthy();
  });

  it("releases the server claim and returns to aircraft selection", async () => {
    const user = userEvent.setup();
    const ownedBoard = board({
      assistClaims: [
        {
          aircraftId: "aircraft-1",
          claimedByCurrentOperator: true,
          ownerLoginCode: "FL-01",
          revision: 4,
        },
      ] as OperationBoard["assistClaims"],
    });
    const onRelease = vi.fn().mockResolvedValue(undefined);
    const { props } = renderAssist({ board: ownedBoard, onRelease });

    await user.click(screen.getByRole("button", { name: "Flugzeug freigeben" }));

    await waitFor(() => expect(onRelease).toHaveBeenCalledWith("aircraft-1"));
    expect(props.dispatchLease.release).toHaveBeenCalledOnce();
    expect(screen.getByText("Flugzeug übernehmen")).toBeTruthy();
  });

  it("requires an explicit revision before taking over a concurrently claimed aircraft", async () => {
    const user = userEvent.setup();
    const conflictingClaim = {
      aircraftId: "aircraft-1",
      claimedByCurrentOperator: false,
      ownerLoginCode: "FL-02",
      revision: 9,
    } as OperationBoard["assistClaims"][number];
    const onClaim = vi
      .fn()
      .mockRejectedValueOnce(
        new FlightLineAssistClaimConflictError("Claim conflict", conflictingClaim),
      )
      .mockResolvedValueOnce(undefined);
    const { props } = renderAssist({ onClaim });

    await user.click(screen.getByRole("button", { name: "Übernehmen" }));
    expect(
      await screen.findByRole("alertdialog", { name: "Flugzeug bereits übernommen" }),
    ).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Trotzdem übernehmen" }));

    await waitFor(() => expect(onClaim).toHaveBeenLastCalledWith("aircraft-1", 9));
    expect(props.onSelectAircraft).toHaveBeenCalledWith("aircraft-1");
    expect(screen.queryByRole("alertdialog", { name: "Flugzeug bereits übernommen" })).toBeNull();
  });

  it("coordinates draft assignment, fleet state, pilot, and history actions", async () => {
    const user = userEvent.setup();
    const draftRotation = rotation("DRAFT");
    shared.activeRotationForAircraft.mockReturnValue(draftRotation);
    shared.operationalRotationForAircraft.mockReturnValue(draftRotation);
    shared.rotationHistoryForAircraft.mockReturnValue([rotation("COMPLETED")]);
    const ownedBoard = board({
      assistClaims: [
        {
          aircraftId: "aircraft-1",
          claimedByCurrentOperator: true,
          ownerLoginCode: "FL-01",
          revision: 4,
        },
      ] as OperationBoard["assistClaims"],
    });
    const onPause = vi.fn();
    const onReserveAssignment = vi.fn().mockResolvedValue(undefined);
    const onSetAircraftState = vi.fn().mockResolvedValue(undefined);
    renderAssist({
      board: ownedBoard,
      canAssignPilot: true,
      onPause,
      onReserveAssignment,
      onSetAircraftState,
    });

    await user.click(screen.getByRole("button", { name: "Primäraktion" }));
    expect(onReserveAssignment).toHaveBeenCalledWith("aircraft-1");
    expect(screen.getByRole("dialog", { name: "Gruppenzuweisung" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Tanken" }));
    expect(onSetAircraftState).toHaveBeenCalledWith("aircraft-1", "REFUELING");
    await user.click(screen.getByRole("button", { name: "Pause" }));
    expect(onPause).toHaveBeenCalledWith("aircraft-1");
    await user.click(screen.getByRole("button", { name: "Nicht verfügbar" }));
    expect(onSetAircraftState).toHaveBeenCalledWith("aircraft-1", "INACTIVE");

    await user.click(screen.getByRole("button", { name: "Pilot für D-SYN1 wechseln" }));
    expect(screen.getByRole("dialog", { name: "Pilotenauswahl" })).toBeTruthy();
    await user.click(screen.getByRole("tab", { name: "Historie" }));
    expect(screen.getAllByText("Historie")).toHaveLength(2);
  });

  it("routes landed turnaround actions through the rotation command", async () => {
    const user = userEvent.setup();
    const landedRotation = rotation("LANDED");
    shared.activeRotationForAircraft.mockReturnValue(landedRotation);
    shared.operationalRotationForAircraft.mockReturnValue(landedRotation);
    const ownedBoard = board({
      assistClaims: [
        {
          aircraftId: "aircraft-1",
          claimedByCurrentOperator: true,
          ownerLoginCode: "FL-01",
          revision: 4,
        },
      ] as OperationBoard["assistClaims"],
    });
    const onRunRotation = vi.fn().mockResolvedValue(true);
    renderAssist({ board: ownedBoard, onRunRotation });

    await user.click(screen.getByRole("button", { name: "Primäraktion" }));
    expect(onRunRotation).toHaveBeenCalledWith(landedRotation, "AVAILABLE");
    await user.click(screen.getByRole("button", { name: "Tanken" }));
    expect(onRunRotation).toHaveBeenCalledWith(landedRotation, "REFUELING");
    await user.click(screen.getByRole("button", { name: "Pause" }));
    expect(onRunRotation).toHaveBeenCalledWith(landedRotation, "PAUSED");
    await user.click(screen.getByRole("button", { name: "Nicht verfügbar" }));
    expect(onRunRotation).toHaveBeenCalledWith(landedRotation, "INACTIVE");
  });

  it("restores a refueling aircraft to available before allowing another workflow", async () => {
    const user = userEvent.setup();
    const refuelingAircraft = {
      ...aircraft("aircraft-1", "D-SYN1"),
      operationalState: "REFUELING",
    } as OperationBoard["aircraft"][number];
    const ownedBoard = board({
      aircraft: [refuelingAircraft],
      assistClaims: [
        {
          aircraftId: "aircraft-1",
          claimedByCurrentOperator: true,
          ownerLoginCode: "FL-01",
          revision: 4,
        },
      ] as OperationBoard["assistClaims"],
    });
    const onSetAircraftState = vi.fn().mockResolvedValue(undefined);
    renderAssist({ board: ownedBoard, onSetAircraftState });

    await user.click(screen.getByRole("button", { name: "Primäraktion" }));

    expect(onSetAircraftState).toHaveBeenCalledWith("aircraft-1", "AVAILABLE");
  });

  it("keeps a failed release claimed and reports the backend error", async () => {
    const user = userEvent.setup();
    const ownedBoard = board({
      assistClaims: [
        {
          aircraftId: "aircraft-1",
          claimedByCurrentOperator: true,
          ownerLoginCode: "FL-01",
          revision: 4,
        },
      ] as OperationBoard["assistClaims"],
    });
    const onRelease = vi.fn().mockRejectedValue(new Error("Freigabe fehlgeschlagen"));
    renderAssist({ board: ownedBoard, onRelease });

    await user.click(screen.getByRole("button", { name: "Flugzeug freigeben" }));

    expect(await screen.findByText("Freigabe fehlgeschlagen")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Flugzeug freigeben" })).toBeTruthy();
  });
});
