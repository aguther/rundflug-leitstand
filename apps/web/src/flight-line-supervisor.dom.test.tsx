// @vitest-environment jsdom

import type { OperationBoard } from "@rundflug/contracts";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiCommandError } from "./api";
import type { DispatchRecommendationLeaseController } from "./dispatch-recommendation-lease";
import { FlightLineSupervisorConsole } from "./flight-line-supervisor";

const api = vi.hoisted(() => ({
  downloadAnalysisSnapshot: vi.fn(),
}));

vi.mock("./api", async (importOriginal) => {
  const original = await importOriginal<typeof import("./api")>();
  return {
    ...original,
    downloadAnalysisSnapshot: api.downloadAnalysisSnapshot,
  };
});

const board = {
  event: {
    eventId: "synthetic-event",
    eventDate: "2026-08-04",
    timeZone: "Europe/Berlin",
    version: 38,
    emergencyMode: false,
    operationalInterrupted: false,
    status: "ACTIVE",
  },
  aircraft: [
    {
      id: "aircraft-1",
      version: 3,
      registration: "D-TEST",
      aircraftType: "C172",
      passengerSeats: 4,
      maximumPassengerPayloadKg: 320,
      operationalState: "AVAILABLE",
      operationalStateChangedAt: "2026-08-04T08:00:00.000Z",
      resourceGroupId: "resource-a",
      resourceGroupName: "Einmotorig",
      resourceGroupShortCode: "SEP",
      refuelPlanned: false,
      rotationsSinceRefuel: 1,
      refuelReminderThreshold: 4,
      expectedReviewAt: null,
      currentPilotId: "pilot-1",
      currentPilotOperationalCode: "P-01",
    },
    {
      id: "aircraft-2",
      version: 7,
      registration: "D-LAND",
      aircraftType: "PA28",
      passengerSeats: 3,
      maximumPassengerPayloadKg: 250,
      operationalState: "LANDED",
      operationalStateChangedAt: "2026-08-04T09:30:00.000Z",
      resourceGroupId: "resource-b",
      resourceGroupName: "Touring",
      resourceGroupShortCode: "TOU",
      refuelPlanned: true,
      rotationsSinceRefuel: 4,
      refuelReminderThreshold: 4,
      expectedReviewAt: null,
      currentPilotId: "pilot-2",
      currentPilotOperationalCode: "P-02",
    },
    {
      id: "aircraft-3",
      version: 2,
      registration: "D-FUEL",
      aircraftType: "C172",
      passengerSeats: 4,
      maximumPassengerPayloadKg: null,
      operationalState: "REFUELING",
      operationalStateChangedAt: "2026-08-04T09:35:00.000Z",
      resourceGroupId: "resource-a",
      resourceGroupName: "Einmotorig",
      resourceGroupShortCode: "SEP",
      refuelPlanned: false,
      rotationsSinceRefuel: 0,
      refuelReminderThreshold: 4,
      expectedReviewAt: "2026-08-04T09:45:00.000Z",
      currentPilotId: null,
      currentPilotOperationalCode: null,
    },
  ],
  pilots: [
    {
      id: "pilot-1",
      operationalCode: "P-01",
      operationalNote: "",
      active: true,
      paused: false,
      pauseExpectedReviewAt: null,
      currentRotationId: null,
      currentCommunicationNumber: null,
    },
    {
      id: "pilot-2",
      operationalCode: "P-02",
      operationalNote: "",
      active: true,
      paused: false,
      pauseExpectedReviewAt: null,
      currentRotationId: null,
      currentCommunicationNumber: null,
    },
  ],
  products: [],
  queueGroups: [
    {
      id: "ticket-queued",
      communicationNumber: 41,
      productId: "product-a",
      productCode: "PN",
      productName: "Panorama",
      resourceGroupId: "resource-a",
      gateId: "gate-a",
      queueSequence: 1,
      status: "QUEUED",
      ticketCount: 2,
      presentCount: 2,
      precalledAt: null,
      dispatchReservation: null,
      recalledAt: null,
      recallCount: 0,
      activeRecall: null,
    },
    {
      id: "ticket-present",
      communicationNumber: 42,
      productId: "product-a",
      productCode: "PN",
      productName: "Panorama",
      resourceGroupId: "resource-a",
      gateId: "gate-a",
      queueSequence: 2,
      status: "PRESENT",
      ticketCount: 1,
      presentCount: 1,
      precalledAt: "2026-08-04T09:20:00.000Z",
      dispatchReservation: null,
      recalledAt: null,
      recallCount: 1,
      activeRecall: null,
    },
  ],
  resourceGroups: [
    {
      id: "resource-a",
      name: "Einmotorig",
      shortCode: "SEP",
    },
    {
      id: "resource-b",
      name: "Touring",
      shortCode: "TOU",
    },
  ],
  rotations: [
    {
      id: "rotation-landed",
      version: 5,
      flightGroupId: "flight-group-18",
      communicationNumber: 18,
      communicationLabel: "PN-018",
      queuePosition: 1,
      productCode: "PN",
      productName: "Panorama",
      status: "LANDED",
      bookingGroups: [
        {
          id: "ticket-landed",
          communicationNumber: 17,
          soldAt: "2026-08-04T08:30:00.000Z",
          ticketCount: 2,
          presentCount: 2,
          partNumber: 1,
          partCount: 1,
        },
      ],
      ticketGroupId: "ticket-landed",
      gateId: "gate-b",
      gateLabel: "Flight Line",
      aircraftId: "aircraft-2",
      aircraftRegistration: "D-LAND",
      pilotId: "pilot-2",
      pilotOperationalCode: "P-02",
      suggestedPilotId: null,
      suggestedPilotOperationalCode: null,
      suggestedAircraftId: null,
      suggestedAircraftRegistration: null,
      ticketCount: 2,
      baselineCapacity: 3,
      usableCapacity: 3,
      capacityReduced: false,
      estimatedPassengerPayloadKg: 150,
      predictedLowerMinutes: 0,
      predictedUpperMinutes: 0,
      boardingWindowLowerAt: "2026-08-04T09:00:00.000Z",
      boardingWindowUpperAt: "2026-08-04T09:10:00.000Z",
      precalledAt: "2026-08-04T08:55:00.000Z",
      precallDecision: null,
      calledAt: "2026-08-04T09:00:00.000Z",
      dispatchPlan: null,
      deferralCount: 0,
      operationalNote: "",
      timeline: {
        planned: {
          boardingAt: "2026-08-04T09:00:00.000Z",
          departureAt: "2026-08-04T09:10:00.000Z",
          landingAt: "2026-08-04T09:30:00.000Z",
          completionAt: "2026-08-04T09:40:00.000Z",
        },
        predicted: {
          boardingAt: "2026-08-04T09:01:00.000Z",
          departureAt: "2026-08-04T09:11:00.000Z",
          landingAt: "2026-08-04T09:31:00.000Z",
          completionAt: "2026-08-04T09:41:00.000Z",
        },
        actual: {
          boardingAt: "2026-08-04T09:02:00.000Z",
          departureAt: "2026-08-04T09:12:00.000Z",
          landingAt: "2026-08-04T09:32:00.000Z",
          completionAt: null,
        },
        predictionQuality: "STABLE",
        predictionUpdatedAt: "2026-08-04T09:32:00.000Z",
        extendsBeyondOperationsEnd: true,
        overtimeMinutes: 5,
      },
      tickets: [],
    },
  ],
} as unknown as OperationBoard;

