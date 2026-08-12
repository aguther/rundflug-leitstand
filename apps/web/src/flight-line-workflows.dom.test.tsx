// @vitest-environment jsdom

import type { OperationBoard } from "@rundflug/contracts";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiCommandError } from "./api";
import { ActionNotificationProvider } from "./app/PageNotifications";
import { ThemeProvider } from "./design-system/theme";
import { FlightLineView } from "./flight-line-view";

const api = vi.hoisted(() => ({
  sendCommand: vi.fn(),
}));

const workspace = vi.hoisted(() => ({
  state: {
    backendConfirmed: true,
    board: null as OperationBoard | null,
    confirmEvent: vi.fn(),
    error: null as string | null,
    lastConfirmedAt: "2026-08-11T09:00:00.000Z" as string | null,
    refresh: vi.fn(),
    refreshAndGet: vi.fn(),
  },
}));

const dispatchLease = vi.hoisted(() => ({
  controller: {
    consume: vi.fn(),
    error: null,
    lease: null as {
      batchId: string;
      groupIds: string[];
      leaseId: string;
      planRevision: string;
    } | null,
    markExpired: vi.fn(),
    markInvalidated: vi.fn(),
    mode: "IDLE" as "IDLE" | "RESERVED",
    release: vi.fn(),
    reloadLatest: vi.fn(),
    reserve: vi.fn(),
    reservedEventVersion: null,
    serverClockOffsetMs: 0,
    switchToManual: vi.fn(),
  },
}));

const syntheticRotation = {
  aircraftId: "aircraft-1",
  bookingGroups: [],
  id: "rotation-1",
  status: "IN_FLIGHT",
  ticketGroupId: "ticket-group-1",
  version: 5,
};

const syntheticDraftRotation = {
  aircraftId: "aircraft-1",
  bookingGroups: [{ id: "ticket-group-1" }],
  id: "rotation-draft-1",
  status: "DRAFT",
  suggestedAircraftId: "aircraft-1",
  ticketGroupId: "ticket-group-1",
  version: 1,
};

vi.mock("./api", async (importOriginal) => {
  const original = await importOriginal<typeof import("./api")>();
  return {
    ...original,
    getForecastHistory: vi.fn(),
    getResourceDayHistory: vi.fn(),
    sendCommand: api.sendCommand,
  };
});

vi.mock("./features/auth/AuthContext", () => ({
  useAuth: () => ({
    loading: false,
    logout: vi.fn(),
    refresh: vi.fn(),
    session: {
      account: {
        id: "00000000-0000-4000-8000-000000000002",
        loginCode: "FLUGLEITUNG-01",
        role: "FLIGHT_DIRECTOR",
      },
    },
    setSession: vi.fn(),
    unavailable: false,
  }),
}));

vi.mock("./dispatch-recommendation-lease", () => ({
  useDispatchRecommendationLease: () => dispatchLease.controller,
}));

vi.mock("./features/flight-line/FlightDirectorOperationsDialog", () => ({
  FlightDirectorOperationsDialog: () => null,
}));

vi.mock("./flight-line-assist", () => ({
  FlightLineAssist: () => null,
}));

vi.mock("./flight-line-supervisor", () => ({
  FlightLineSupervisorConsole: (props: {
    board: OperationBoard;
    onRunRotation: (rotation: unknown, nextState?: string) => Promise<boolean>;
    operationalSummary: string;
    operationalSummaryTone: string;
  }) => (
    <section aria-label="Flight-Director-Testkonsole">
      <p data-tone={props.operationalSummaryTone}>{props.operationalSummary}</p>
      <p>{props.board.aircraft[0]?.registration}</p>
      <button
        onClick={() => void props.onRunRotation(syntheticRotation, "AVAILABLE")}
        type="button"
      >
        Onblock ausführen
      </button>
      <button onClick={() => void props.onRunRotation(syntheticDraftRotation)} type="button">
        Boarding bestätigen
      </button>
    </section>
  ),
}));

