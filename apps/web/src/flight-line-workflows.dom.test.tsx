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
  getForecastHistory: vi.fn(),
  getResourceDayHistory: vi.fn(),
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

const supervisor = vi.hoisted(() => ({
  onGroupDefer: null as null | ((ticketGroupId: string) => Promise<void>),
  onGroupRecallClear: null as
    | null
    | ((ticketGroupId: string, recallId: string) => Promise<boolean>),
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
  aircraftRegistration: "D-TEST",
  baselineCapacity: 4,
  boardingWindowLowerAt: null,
  boardingWindowUpperAt: null,
  bookingGroups: [{ id: "ticket-group-1", tickets: [] }],
  calledAt: null,
  capacityReduced: false,
  communicationLabel: "F-PN-0001",
  communicationNumber: 1,
  deferralCount: 0,
  estimatedPassengerPayloadKg: null,
  flightGroupId: "flight-group-1",
  gateId: "gate-1",
  gateLabel: "Gate 1",
  id: "rotation-draft-1",
  operationalNote: "",
  pilotId: "pilot-1",
  pilotOperationalCode: "PILOT-01",
  predictedLowerMinutes: 5,
  predictedUpperMinutes: 15,
  productCode: "PN",
  productName: "Synthetischer Rundflug",
  queuePosition: 1,
  status: "DRAFT",
  suggestedAircraftId: "aircraft-1",
  suggestedAircraftRegistration: "D-TEST",
  suggestedPilotId: "pilot-1",
  suggestedPilotOperationalCode: "PILOT-01",
  ticketGroupId: "ticket-group-1",
  ticketCount: 2,
  tickets: [],
  timeline: {
    actual: { boardingAt: null, completionAt: null, departureAt: null, landingAt: null },
    extendsBeyondOperationsEnd: false,
    overtimeMinutes: 0,
    planned: { boardingAt: null, completionAt: null, departureAt: null, landingAt: null },
    predicted: { boardingAt: null, completionAt: null, departureAt: null, landingAt: null },
    predictionQuality: null,
    predictionUpdatedAt: null,
  },
  usableCapacity: 4,
  version: 1,
};

vi.mock("./api", async (importOriginal) => {
  const original = await importOriginal<typeof import("./api")>();
  return {
    ...original,
    getForecastHistory: api.getForecastHistory,
    getResourceDayHistory: api.getResourceDayHistory,
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
  FlightDirectorOperationsDialog: (props: {
    onCancelPlannedOperation: (plan: { id: string; version: number }) => Promise<void>;
    onConfirmPlannedOperation: (
      plan: {
        scopeId?: string;
        scopeType?: "AIRCRAFT" | "EVENT" | "PILOT" | "RESOURCE_GROUP";
        id: string;
        version: number;
        durationMultiplierPercent?: number;
        effectMode: "INTERRUPTION" | "SLOWDOWN";
        kind?: "INTERRUPTION" | "PAUSE" | "REFUELING";
        typicalDurationMinutes?: number;
      },
      activate: boolean,
    ) => Promise<void>;
    onDisableRecurringRule: (rule: { id: string; version: number }) => Promise<void>;
    onPublishEventNotice: (note: string) => Promise<boolean>;
    onPublishResourceNotice: (resourceGroupId: string, note: string) => Promise<boolean>;
    onSetEventInterruption: (
      interrupted: boolean,
      plannedOperationId?: string,
      expectedReviewAt?: string | null,
    ) => Promise<void>;
    onSetResourceGroupStatus: (
      resourceGroupId: string,
      status: "ACTIVE" | "ENDED" | "INTERRUPTED" | "PAUSED",
      plannedOperationId?: string,
      expectedReviewAt?: string | null,
    ) => Promise<void>;
    onTriggerEmergency: () => Promise<void>;
    onUpsertPlannedOperation: (payload: { planId: string }) => Promise<void>;
    onUpsertRecurringRule: (payload: { ruleId: string }) => Promise<void>;
    section: "operations" | "plan" | "resources" | null;
  }) =>
    props.section ? (
      <section aria-label="Operations-Testdialog">
        <button onClick={() => void props.onPublishEventNotice(" Testhinweis ")} type="button">
          Veranstaltungshinweis senden
        </button>
        <button
          onClick={() => void props.onPublishResourceNotice("resource-group-1", " Gruppenhinweis ")}
          type="button"
        >
          Gruppenhinweis senden
        </button>
        <button onClick={() => void props.onPublishEventNotice("   ")} type="button">
          Veranstaltungshinweis löschen
        </button>
        <button
          onClick={() => void props.onPublishResourceNotice("resource-group-1", "   ")}
          type="button"
        >
          Gruppenhinweis löschen
        </button>
        <button
          onClick={() =>
            void props.onSetEventInterruption(
              true,
              "planned-operation-1",
              "2026-08-11T10:30:00.000Z",
            )
          }
          type="button"
        >
          Betrieb unterbrechen
        </button>
        <button onClick={() => void props.onSetEventInterruption(false)} type="button">
          Betrieb fortsetzen
        </button>
        <button
          onClick={() =>
            void props.onSetResourceGroupStatus(
              "resource-group-1",
              "PAUSED",
              "planned-operation-1",
              "2026-08-11T10:30:00.000Z",
            )
          }
          type="button"
        >
          Gruppe pausieren
        </button>
        <button
          onClick={() => void props.onSetResourceGroupStatus("resource-group-1", "ACTIVE")}
          type="button"
        >
          Gruppe aktivieren
        </button>
        <button onClick={() => void props.onTriggerEmergency()} type="button">
          Notfall auslösen
        </button>
        <button
          onClick={() => void props.onUpsertPlannedOperation({ planId: "planned-operation-1" })}
          type="button"
        >
          Plan speichern
        </button>
        <button
          onClick={() =>
            void props.onConfirmPlannedOperation(
              {
                id: "planned-operation-1",
                version: 2,
                durationMultiplierPercent: 175,
                effectMode: "SLOWDOWN",
              },
              true,
            )
          }
          type="button"
        >
          Plan bestätigen
        </button>
        <button
          onClick={() =>
            void props.onConfirmPlannedOperation(
              {
                effectMode: "INTERRUPTION",
                id: "event-plan",
                kind: "INTERRUPTION",
                scopeType: "EVENT",
                typicalDurationMinutes: 15,
                version: 3,
              },
              true,
            )
          }
          type="button"
        >
          Veranstaltungsplan starten
        </button>
        <button
          onClick={() =>
            void props.onConfirmPlannedOperation(
              {
                effectMode: "INTERRUPTION",
                id: "group-plan",
                kind: "PAUSE",
                scopeId: "resource-group-1",
                scopeType: "RESOURCE_GROUP",
                typicalDurationMinutes: 20,
                version: 3,
              },
              false,
            )
          }
          type="button"
        >
          Gruppenplan beenden
        </button>
        <button
          onClick={() =>
            void props.onConfirmPlannedOperation(
              {
                effectMode: "INTERRUPTION",
                id: "aircraft-plan",
                kind: "REFUELING",
                scopeId: "aircraft-1",
                scopeType: "AIRCRAFT",
                typicalDurationMinutes: 10,
                version: 3,
              },
              true,
            )
          }
          type="button"
        >
          Flugzeugplan starten
        </button>
        <button
          onClick={() =>
            void props.onConfirmPlannedOperation(
              {
                effectMode: "INTERRUPTION",
                id: "pilot-plan",
                kind: "PAUSE",
                scopeId: "pilot-1",
                scopeType: "PILOT",
                typicalDurationMinutes: 10,
                version: 3,
              },
              false,
            )
          }
          type="button"
        >
          Pilotenplan beenden
        </button>
        <button
          onClick={() =>
            void props.onCancelPlannedOperation({ id: "planned-operation-1", version: 2 })
          }
          type="button"
        >
          Plan absagen
        </button>
        <button
          onClick={() => void props.onUpsertRecurringRule({ ruleId: "recurring-rule-1" })}
          type="button"
        >
          Regel speichern
        </button>
        <button
          onClick={() => void props.onDisableRecurringRule({ id: "recurring-rule-1", version: 4 })}
          type="button"
        >
          Regel deaktivieren
        </button>
      </section>
    ) : null,
}));

vi.mock("./flight-line-assist", () => ({
  FlightLineAssist: () => null,
}));

vi.mock("./flight-line-supervisor", () => ({
  FlightLineSupervisorConsole: (props: {
    board: OperationBoard;
    loadForecastHistory: (rotationId: string) => Promise<unknown>;
    loadResourceHistory: (scopeType: "AIRCRAFT", scopeId: string) => Promise<unknown>;
    onAssignPilot: (aircraftId: string, pilotId: string, reassign: boolean) => Promise<void>;
    onConfirmAssignment: (queueDeviationReason?: string) => Promise<boolean>;
    onGroupDefer: (ticketGroupId: string) => Promise<void>;
    onGroupRecall: (ticketGroupId: string) => Promise<boolean>;
    onGroupRecallClear: (ticketGroupId: string, recallId: string) => Promise<boolean>;
    onOpenOperations: (section: "operations" | "plan" | "resources") => void;
    onPauseAircraft: (aircraftId: string) => void;
    onReserveAssignment: (aircraftId: string) => Promise<unknown>;
    onResourceGroupChange: (resourceGroupId: string) => void;
    onRunRotation: (rotation: unknown, nextState?: string) => Promise<boolean>;
    onSelectAircraft: (aircraftId: string) => void;
    onSetAircraftState: (aircraftId: string, state: "AVAILABLE" | "INACTIVE") => Promise<void>;
    onToggleGroup: (ticketGroupId: string, selected: boolean) => void;
    operationalSummary: string;
    operationalSummaryTone: string;
  }) => {
    supervisor.onGroupDefer = props.onGroupDefer;
    supervisor.onGroupRecallClear = props.onGroupRecallClear;
    return (
      <section aria-label="Flight-Director-Testkonsole">
        <p data-tone={props.operationalSummaryTone}>{props.operationalSummary}</p>
        <p>{props.board.aircraft[0]?.registration}</p>
        <button onClick={() => props.onOpenOperations("operations")} type="button">
          Operations öffnen
        </button>
        <button
          onClick={() => void props.onAssignPilot("aircraft-1", "pilot-2", true)}
          type="button"
        >
          Pilot zuweisen
        </button>
        <button onClick={() => props.onPauseAircraft("aircraft-1")} type="button">
          Flugzeug pausieren
        </button>
        <button
          onClick={() => void props.onSetAircraftState("aircraft-1", "AVAILABLE")}
          type="button"
        >
          Flugzeug verfügbar
        </button>
        <button
          onClick={() => void props.onSetAircraftState("aircraft-1", "INACTIVE")}
          type="button"
        >
          Flugzeug inaktiv
        </button>
        <button onClick={() => void props.loadForecastHistory("rotation-1")} type="button">
          Prognosehistorie laden
        </button>
        <button
          onClick={() => void props.loadResourceHistory("AIRCRAFT", "aircraft-1")}
          type="button"
        >
          Ressourcenhistorie laden
        </button>
        <button
          onClick={() => void props.onRunRotation(syntheticRotation, "AVAILABLE")}
          type="button"
        >
          Onblock ausführen
        </button>
        <button onClick={() => void props.onRunRotation(syntheticDraftRotation)} type="button">
          Boarding bestätigen
        </button>
        <button onClick={() => props.onSelectAircraft("aircraft-1")} type="button">
          Flugzeug auswählen
        </button>
        <button onClick={() => props.onToggleGroup("ticket-group-1", true)} type="button">
          Gruppe auswählen
        </button>
        <button onClick={() => props.onToggleGroup("ticket-group-1", false)} type="button">
          Gruppe abwählen
        </button>
        <button onClick={() => void props.onGroupRecall("ticket-group-1")} type="button">
          Gruppe aufrufen
        </button>
        <button
          onClick={() => void props.onGroupRecallClear("ticket-group-1", "recall-1")}
          type="button"
        >
          Aufruf beenden
        </button>
        <button onClick={() => void props.onGroupDefer("ticket-group-1")} type="button">
          Gruppe zurückstellen
        </button>
        <button onClick={() => void props.onReserveAssignment("aircraft-1")} type="button">
          Vorschlag reservieren
        </button>
        <button onClick={() => void props.onConfirmAssignment("Synthetic deviation")} type="button">
          Auswahl bestätigen
        </button>
        <button onClick={() => props.onResourceGroupChange("resource-group-1")} type="button">
          Ressourcengruppe filtern
        </button>
      </section>
    );
  },
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
        version: 3,
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
    queueGroups: [
      {
        bookingGroupLabel: "BG-0001",
        bookingGroupNumber: 1,
        communicationLabel: "G-PN-0001",
        communicationNumber: 1,
        id: "ticket-group-1",
        activeRecall: null,
        productCode: "PN",
        productId: "product-1",
        queueSequence: 1,
        recallCount: 0,
        status: "QUEUED",
        ticketCount: 2,
        tickets: [],
      },
    ],
    recurringOperationalRules: [],
    resourceGroups: [],
    rotations: [syntheticDraftRotation],
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
    api.getForecastHistory.mockReset();
    api.getResourceDayHistory.mockReset();
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
    dispatchLease.controller.reloadLatest.mockReset().mockResolvedValue(null);
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

  it("persists flight-director operations with audit context and expected versions", async () => {
    const user = userEvent.setup();
    api.sendCommand.mockResolvedValue({ event: { version: 12 } });
    renderFlightLine();
    await user.click(screen.getByRole("button", { name: "Operations öffnen" }));

    const actions = [
      "Veranstaltungshinweis senden",
      "Gruppenhinweis senden",
      "Veranstaltungshinweis löschen",
      "Gruppenhinweis löschen",
      "Betrieb unterbrechen",
      "Betrieb fortsetzen",
      "Gruppe pausieren",
      "Gruppe aktivieren",
      "Notfall auslösen",
      "Plan speichern",
      "Plan bestätigen",
      "Veranstaltungsplan starten",
      "Gruppenplan beenden",
      "Flugzeugplan starten",
      "Pilotenplan beenden",
      "Plan absagen",
      "Regel speichern",
      "Regel deaktivieren",
    ];
    for (const [index, action] of actions.entries()) {
      await user.click(screen.getByRole("button", { name: action }));
      await waitFor(() => expect(api.sendCommand).toHaveBeenCalledTimes(index + 1));
    }

    expect(api.sendCommand.mock.calls.map(([command]) => command.type)).toEqual([
      "SET_OPERATIONAL_NOTE",
      "SET_RESOURCE_GROUP_NOTICE",
      "SET_OPERATIONAL_NOTE",
      "SET_RESOURCE_GROUP_NOTICE",
      "SET_EVENT_INTERRUPTION",
      "SET_EVENT_INTERRUPTION",
      "SET_RESOURCE_GROUP_STATUS",
      "SET_RESOURCE_GROUP_STATUS",
      "TRIGGER_EMERGENCY",
      "UPSERT_PLANNED_OPERATION",
      "SET_PLANNED_SLOWDOWN_ACTIVE",
      "SET_EVENT_INTERRUPTION",
      "SET_RESOURCE_GROUP_STATUS",
      "SET_AIRCRAFT_OPERATIONAL_STATE",
      "SET_PILOT_PAUSE",
      "CANCEL_PLANNED_OPERATION",
      "UPSERT_RECURRING_OPERATIONAL_RULE",
      "DISABLE_RECURRING_OPERATIONAL_RULE",
    ]);
    expect(api.sendCommand.mock.calls[0]?.[0].payload).toEqual({ note: "Testhinweis" });
    expect(api.sendCommand.mock.calls[4]?.[0].payload).toEqual({
      interrupted: true,
      reason: "Operative Entscheidung Flight Director",
      expectedReviewAt: "2026-08-11T10:30:00.000Z",
      plannedOperationId: "planned-operation-1",
    });
    expect(api.sendCommand.mock.calls[15]?.[0].payload).toEqual({
      planId: "planned-operation-1",
      planExpectedVersion: 2,
    });
    expect(api.sendCommand.mock.calls[17]?.[0].payload).toEqual({
      ruleId: "recurring-rule-1",
      ruleExpectedVersion: 4,
      reason: "Wiederkehrende Tagesregel deaktiviert.",
    });
    expect(workspace.state.refresh).toHaveBeenCalledTimes(18);
  });

  it("coordinates aircraft state, pilot assignment and paginated history requests", async () => {
    const user = userEvent.setup();
    api.sendCommand.mockResolvedValue({ event: { version: 12 } });
    api.getForecastHistory
      .mockResolvedValueOnce({
        entries: [
          { capturedAt: "2026-08-11T09:01:00.000Z", snapshotId: "snapshot-b" },
          { capturedAt: "2026-08-11T09:00:00.000Z", snapshotId: "snapshot-a" },
        ],
        total: 3,
      })
      .mockResolvedValueOnce({ entries: [], total: 3 });
    api.getResourceDayHistory.mockResolvedValue({ entries: [] });
    renderFlightLine();

    for (const [index, action] of [
      "Pilot zuweisen",
      "Flugzeug verfügbar",
      "Flugzeug inaktiv",
    ].entries()) {
      await user.click(screen.getByRole("button", { name: action }));
      await waitFor(() => expect(api.sendCommand).toHaveBeenCalledTimes(index + 1));
    }
    await user.click(screen.getByRole("button", { name: "Flugzeug pausieren" }));
    await user.click(screen.getByRole("button", { name: "10 Min." }));
    await waitFor(() => expect(api.sendCommand).toHaveBeenCalledTimes(4));

    expect(api.sendCommand.mock.calls.map(([command]) => command.type)).toEqual([
      "ASSIGN_AIRCRAFT_PILOT",
      "SET_AIRCRAFT_OPERATIONAL_STATE",
      "SET_AIRCRAFT_OPERATIONAL_STATE",
      "SET_AIRCRAFT_OPERATIONAL_STATE",
    ]);
    expect(api.sendCommand.mock.calls[0]?.[0].payload).toEqual({
      aircraftId: "aircraft-1",
      pilotId: "pilot-2",
      reassign: true,
    });
    expect(api.sendCommand.mock.calls[3]?.[0].payload).toEqual(
      expect.objectContaining({
        aircraftId: "aircraft-1",
        state: "PAUSED",
        reason: "Flugzeugpause durch Flight Line begonnen",
      }),
    );

    await user.click(screen.getByRole("button", { name: "Prognosehistorie laden" }));
    await waitFor(() => expect(api.getForecastHistory).toHaveBeenCalledTimes(2));
    await user.click(screen.getByRole("button", { name: "Ressourcenhistorie laden" }));
    await waitFor(() => expect(api.getResourceDayHistory).toHaveBeenCalledOnce());
    expect(api.getForecastHistory).toHaveBeenCalledWith(
      "synthetic-event",
      "synthetic-flight-director-device",
      "synthetic-device-token",
      { rotationId: "rotation-1", limit: 200, offset: 0 },
    );
    expect(api.getForecastHistory).toHaveBeenLastCalledWith(
      "synthetic-event",
      "synthetic-flight-director-device",
      "synthetic-device-token",
      { rotationId: "rotation-1", limit: 200, offset: 2 },
    );
    expect(api.getResourceDayHistory).toHaveBeenCalledWith(
      "synthetic-event",
      "synthetic-flight-director-device",
      "synthetic-device-token",
      { scopeType: "AIRCRAFT", scopeId: "aircraft-1" },
    );
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

  it("coordinates queue selection, recalls, deferral, reservation and confirmation", async () => {
    const user = userEvent.setup();
    api.sendCommand.mockResolvedValue({ event: { version: 12 } });
    renderFlightLine();

    await user.click(screen.getByRole("button", { name: "Flugzeug auswählen" }));
    await user.click(screen.getByRole("button", { name: "Gruppe auswählen" }));
    await user.click(screen.getByRole("button", { name: "Gruppe aufrufen" }));
    const group = workspace.state.board?.queueGroups[0];
    expect(group).toBeDefined();
    if (group) {
      group.activeRecall = {
        expiresAt: "2026-08-11T09:10:00.000Z",
        fidsMessage: "Bitte kommen Sie zur Flight Line.",
        id: "recall-1",
        publicMessage: "Bitte kommen Sie zur Flight Line.",
        sequence: 1,
        startedAt: "2026-08-11T09:05:00.000Z",
      };
    }
    await supervisor.onGroupRecallClear?.("ticket-group-1", "recall-1");
    await supervisor.onGroupDefer?.("ticket-group-1");
    await user.click(screen.getByRole("button", { name: "Vorschlag reservieren" }));
    await user.click(screen.getByRole("button", { name: "Auswahl bestätigen" }));
    await user.click(screen.getByRole("button", { name: "Ressourcengruppe filtern" }));
    await user.click(screen.getByRole("button", { name: "Gruppe abwählen" }));

    await waitFor(() => expect(api.sendCommand).toHaveBeenCalledTimes(4));
    expect(api.sendCommand.mock.calls.map(([command]) => command.type)).toEqual([
      "START_TICKET_GROUP_RECALL",
      "CLEAR_TICKET_GROUP_RECALL",
      "DEFER_TICKET_GROUP",
      "CALL_NEXT",
    ]);
    expect(api.sendCommand.mock.calls[0]?.[0].payload).toEqual({
      ticketGroupId: "ticket-group-1",
    });
    expect(api.sendCommand.mock.calls[1]?.[0].payload).toEqual({
      recallId: "recall-1",
      ticketGroupId: "ticket-group-1",
    });
    expect(api.sendCommand.mock.calls[2]?.[0].payload).toEqual({
      reason: "Gruppe durch Flight Director zurückgestellt",
      ticketGroupId: "ticket-group-1",
    });
    expect(api.sendCommand.mock.calls[3]?.[0].payload).toEqual(
      expect.objectContaining({
        aircraftId: "aircraft-1",
        queueDeviationReason: "Synthetic deviation",
        ticketGroupIds: ["ticket-group-1"],
      }),
    );
    expect(dispatchLease.controller.reloadLatest).toHaveBeenCalledWith("aircraft-1", 11);
  });
});