const dispatchLease = {
  mode: "MANUAL",
  lease: null,
  reservedEventVersion: null,
  serverClockOffsetMs: 0,
  error: null,
  reserve: vi.fn(),
  reloadLatest: vi.fn(),
  release: vi.fn(),
  switchToManual: vi.fn(),
  markExpired: vi.fn(),
  markInvalidated: vi.fn(),
  consume: vi.fn(),
} as unknown as DispatchRecommendationLeaseController;

type SupervisorProps = ComponentProps<typeof FlightLineSupervisorConsole>;

function renderConsole(overrides: Partial<SupervisorProps> = {}) {
  const props: SupervisorProps = {
    aircraft: board.aircraft,
    board,
    deviceId: "synthetic-flight-line-device",
    deviceToken: "synthetic-device-token",
    canManageOperations: false,
    dispatchLease,
    loadForecastHistory: vi.fn().mockResolvedValue([]),
    loadResourceHistory: vi.fn(),
    onAssignPilot: vi.fn(),
    onConfirmAssignment: vi.fn().mockResolvedValue(false),
    onGroupDefer: vi.fn(),
    onGroupRecall: vi.fn(),
    onGroupRecallClear: vi.fn(),
    onOpenOperations: vi.fn(),
    onPauseAircraft: vi.fn(),
    onReserveAssignment: vi.fn().mockResolvedValue(null),
    onResourceGroupChange: vi.fn(),
    onRunRotation: vi.fn().mockResolvedValue(false),
    onSelectAircraft: vi.fn(),
    onSetAircraftState: vi.fn(),
    onToggleGroup: vi.fn(),
    operationalSummary: "Synthetischer Testbetrieb",
    operationalSummaryTone: "notice",
    selectedAircraft: board.aircraft[0],
    selectedQueueGroupIds: ["ticket-queued"],
    ...overrides,
  };
  render(<FlightLineSupervisorConsole {...props} />);
  return props;
}

