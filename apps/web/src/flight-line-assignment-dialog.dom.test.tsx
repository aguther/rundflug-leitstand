// @vitest-environment jsdom

import type { DispatchRecommendationLease } from "@rundflug/contracts";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DispatchRecommendationLeaseController } from "./dispatch-recommendation-lease";
import {
  BookingGroupAssignmentDialog,
  type FlightLineAircraft,
  type FlightLineQueueGroup,
} from "./flight-line-shared";

function queueGroup(
  id: string,
  communicationNumber: number,
  overrides: Partial<FlightLineQueueGroup> = {},
): FlightLineQueueGroup {
  return {
    id,
    communicationNumber,
    productCode: "SYN",
    productId: "product-a",
    queueSequence: communicationNumber,
    status: "QUEUED",
    ticketCount: 1,
    presentCount: 0,
    precalledAt: null,
    dispatchReservation: null,
    activeRecall: null,
    ...overrides,
  } as FlightLineQueueGroup;
}

function controller(
  groupIds: string[],
  decisionReasons: string[] = ["CAPACITY_OPTIMIZED"],
): DispatchRecommendationLeaseController {
  const now = Date.now();
  const lease: DispatchRecommendationLease = {
    leaseId: "00000000-0000-4000-8000-000000000101",
    aircraftId: "aircraft-a",
    planRevision: "synthetic-plan",
    batchId: "synthetic-batch",
    dispatchOrder: 1,
    groupIds,
    occupiedSeats: groupIds.length,
    availableSeats: 3 - groupIds.length,
    decisionReasons,
    acquiredAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 90_000).toISOString(),
    serverNow: new Date(now).toISOString(),
  };
  return {
    mode: "RESERVED",
    lease,
    reservedEventVersion: 4,
    serverClockOffsetMs: 0,
    error: null,
    reserve: vi.fn(),
    reloadLatest: vi.fn(),
    release: vi.fn(),
    switchToManual: vi.fn(),
    markExpired: vi.fn(),
    markInvalidated: vi.fn(),
    consume: vi.fn(),
  };
}

const aircraft = {
  id: "aircraft-a",
  registration: "SYN-01",
  passengerSeats: 3,
  currentPilotId: "pilot-a",
} as FlightLineAircraft;

afterEach(() => cleanup());

describe("booking group assignment dialog", () => {
  it("shows compact call information and only recall and defer actions", () => {
    const selected = queueGroup("group-a", 1, {
      precalledAt: "2026-08-04T12:30:00.000Z",
    });
    const present = queueGroup("group-b", 2, { status: "PRESENT" });
    const { container } = render(
      <BookingGroupAssignmentDialog
        aircraft={aircraft}
        confirmDisabled={false}
        dispatchLease={controller([selected.id])}
        groups={[selected, present]}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        onDefer={vi.fn()}
        onRecall={vi.fn()}
        onRecallClear={vi.fn()}
        onReserveRecommendation={vi.fn()}
        onToggle={vi.fn()}
        open
        selectedQueueGroupIds={[selected.id]}
        timeZone="Europe/Berlin"
      />,
    );

    expect(screen.getByText("GO TO GATE")).toBeTruthy();
    expect(screen.getByText("14:30 Uhr")).toBeTruthy();
    expect(screen.getByText("Noch nicht")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Aktuellsten Vorschlag laden" })).toBeTruthy();
    expect(screen.getAllByText("Nachruf")).toHaveLength(1);
    expect(screen.getAllByText("Zurückstellen")).toHaveLength(2);
    expect(container.textContent).not.toMatch(/\d+\/\d+ anwesend/i);
    expect(screen.queryByRole("button", { name: /nicht da/i })).toBeNull();
    expect(container.querySelector(".flight-director-selection")).toBeNull();
    expect(container.querySelector(".flight-director-queue-row.is-present")).toBeTruthy();
    expect(screen.getByText("1 von 3 Plätzen ausgewählt")).toBeTruthy();
  });

  it("shows gate commitments before lower-priority fairness reasons", () => {
    const called = queueGroup("group-called", 1, {
      precalledAt: "2026-08-04T12:30:00.000Z",
    });
    render(
      <BookingGroupAssignmentDialog
        aircraft={aircraft}
        confirmDisabled={false}
        dispatchLease={controller(
          [called.id],
          ["HARD_COMMITMENT", "MUST_SERVE_MAX_WAIT", "MUST_SERVE_MAX_OVERTAKES"],
        )}
        groups={[called]}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        onDefer={vi.fn()}
        onRecall={vi.fn()}
        onRecallClear={vi.fn()}
        onReserveRecommendation={vi.fn()}
        onToggle={vi.fn()}
        open
        selectedQueueGroupIds={[called.id]}
        timeZone="Europe/Berlin"
      />,
    );

    expect(screen.getByText("Bereits aufgerufene Gruppen haben Vorrang.")).toBeTruthy();
  });

  it("combines maximum wait and confirmed overtake protection", () => {
    const waiting = queueGroup("group-waiting", 1);
    render(
      <BookingGroupAssignmentDialog
        aircraft={aircraft}
        confirmDisabled={false}
        dispatchLease={controller(
          [waiting.id],
          ["MUST_SERVE_MAX_WAIT", "MUST_SERVE_MAX_OVERTAKES"],
        )}
        groups={[waiting]}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        onDefer={vi.fn()}
        onRecall={vi.fn()}
        onRecallClear={vi.fn()}
        onReserveRecommendation={vi.fn()}
        onToggle={vi.fn()}
        open
        selectedQueueGroupIds={[waiting.id]}
        timeZone="Europe/Berlin"
      />,
    );

    expect(screen.getByText("Maximale Wartezeit und Überholschutz haben Vorrang.")).toBeTruthy();
  });
});
