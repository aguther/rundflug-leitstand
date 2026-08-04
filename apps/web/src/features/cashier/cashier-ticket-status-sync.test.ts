import type { OperationBoard, TicketSearchResult } from "@rundflug/contracts";
import { describe, expect, it } from "vitest";
import {
  applyOperationBoardTicketStatuses,
  mergeRevalidatedTicketGroups,
  ticketGroupIdBatches,
} from "./cashier-ticket-status-sync";

function ticketGroup(
  ticketGroupId: string,
  overrides: Partial<TicketSearchResult> = {},
): TicketSearchResult {
  return {
    ticketGroupId,
    productId: "product-normal",
    productCode: "RN",
    productName: "Rundflug Normal",
    groupStatus: "QUEUED",
    groupSize: 3,
    queueSequence: 1,
    bookingGroupNumber: 1,
    bookingGroupLabel: "G-RN-0001",
    standby: false,
    soldAt: "2026-08-03T19:00:00.000Z",
    soldByOperatorAccountId: null,
    soldByOperatorLoginCode: null,
    communicationNumber: 1,
    communicationLabel: "F-RN-001",
    communicationNumbers: [1],
    communicationLabels: ["F-RN-001"],
    rotationStatus: "CALLED",
    rotationStatuses: ["CALLED"],
    ...overrides,
  };
}

function rotation(
  id: string,
  status: OperationBoard["rotations"][number]["status"],
  bookingGroupIds: string[],
): OperationBoard["rotations"][number] {
  return {
    id,
    version: 1,
    flightGroupId: `flight-group-${id}`,
    communicationNumber: 1,
    communicationLabel: "F-RN-001",
    queuePosition: 1,
    productCode: "RN",
    productName: "Rundflug Normal",
    status,
    bookingGroups: bookingGroupIds.map((bookingGroupId) => ({
      id: bookingGroupId,
      communicationNumber: 1,
      soldAt: "2026-08-03T19:00:00.000Z",
      ticketCount: 1,
      presentCount: 1,
    })),
    ticketGroupId: bookingGroupIds[0] ?? "ticket-group",
    gateId: "gate-hall",
    gateLabel: "Halle",
    aircraftId: null,
    aircraftRegistration: null,
    pilotId: null,
    pilotOperationalCode: null,
    suggestedPilotId: null,
    suggestedPilotOperationalCode: null,
    suggestedAircraftId: null,
    suggestedAircraftRegistration: null,
    ticketCount: bookingGroupIds.length,
    baselineCapacity: 3,
    usableCapacity: 3,
    capacityReduced: false,
    estimatedPassengerPayloadKg: null,
    predictedLowerMinutes: null,
    predictedUpperMinutes: null,
    boardingWindowLowerAt: null,
    boardingWindowUpperAt: null,
    calledAt: null,
  } as OperationBoard["rotations"][number];
}

describe("cashier ticket status synchronization", () => {
  it("batches every loaded ticket group within the API limit", () => {
    const ids = Array.from({ length: 121 }, (_, index) => `ticket-group-${index + 1}`);
    expect(ticketGroupIdBatches(ids).map((batch) => batch.length)).toEqual([50, 50, 21]);
    expect(ticketGroupIdBatches(ids).flat()).toEqual(ids);
  });

  it("updates loaded groups in place without changing their order", () => {
    const current = [ticketGroup("one"), ticketGroup("two"), ticketGroup("three")];
    const refreshed = [ticketGroup("three", { groupStatus: "COMPLETED" })];
    const merged = mergeRevalidatedTicketGroups(current, refreshed);
    expect(merged.map((result) => result.ticketGroupId)).toEqual(["one", "two", "three"]);
    expect(merged[2]?.groupStatus).toBe("COMPLETED");
  });

  it("uses the live board immediately when every split rotation is completed", () => {
    const [result] = applyOperationBoardTicketStatuses(
      [ticketGroup("shared", { rotationStatuses: ["CALLED"] })],
      [rotation("one", "COMPLETED", ["shared"]), rotation("two", "COMPLETED", ["shared"])],
    );
    expect(result?.groupStatus).toBe("COMPLETED");
    expect(result?.rotationStatuses).toEqual(["COMPLETED"]);
  });

  it("keeps a split group in progress while one live rotation is unfinished", () => {
    const [result] = applyOperationBoardTicketStatuses(
      [ticketGroup("shared", { rotationStatuses: ["COMPLETED"] })],
      [rotation("one", "COMPLETED", ["shared"]), rotation("two", "LANDED", ["shared"])],
    );
    expect(result?.groupStatus).toBe("QUEUED");
    expect(result?.rotationStatuses).toEqual(["COMPLETED", "LANDED"]);
  });
});