vi.mock("./operation-workspace", () => ({
  ConnectionNotice: ({ error }: { error: string | null }) =>
    error ? <p>Möglicherweise veraltet · {error}</p> : null,
  EmergencyNotice: ({ active }: { active: boolean }) =>
    active ? <p>Notfallmodus aktiv · keine Verkäufe oder neuen Aufrufe</p> : null,
  EVENT_ID: "synthetic-event",
  FLIGHT_LINE_ASSIST_MODE: false,
  FLIGHT_LINE_DEVICE_ID: "synthetic-flight-director-device",
  InterruptionNotice: () => null,
  OperationalNotice: () => null,
  aircraftStateLabel: {
    AVAILABLE: "Verfügbar",
    BOARDING: "Boarding",
    IN_FLIGHT: "Im Flug",
    INACTIVE: "Kurzfristig inaktiv",
    INTERRUPTED: "Flugbetrieb unterbrochen",
    LANDED: "Gelandet / Deboarding",
    PAUSED: "Pause",
    REFUELING: "Tanken aktuell",
    TURNAROUND: "Bodenprozess",
  },
  deviceTokenFor: () => "synthetic-device-token",
  operationalTimeLabel: () => "–",
  predictionQualityLabel: { CHANGING: "in Veränderung", STABLE: "stabil", UNCERTAIN: "unsicher" },
  rotationStatusLabel: {
    CALLED: "Aufgerufen",
    COMPLETED: "Abgeschlossen",
    DRAFT: "Vorbereitung",
    IN_FLIGHT: "Im Flug",
    LANDED: "Gelandet",
  },
  useOperationIdentity: () => ({
    eventId: "synthetic-event",
    deviceId: "synthetic-flight-director-device",
    deviceToken: "synthetic-device-token",
  }),
  useOperationBoard: () => workspace.state,
}));
vi.mock("./features/operations/operation-identity", () => ({
  useOperationIdentity: () => ({
    eventId: "synthetic-event",
    deviceId: "synthetic-flight-director-device",
    deviceToken: "synthetic-device-token",
  }),
}));
vi.mock("./features/operations/use-operation-board", () => ({
  useOperationBoard: () => workspace.state,
}));
vi.mock("./features/operations/operation-notices", () => ({
  ConnectionNotice: ({ error }: { error: string | null }) =>
    error ? <p>Möglicherweise veraltet · {error}</p> : null,
  EmergencyNotice: ({ active }: { active: boolean }) =>
    active ? <p>Notfallmodus aktiv · keine Verkäufe oder neuen Aufrufe</p> : null,
  InterruptionNotice: () => null,
  OperationalNotice: () => null,
}));

function operationBoard(overrides: { emergencyMode?: boolean } = {}): OperationBoard {
  return {
    aircraft: [
      {
        id: "aircraft-1",
        currentPilotId: "pilot-1",
        operationalState: "IN_FLIGHT",
        passengerSeats: 4,
        registration: "D-TEST",
        resourceGroupId: "resource-group-1",
      },
    ],
    assistClaims: [],
    currentDeviceRole: "FLIGHT_DIRECTOR",
    event: {
      emergencyMode: overrides.emergencyMode ?? false,
      eventId: "synthetic-event",
      noShowAfterMinutes: 10,
      operationalInterrupted: false,
      operationalNote: null,
      status: "ACTIVE",
      timeZone: "Europe/Berlin",
      version: 11,
    },
    pilots: [],
    plannedOperations: [],
    products: [],
    queueGroups: [],
    recurringOperationalRules: [],
    resourceGroups: [],
    rotations: [],
  } as unknown as OperationBoard;
}

function renderFlightLine() {
  return render(
    <ThemeProvider>
      <ActionNotificationProvider>
        <FlightLineView />
      </ActionNotificationProvider>
    </ThemeProvider>,
  );
}

