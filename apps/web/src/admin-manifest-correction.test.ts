import type { OperationBoard } from "@rundflug/contracts";
import { describe, expect, it } from "vitest";
import {
  manifestCorrectionCandidates,
  manifestCorrectionTargets,
} from "./admin-manifest-correction";

type Rotation = OperationBoard["rotations"][number];

function rotation(
  id: string,
  ticketGroupId: string,
  status: Rotation["status"],
  communicationNumber: number,
): Rotation {
  return {
    id,
    version: 0,
    flightGroupId: `flight-${id}`,
    communicationNumber,
    communicationLabel: `SYN-${String(communicationNumber).padStart(3, "0")}`,
    queuePosition: communicationNumber,
    productCode: "SYN",
    productName: "Synthetischer Rundflug",
    status,
    ticketGroupId,
    bookingGroups: [],
    gateId: "gate-1",
    gateLabel: "Gate 1",
    aircraftId: null,
    aircraftRegistration: null,
    pilotId: null,
    pilotOperationalCode: null,
    suggestedPilotId: null,
    suggestedPilotOperationalCode: null,
    suggestedAircraftId: null,
    suggestedAircraftRegistration: null,
    ticketCount: 2,
    baselineCapacity: 4,
    usableCapacity: 4,
    capacityReduced: false,
    estimatedPassengerPayloadKg: null,
    predictedLowerMinutes: 5,
    predictedUpperMinutes: 15,
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
    tickets: [],
  };
}

describe("administrative manifest correction", () => {
  it("offers only groups that have reached a post-departure state", () => {
    const candidates = manifestCorrectionCandidates([
      rotation("draft", "group-draft", "DRAFT", 1),
      rotation("flying", "group-live", "IN_FLIGHT", 2),
      rotation("landed", "group-landed", "LANDED", 3),
    ]);

    expect(candidates.map((candidate) => candidate.ticketGroupId)).toEqual([
      "group-live",
      "group-landed",
    ]);
  });

  it("preserves a whole split group and excludes all source rotations from targets", () => {
    const rotations = [
      rotation("source-a", "group-split", "IN_FLIGHT", 11),
      rotation("source-b", "group-split", "LANDED", 12),
      rotation("draft-target", "group-draft", "DRAFT", 13),
      rotation("valid-target", "group-other", "COMPLETED", 14),
    ];
    const candidate = manifestCorrectionCandidates(rotations)[0];

    expect(candidate?.sourceRotations.map((entry) => entry.id)).toEqual(["source-a", "source-b"]);
    expect(manifestCorrectionTargets(rotations, candidate).map((entry) => entry.id)).toEqual([
      "valid-target",
    ]);
  });
});
