import type { OperationBoard } from "@rundflug/contracts";
import { describe, expect, it } from "vitest";
import {
  eligibleMoveTargets,
  oversizeSplitPreview,
  replacementSuggestion,
  sharedGroupSegmentLabel,
} from "./operational-exceptions";

type Rotation = OperationBoard["rotations"][number];

function rotation(input: Partial<Rotation> & Pick<Rotation, "id" | "ticketGroupId">): Rotation {
  return {
    id: input.id,
    ticketGroupId: input.ticketGroupId,
    bookingGroups: input.bookingGroups ?? [],
    flightGroupId: `fg-${input.id}`,
    communicationNumber: input.queuePosition ?? 101,
    communicationLabel: `PAN-${input.queuePosition ?? 101}`,
    queuePosition: input.queuePosition ?? 1,
    productCode: input.productCode ?? "PAN",
    productName: "Panorama",
    status: input.status ?? "DRAFT",
    gateId: "gate",
    gateLabel: "Gate",
    aircraftId: null,
    aircraftRegistration: null,
    pilotId: null,
    pilotOperationalCode: null,
    suggestedPilotId: null,
    suggestedPilotOperationalCode: null,
    suggestedAircraftId: null,
    suggestedAircraftRegistration: null,
    ticketCount: input.tickets?.length ?? 1,
    baselineCapacity: input.baselineCapacity ?? 4,
    usableCapacity: input.usableCapacity ?? 4,
    capacityReduced: false,
    estimatedPassengerPayloadKg: null,
    predictedLowerMinutes: 0,
    predictedUpperMinutes: 0,
    calledAt: null,
    deferralCount: 0,
    operationalNote: "",
    timeline: {
      planned: { boardingAt: null, departureAt: null, landingAt: null, completionAt: null },
      predicted: { boardingAt: null, departureAt: null, landingAt: null, completionAt: null },
      actual: { boardingAt: null, departureAt: null, landingAt: null, completionAt: null },
      predictionQuality: null,
      predictionUpdatedAt: null,
    },
    tickets: input.tickets ?? [
      { id: `ticket-${input.id}`, status: "QUEUED", attendanceStatus: "NOT_CHECKED_IN" },
    ],
  };
}

describe("operative Sonderfälle", () => {
  it("zeigt die bestätigungspflichtige Aufteilung vollständig an", () => {
    expect(oversizeSplitPreview(7, 4)).toEqual({ required: true, slotSizes: [4, 3] });
    expect(oversizeSplitPreview(4, 4)).toEqual({ required: false, slotSizes: [4] });
  });

  it("kennzeichnet zusammengehörige Fluggruppensegmente stabil", () => {
    const later = rotation({ id: "b", ticketGroupId: "group", queuePosition: 2 });
    const earlier = rotation({ id: "a", ticketGroupId: "group", queuePosition: 1 });
    expect(sharedGroupSegmentLabel(later, [later, earlier])).toBe("Gemeinsame Gruppe 2/2");
  });

  it("bietet nur ganze passende Gruppen vor dem Flug als Ziel an", () => {
    const source = rotation({ id: "source", ticketGroupId: "source-group" });
    const target = rotation({ id: "target", ticketGroupId: "target-group", usableCapacity: 4 });
    const full = rotation({
      id: "full",
      ticketGroupId: "full-group",
      usableCapacity: 1,
      tickets: [{ id: "occupied", status: "QUEUED", attendanceStatus: "NOT_CHECKED_IN" }],
    });
    const flying = rotation({ id: "flying", ticketGroupId: "flying-group", status: "IN_FLIGHT" });
    expect(
      eligibleMoveTargets(source, [source, target, full, flying]).map(
        ({ rotation }) => rotation.id,
      ),
    ).toEqual(["target"]);
  });

  it("schlägt nur vollständig eingecheckte ganze Ersatzgruppen vor", () => {
    const target = rotation({ id: "target", ticketGroupId: "target-group", usableCapacity: 4 });
    const replacement = rotation({
      id: "replacement",
      ticketGroupId: "replacement-group",
      tickets: [{ id: "present", status: "CHECKED_IN", attendanceStatus: "CHECKED_IN" }],
    });
    expect(replacementSuggestion(target, [target, replacement])?.rotation.id).toBe("replacement");
  });
});
