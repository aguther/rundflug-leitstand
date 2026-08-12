// @vitest-environment jsdom

import type { OperationBoard } from "@rundflug/contracts";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
  aircraft: [],
  pilots: [],
  products: [],
  queueGroups: [],
  resourceGroups: [],
  rotations: [],
} as unknown as OperationBoard;

const dispatchLease = {
  mode: "IDLE",
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

function renderConsole() {
  render(
    <FlightLineSupervisorConsole
      aircraft={[]}
      board={board}
      deviceId="synthetic-flight-line-device"
      deviceToken="synthetic-device-token"
      canManageOperations={false}
      dispatchLease={dispatchLease}
      loadForecastHistory={vi.fn().mockResolvedValue([])}
      loadResourceHistory={vi.fn()}
      onAssignPilot={vi.fn()}
      onConfirmAssignment={vi.fn().mockResolvedValue(false)}
      onGroupDefer={vi.fn()}
      onGroupRecall={vi.fn()}
      onGroupRecallClear={vi.fn()}
      onOpenOperations={vi.fn()}
      onPauseAircraft={vi.fn()}
      onReserveAssignment={vi.fn().mockResolvedValue(null)}
      onResourceGroupChange={vi.fn()}
      onRunRotation={vi.fn().mockResolvedValue(false)}
      onSelectAircraft={vi.fn()}
      onSetAircraftState={vi.fn()}
      onToggleGroup={vi.fn()}
      operationalSummary="Synthetischer Testbetrieb"
      operationalSummaryTone="notice"
      selectedAircraft={undefined}
      selectedQueueGroupIds={[]}
    />,
  );
}

describe("Flight Director analysis snapshot export", () => {
  beforeEach(() => {
    api.downloadAnalysisSnapshot.mockReset().mockResolvedValue(undefined);
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as never;
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