describe("flight line workflows", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/flight-director");
    window.matchMedia = vi.fn().mockReturnValue({
      addEventListener: vi.fn(),
      matches: false,
      removeEventListener: vi.fn(),
    });
    Object.defineProperty(window.navigator, "onLine", { configurable: true, value: true });
    api.sendCommand.mockReset();
    workspace.state.backendConfirmed = true;
    workspace.state.board = operationBoard();
    workspace.state.confirmEvent.mockReset();
    workspace.state.error = null;
    workspace.state.lastConfirmedAt = "2026-08-11T09:00:00.000Z";
    workspace.state.refresh.mockReset().mockResolvedValue(undefined);
    workspace.state.refreshAndGet.mockReset().mockResolvedValue(operationBoard());
    dispatchLease.controller.consume.mockReset();
    dispatchLease.controller.lease = null;
    dispatchLease.controller.markInvalidated.mockReset();
    dispatchLease.controller.mode = "IDLE";
  });

  afterEach(() => cleanup());

  it("persists an observed rotation transition before refreshing the board", async () => {
    const user = userEvent.setup();
    api.sendCommand.mockResolvedValue({ event: { version: 12 } });
    renderFlightLine();

    await user.click(screen.getByRole("button", { name: "Onblock ausführen" }));

    await waitFor(() => expect(api.sendCommand).toHaveBeenCalledOnce());
    expect(api.sendCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedVersion: 11,
        observedEventVersion: 11,
        payload: { rotationId: "rotation-1" },
        preconditions: [
          { aggregateId: "rotation-1", aggregateType: "ROTATION", expectedVersion: 5 },
        ],
        type: "MARK_ON_BLOCK",
      }),
      "synthetic-device-token",
    );
    expect(workspace.state.confirmEvent).toHaveBeenCalledWith({ version: 12 });
    expect(workspace.state.refresh).toHaveBeenCalledWith(12);
  });

  it("persists the reserved dispatch lease and consumes it only after confirmation", async () => {
    const user = userEvent.setup();
    dispatchLease.controller.mode = "RESERVED";
    dispatchLease.controller.lease = {
      batchId: "batch-1",
      groupIds: ["ticket-group-1"],
      leaseId: "lease-1",
      planRevision: "plan-7",
    };
    api.sendCommand.mockResolvedValue({ event: { version: 12 } });
    renderFlightLine();

    await user.click(screen.getByRole("button", { name: "Boarding bestätigen" }));

    await waitFor(() => expect(api.sendCommand).toHaveBeenCalledOnce());
    expect(api.sendCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          aircraftId: "aircraft-1",
          dispatchRecommendation: { batchId: "batch-1", planRevision: "plan-7" },
          dispatchRecommendationLeaseId: "lease-1",
          pilotId: "pilot-1",
          ticketGroupIds: ["ticket-group-1"],
        }),
        type: "CALL_NEXT",
      }),
      "synthetic-device-token",
    );
    expect(dispatchLease.controller.consume).toHaveBeenCalledOnce();
  });

  it("shows the emergency state as critical while retaining the confirmed board", () => {
    workspace.state.board = operationBoard({ emergencyMode: true });
    renderFlightLine();

    expect(screen.getByText(/Notfallmodus aktiv/)).toBeTruthy();
    const summary = screen.getByText("Not-Halt aktiv");
    expect(summary.getAttribute("data-tone")).toBe("critical");
    expect(screen.getAllByText("D-TEST").length).toBeGreaterThan(0);
  });

  it("keeps the last confirmed board visible when the connection is lost", () => {
    Object.defineProperty(window.navigator, "onLine", { configurable: true, value: false });
    workspace.state.backendConfirmed = false;
    workspace.state.error = "Server nicht erreichbar";
    renderFlightLine();

    expect(screen.getByText(/Möglicherweise veraltet · Server nicht erreichbar/)).toBeTruthy();
    expect(screen.getAllByText("D-TEST").length).toBeGreaterThan(0);
    expect(screen.getByRole("status", { name: "Offline" })).toBeTruthy();
  });

  it("refreshes after a stale write and requires an explicit replay against the new version", async () => {
    const user = userEvent.setup();
    api.sendCommand
      .mockRejectedValueOnce(new ApiCommandError("Stand veraltet", "STALE_VERSION", 409, 12))
      .mockResolvedValueOnce({ event: { version: 13 } });
    renderFlightLine();
    const action = screen.getByRole("button", { name: "Onblock ausführen" });

    await user.click(action);
    expect(
      await screen.findByText(
        "Der Betriebsstand wurde aktualisiert. Die reservierte Auswahl bleibt bestehen und kann erneut bestätigt werden.",
      ),
    ).toBeTruthy();
    expect(workspace.state.refresh).toHaveBeenCalledWith(12, true);
    expect(api.sendCommand).toHaveBeenCalledTimes(1);

    await user.click(action);
    await waitFor(() => expect(api.sendCommand).toHaveBeenCalledTimes(2));
    expect(workspace.state.confirmEvent).toHaveBeenCalledWith({ version: 13 });
  });
});
