// @vitest-environment jsdom

import type { OperationBoard } from "@rundflug/contracts";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActionNotificationProvider, ActionNotificationStack } from "./app/PageNotifications";
import type { DispatchRecommendationLeaseController } from "./dispatch-recommendation-lease";
import { FlightLineAssist } from "./flight-line-assist";

vi.mock("./flight-line-shared", () => ({
  activeRotationForAircraft: () => undefined,
  BookingGroupAssignmentDialog: ({ open }: { open: boolean }) =>
    open ? <div role="dialog">Gruppenzuweisung</div> : null,
  CompactCurrentRotation: () => <div>Aktueller Umlauf</div>,
  CompactHistory: () => <div>Historie</div>,
  CurrentAircraftStateMarker: () => <span>Verfügbar</span>,
  operationalRotationForAircraft: () => undefined,
  PilotAssignmentDialogs: () => null,
  PilotChangeIcon: () => null,
  PilotIcon: () => null,
  primaryAircraftActionLabel: () => "Primäraktion",
  primaryAircraftActionPresentation: () => ({ Icon: () => null, tone: "primary" }),
  rotationHistoryForAircraft: () => [],
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

function renderAssist(
  input: {
    board?: OperationBoard;
    onClaim?: (aircraftId: string, expectedTakeoverRevision?: number) => Promise<void>;
    onRefresh?: () => Promise<void>;
    onRelease?: (aircraftId: string) => Promise<void>;
  } = {},
) {
  const operationBoard = input.board ?? board();
  const props = {
    board: operationBoard,
    aircraft: operationBoard.aircraft,
    canAssignPilot: false,
    dispatchLease: leaseController(),
    onAssignPilot: vi.fn(),
    onClaim: input.onClaim ?? vi.fn().mockResolvedValue(undefined),
    onClaimUnavailable: vi.fn(),
    onGroupRecall: vi.fn(),
    onGroupRecallClear: vi.fn(),
    onGroupDefer: vi.fn(),
    onPause: vi.fn(),
    onRefresh: input.onRefresh ?? vi.fn().mockResolvedValue(undefined),
    onRelease: input.onRelease ?? vi.fn().mockResolvedValue(undefined),
    onReserveAssignment: vi.fn(),
    onRunRotation: vi.fn(),
    onSelectAircraft: vi.fn(),
    onSetAircraftState: vi.fn(),
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
});