describe("Flight Director analysis snapshot export", () => {
  beforeEach(() => {
    window.localStorage.clear();
    api.downloadAnalysisSnapshot.mockReset().mockResolvedValue(undefined);
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as never;
    Object.defineProperty(window.navigator, "onLine", { configurable: true, value: true });
    vi.mocked(dispatchLease.release).mockReset().mockResolvedValue(undefined);
    vi.mocked(dispatchLease.switchToManual).mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => cleanup());

  it("V1120-DIA-030 announces a successful download without moving the action", async () => {
    const user = userEvent.setup();
    renderConsole();
    const action = screen.getByRole("button", {
      name: "Support-sichere Diagnose-Momentaufnahme herunterladen",
    });
    const actionSlot = action.parentElement;

    await user.click(action);

    expect(await screen.findByText("Diagnose-Momentaufnahme wurde heruntergeladen.")).toBeTruthy();
    expect(action.parentElement).toBe(actionSlot);
    expect(api.downloadAnalysisSnapshot).toHaveBeenCalledWith(
      "synthetic-event",
      "synthetic-flight-line-device",
      "synthetic-device-token",
      38,
      expect.any(Object),
    );
  });

  it("V1120-QA-010 distinguishes stale and retryable failures by error code", async () => {
    const user = userEvent.setup();
    api.downloadAnalysisSnapshot
      .mockRejectedValueOnce(
        new ApiCommandError("Localized text is irrelevant", "ANALYSIS_SNAPSHOT_STALE_VERSION", 412),
      )
      .mockRejectedValueOnce(
        new ApiCommandError(
          "Localized text is irrelevant",
          "ANALYSIS_SNAPSHOT_CAPTURE_FAILED",
          500,
        ),
      );
    renderConsole();
    const action = screen.getByRole("button", {
      name: "Support-sichere Diagnose-Momentaufnahme herunterladen",
    });

    await user.click(action);
    expect(
      await screen.findByText(
        "Der Betriebsstand hat sich geändert. Ansicht aktualisieren und Export erneut starten.",
      ),
    ).toBeTruthy();

    await user.click(action);
    expect(
      await screen.findByText(
        "Diagnose-Momentaufnahme konnte nicht erstellt werden. Bitte erneut versuchen.",
      ),
    ).toBeTruthy();
  });
});

describe("Flight Director operational coordination", () => {
  beforeEach(() => {
    window.localStorage.clear();
    api.downloadAnalysisSnapshot.mockReset().mockResolvedValue(undefined);
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as never;
    Object.defineProperty(window.navigator, "onLine", { configurable: true, value: true });
    vi.mocked(dispatchLease.release).mockReset().mockResolvedValue(undefined);
    vi.mocked(dispatchLease.switchToManual).mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => cleanup());

  it("filters the fleet and delegates access-controlled operation actions", async () => {
    const user = userEvent.setup();
    const onOpenOperations = vi.fn();
    const onResourceGroupChange = vi.fn();
    renderConsole({ canManageOperations: true, onOpenOperations, onResourceGroupChange });

    await user.click(screen.getByRole("button", { name: "Betrieb" }));
    await user.click(screen.getByRole("button", { name: "Betriebsplan" }));
    await user.click(screen.getByRole("button", { name: "Ressourcengruppen" }));
    expect(onOpenOperations.mock.calls).toEqual([["operations"], ["plan"], ["resources"]]);

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Ressourcengruppe filtern" }),
      "resource-b",
    );
    expect(onResourceGroupChange).toHaveBeenCalledWith("resource-b");
    expect(screen.getAllByText("D-LAND").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "D-FUEL zum Tanken setzen" })).toBeNull();
  });

  it("opens assignment, delegates queue choices, and releases the reservation on cancel", async () => {
    const user = userEvent.setup();
    const onReserveAssignment = vi.fn().mockResolvedValue(null);
    const onToggleGroup = vi.fn();
    const onGroupRecall = vi.fn();
    const onGroupDefer = vi.fn();
    renderConsole({ onGroupDefer, onGroupRecall, onReserveAssignment, onToggleGroup });

    await user.click(screen.getByRole("button", { name: "Belegung zuweisen" }));
    expect(onReserveAssignment).toHaveBeenCalledWith("aircraft-1");
    expect(screen.getByRole("dialog", { name: "Buchungsgruppen zuweisen" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "G-PN-0041 nachrufen" }));
    expect(onGroupRecall).toHaveBeenCalledWith("ticket-queued");

    await user.click(screen.getByRole("button", { name: "G-PN-0041 zurückstellen" }));
    expect(onGroupDefer).toHaveBeenCalledWith("ticket-queued");

    await user.click(screen.getByRole("checkbox", { name: /PN-0042/ }));
    expect(onToggleGroup).toHaveBeenCalledWith("ticket-present", true);

    await user.click(screen.getByRole("button", { name: "Abbrechen" }));
    expect(dispatchLease.release).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog", { name: "Buchungsgruppen zuweisen" })).toBeNull();
  });

  it("requires confirmation before moving a pilot assigned to another aircraft", async () => {
    const user = userEvent.setup();
    const onAssignPilot = vi.fn().mockResolvedValue(undefined);
    const onSelectAircraft = vi.fn();
    renderConsole({ onAssignPilot, onSelectAircraft });

    await user.click(screen.getByRole("button", { name: "Pilot für D-TEST zuweisen" }));
    expect(onSelectAircraft).toHaveBeenCalledWith("aircraft-1");
    await user.click(screen.getByRole("radio", { name: /P-02/ }));
    await user.click(screen.getByRole("button", { name: "Pilot zuweisen" }));

    expect(screen.getByRole("alertdialog", { name: "Pilotzuweisung wechseln?" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Pilot wechseln" }));
    expect(onAssignPilot).toHaveBeenCalledWith("aircraft-1", "pilot-2", true);
  });

  it("routes aircraft and landed-turnaround actions through their distinct command callbacks", async () => {
    const user = userEvent.setup();
    const onPauseAircraft = vi.fn();
    const onRunRotation = vi.fn().mockResolvedValue(true);
    const onSetAircraftState = vi.fn().mockResolvedValue(undefined);
    renderConsole({ onPauseAircraft, onRunRotation, onSetAircraftState });
    const landedRotation = board.rotations[0];

    await user.click(screen.getByRole("button", { name: "D-TEST zum Tanken setzen" }));
    expect(onSetAircraftState).toHaveBeenCalledWith("aircraft-1", "REFUELING");
    await user.click(screen.getByRole("button", { name: "D-TEST in Pause setzen" }));
    expect(onPauseAircraft).toHaveBeenCalledWith("aircraft-1");
    await user.click(screen.getByRole("button", { name: "Verfügbar setzen" }));
    expect(onSetAircraftState).toHaveBeenCalledWith("aircraft-3", "AVAILABLE");

    const turnaroundButton = screen.getByRole("button", { name: "Umlauf abschließen" });
    expect(turnaroundButton.getAttribute("data-label-density")).toBe("compact");
    await user.click(turnaroundButton);
    expect(onRunRotation).toHaveBeenCalledWith(landedRotation, "AVAILABLE");
    await user.click(screen.getByRole("button", { name: "D-LAND zum Tanken setzen" }));
    expect(onRunRotation).toHaveBeenCalledWith(landedRotation, "REFUELING");
    await user.click(screen.getByRole("button", { name: "D-LAND nicht verfügbar setzen" }));
    expect(onRunRotation).toHaveBeenCalledWith(landedRotation, "INACTIVE");
  });

  it("keeps ticket sorting and search local to the sold-ticket overview", async () => {
    const user = userEvent.setup();
    renderConsole();
    const sort = screen.getByRole("button", {
      name: "Ticketgruppe sortieren · Standardsortierung",
    });

    await user.click(sort);
    expect(
      screen.getByRole("button", { name: "Ticketgruppe sortieren · aufsteigend" }),
    ).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Ticketgruppe sortieren · aufsteigend" }));
    expect(
      screen.getByRole("button", { name: "Ticketgruppe sortieren · absteigend" }),
    ).toBeTruthy();

    const search = screen.getByRole("searchbox", { name: "Verkaufte Tickets suchen" });
    await user.type(search, "unbekannt");
    expect(screen.getByText("Noch keine verkauften Tickets.")).toBeTruthy();
    await user.clear(search);
    expect(
      await screen.findByRole("button", { name: /Tagesauswertung für G-PN-0017 anzeigen/ }),
    ).toBeTruthy();
  });

  it("collapses and resizes the sold-ticket overview without losing its controls", async () => {
    const user = userEvent.setup();
    renderConsole();
    const ticketPanel = screen.getByRole("region", { name: "Verkaufte Tickets" });
    const bottomGrid = ticketPanel.parentElement;
    const collapseButton = screen.getByRole("button", { name: "Verkaufte Tickets einklappen" });

    expect(bottomGrid?.classList.contains("size-balanced")).toBe(true);
    expect(collapseButton.querySelector(".lucide-panel-bottom-close")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Verkaufte Tickets vergrößern" }));
    expect(bottomGrid?.classList.contains("size-expanded")).toBe(true);
    await user.click(screen.getByRole("button", { name: "Verkaufte Tickets verkleinern" }));
    expect(bottomGrid?.classList.contains("size-balanced")).toBe(true);

    await user.click(screen.getByRole("button", { name: "Verkaufte Tickets einklappen" }));
    expect(bottomGrid?.classList.contains("is-collapsed")).toBe(true);
    expect(window.localStorage.getItem("flight-director:sold-tickets-collapsed:v1")).toBe("1");
    expect(screen.queryByRole("searchbox", { name: "Verkaufte Tickets suchen" })).toBeNull();
    expect(
      screen
        .getByRole("button", { name: "Verkaufte Tickets ausklappen" })
        .querySelector(".lucide-panel-bottom-open"),
    ).toBeTruthy();

    cleanup();
    renderConsole();
    const restoredPanel = screen.getByRole("region", { name: "Verkaufte Tickets" });
    expect(restoredPanel.parentElement?.classList.contains("is-collapsed")).toBe(true);

    await user.click(screen.getByRole("button", { name: "Verkaufte Tickets ausklappen" }));
    expect(restoredPanel.parentElement?.classList.contains("is-collapsed")).toBe(false);
    expect(screen.getByRole("searchbox", { name: "Verkaufte Tickets suchen" })).toBeTruthy();
    expect(window.localStorage.getItem("flight-director:sold-tickets-collapsed:v1")).toBeNull();
  });
});
