// @vitest-environment jsdom

import type { OperationBoard } from "@rundflug/contracts";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { useDispatchRecommendationLease } from "../../dispatch-recommendation-lease";
import {
  callNextRecommendationPayload,
  LegacyAircraftActions,
  operationalSummaryPresentation,
  plannedAircraftState,
  plannedResourceGroupStatus,
  QueueGroupPassengerSummary,
  queuedSegmentTicketCount,
  RotationOvertimeNotice,
  rotationTicketGroupIds,
} from "./FlightLineViewPresentation";

type Rotation = OperationBoard["rotations"][number];
type QueueGroup = OperationBoard["queueGroups"][number];
type PlannedOperation = OperationBoard["plannedOperations"][number];
type DispatchLease = ReturnType<typeof useDispatchRecommendationLease>;

const baseQueueGroup = {
  id: "group-one",
  nextSegmentPresentCount: 1,
  nextSegmentTicketCount: 2,
  presentCount: 3,
  segmentCount: 2,
  segmentIndex: 2,
  ticketCount: 4,
} as QueueGroup;

const baseRotation = {
  bookingGroups: [{ id: "group-one" }, { id: "group-two" }],
  ticketGroupId: "legacy-group",
  timeline: {
    extendsBeyondOperationsEnd: true,
    overtimeMinutes: 7,
    predicted: { completionAt: "2026-08-15T14:45:00.000Z" },
  },
} as Rotation;

function plannedOperation(kind: PlannedOperation["kind"]): PlannedOperation {
  return { kind } as PlannedOperation;
}

function dispatchLease(input: {
  groupIds?: string[];
  mode?: DispatchLease["mode"];
  withLease?: boolean;
}): DispatchLease {
  return {
    lease:
      input.withLease === false
        ? null
        : {
            batchId: "batch-one",
            groupIds: input.groupIds ?? ["group-one", "group-two"],
            leaseId: "lease-one",
            planRevision: "revision-one",
          },
    mode: input.mode ?? "RESERVED",
  } as DispatchLease;
}

describe("Flight Line presentation behavior", () => {
  afterEach(() => cleanup());

  it("presents emergency, interruption, operational notes and normal operation by priority", () => {
    const board = {
      event: {
        emergencyMode: true,
        operationalInterrupted: true,
        operationalNote: "Event-Hinweis",
        status: "ACTIVE",
      },
    } as OperationBoard;
    expect(operationalSummaryPresentation(board, undefined)).toEqual({
      summary: "Not-Halt aktiv",
      tone: "critical",
    });
    expect(
      operationalSummaryPresentation(
        { ...board, event: { ...board.event, emergencyMode: false } },
        undefined,
      ),
    ).toEqual({ summary: "Betrieb unterbrochen", tone: "warning" });
    expect(
      operationalSummaryPresentation(
        {
          ...board,
          event: { ...board.event, emergencyMode: false, status: "PREPARATION" },
        },
        undefined,
      ),
    ).toEqual({ summary: "Betrieb nicht freigegeben", tone: "warning" });
    expect(
      operationalSummaryPresentation(
        { ...board, event: { ...board.event, emergencyMode: false, status: "CLOSED" } },
        undefined,
      ),
    ).toEqual({ summary: "Betrieb geschlossen", tone: "neutral" });
    expect(
      operationalSummaryPresentation(
        { ...board, event: { ...board.event, emergencyMode: false, status: "ARCHIVED" } },
        undefined,
      ),
    ).toEqual({ summary: "Veranstaltung archiviert", tone: "neutral" });
    expect(
      operationalSummaryPresentation(
        { ...board, event: { ...board.event, emergencyMode: true, status: "CLOSED" } },
        undefined,
      ),
    ).toEqual({ summary: "Not-Halt aktiv", tone: "critical" });
    expect(
      operationalSummaryPresentation(
        {
          ...board,
          event: {
            ...board.event,
            emergencyMode: false,
            operationalInterrupted: false,
          },
        },
        undefined,
      ),
    ).toEqual({ summary: "Event-Hinweis", tone: "notice" });
    expect(
      operationalSummaryPresentation(
        {
          ...board,
          event: {
            ...board.event,
            emergencyMode: false,
            operationalInterrupted: false,
            operationalNote: "",
          },
        },
        {
          operationalNote: "Ressourcengruppen-Hinweis",
        } as OperationBoard["resourceGroups"][number],
      ),
    ).toEqual({ summary: "Ressourcengruppen-Hinweis", tone: "notice" });
    expect(operationalSummaryPresentation(null, undefined)).toEqual({
      summary: "Stand wird geladen",
      tone: "neutral",
    });
  });

  it("uses an explicit group selection, then rotation groups, then the legacy group", () => {
    expect(rotationTicketGroupIds(["selected"], baseRotation)).toEqual(["selected"]);
    expect(rotationTicketGroupIds([], baseRotation)).toEqual(["group-one", "group-two"]);
    expect(rotationTicketGroupIds([], { ...baseRotation, bookingGroups: [] })).toEqual([
      "legacy-group",
    ]);
  });

  it("includes a dispatch recommendation only for the exact reserved group set", () => {
    expect(
      callNextRecommendationPayload(dispatchLease({ mode: "IDLE" }), ["group-one"]),
    ).toBeNull();
    expect(
      callNextRecommendationPayload(dispatchLease({ withLease: false }), ["group-one"]),
    ).toBeNull();
    expect(
      callNextRecommendationPayload(dispatchLease({ groupIds: ["group-one"] }), [
        "group-one",
        "group-two",
      ]),
    ).toBeNull();
    expect(
      callNextRecommendationPayload(dispatchLease({ groupIds: ["group-one", "different-group"] }), [
        "group-one",
        "group-two",
      ]),
    ).toBeNull();
    expect(callNextRecommendationPayload(dispatchLease({}), ["group-two", "group-one"])).toEqual({
      leaseId: "lease-one",
      recommendation: { batchId: "batch-one", planRevision: "revision-one" },
    });
  });

  it("maps planned activation and deactivation to aircraft and resource-group states", () => {
    expect(plannedAircraftState(plannedOperation("REFUELING"), false)).toBe("AVAILABLE");
    expect(plannedAircraftState(plannedOperation("REFUELING"), true)).toBe("REFUELING");
    expect(plannedAircraftState(plannedOperation("PAUSE"), true)).toBe("PAUSED");
    expect(plannedAircraftState(plannedOperation("OTHER"), true)).toBe("INTERRUPTED");
    expect(plannedResourceGroupStatus(plannedOperation("PAUSE"), false)).toBe("ACTIVE");
    expect(plannedResourceGroupStatus(plannedOperation("PAUSE"), true)).toBe("PAUSED");
    expect(plannedResourceGroupStatus(plannedOperation("OTHER"), true)).toBe("INTERRUPTED");
  });

  it("shows segment and attendance counts, including legacy and singular fallbacks", () => {
    expect(queuedSegmentTicketCount(baseQueueGroup)).toBe(2);
    render(<QueueGroupPassengerSummary group={baseQueueGroup} />);
    expect(screen.getByText("2 von 4 Personen · Teil 2/2 · 1/2 anwesend")).toBeTruthy();
    cleanup();

    const legacyGroup = {
      ...baseQueueGroup,
      nextSegmentPresentCount: undefined,
      nextSegmentTicketCount: undefined,
      presentCount: 1,
      segmentCount: 1,
      ticketCount: 1,
    } as QueueGroup;
    render(<QueueGroupPassengerSummary group={legacyGroup} />);
    expect(screen.getByText("1 Person · 1/1 anwesend")).toBeTruthy();
  });

  it("offers only the aircraft actions permitted by role and current state", async () => {
    const user = userEvent.setup();
    const onPause = vi.fn();
    const onSetState = vi.fn();
    const availableAircraft = {
      operationalState: "AVAILABLE",
    } as OperationBoard["aircraft"][number];
    const { rerender } = render(
      <LegacyAircraftActions
        aircraft={availableAircraft}
        canManageAircraft={false}
        onPause={onPause}
        onSetState={onSetState}
      />,
    );
    expect(
      screen.getByText("Flottenstatus wird durch die Flight-Line-Leitung gesteuert."),
    ).toBeTruthy();

    rerender(
      <LegacyAircraftActions
        aircraft={availableAircraft}
        canManageAircraft
        onPause={onPause}
        onSetState={onSetState}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Pause" }));
    await user.click(screen.getByRole("button", { name: "Tanken" }));
    await user.click(screen.getByRole("button", { name: "Herausnehmen" }));
    expect(onPause).toHaveBeenCalledOnce();
    expect(onSetState.mock.calls).toEqual([["REFUELING"], ["INACTIVE"]]);

    rerender(
      <LegacyAircraftActions
        aircraft={{ operationalState: "PAUSED" } as OperationBoard["aircraft"][number]}
        canManageAircraft
        onPause={onPause}
        onSetState={onSetState}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Wieder verfügbar" }));
    expect(onSetState).toHaveBeenLastCalledWith("AVAILABLE");

    rerender(
      <LegacyAircraftActions
        aircraft={{ operationalState: "IN_FLIGHT" } as OperationBoard["aircraft"][number]}
        canManageAircraft
        onPause={onPause}
        onSetState={onSetState}
      />,
    );
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows overtime only when the forecast extends beyond operations end", () => {
    const { rerender } = render(
      <RotationOvertimeNotice rotation={baseRotation} timeZone="Europe/Berlin" />,
    );
    expect(
      screen.getByText(/Voraussichtlicher Abschluss nach Betriebsende: 16:45 · \+7 Min\./),
    ).toBeTruthy();
    rerender(
      <RotationOvertimeNotice
        rotation={{
          ...baseRotation,
          timeline: { ...baseRotation.timeline, extendsBeyondOperationsEnd: false },
        }}
        timeZone="Europe/Berlin"
      />,
    );
    expect(screen.queryByText(/Voraussichtlicher Abschluss/)).toBeNull();
  });
});
