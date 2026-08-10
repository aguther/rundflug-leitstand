// @vitest-environment jsdom

import type { OperationBoard } from "@rundflug/contracts";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ManifestCorrectionPanel } from "./ManifestCorrectionPanel";

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
    communicationLabel: `F-RG001-${String(communicationNumber).padStart(3, "0")}`,
    queuePosition: communicationNumber,
    productCode: "SYN",
    productName: "Synthetic flight",
    status,
    ticketGroupId,
    bookingGroups: [],
    gateId: "gate-a",
    gateLabel: "Gate A",
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
    boardingWindowLowerAt: null,
    boardingWindowUpperAt: null,
    calledAt: null,
    deferralCount: 0,
    operationalNote: "",
    timeline: {
      planned: { boardingAt: null, departureAt: null, landingAt: null, completionAt: null },
      predicted: { boardingAt: null, departureAt: null, landingAt: null, completionAt: null },
      actual: { boardingAt: null, departureAt: null, landingAt: null, completionAt: null },
      predictionQuality: null,
      predictionUpdatedAt: null,
      extendsBeyondOperationsEnd: false,
      overtimeMinutes: 0,
    },
    tickets: [],
  };
}

const board = {
  rotations: [
    rotation("source-a", "group-a", "IN_FLIGHT", 11),
    rotation("source-b", "group-a", "LANDED", 12),
    rotation("target", "group-b", "COMPLETED", 13),
  ],
} as unknown as OperationBoard;

afterEach(cleanup);

describe("manifest correction panel", () => {
  it("keeps the whole booking group and correction-only safety language visible", () => {
    render(
      <ManifestCorrectionPanel administrator board={board} busy={false} onCorrect={vi.fn()} />,
    );

    expect(screen.getByText(/immer vollständig/)).toBeTruthy();
    expect(
      screen.getByText(/keine flugbetriebliche oder sicherheitsbezogene Freigabewirkung/),
    ).toBeTruthy();
    expect(screen.getByRole("option", { name: "F-RG001-011 + F-RG001-012" })).toBeTruthy();
  });

  it("requires candidate, target and an auditable reason before correction", () => {
    const onCorrect = vi.fn();
    render(
      <ManifestCorrectionPanel administrator board={board} busy={false} onCorrect={onCorrect} />,
    );

    const submit = screen.getByRole("button", { name: "Besetzung protokolliert korrigieren" });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Zu korrigierende Buchungsgruppe"), {
      target: { value: "group-a" },
    });
    fireEvent.change(screen.getByLabelText("Tatsächlicher Zielumlauf"), {
      target: { value: "target" },
    });
    fireEvent.change(screen.getByLabelText("Dokumentationsgrund"), {
      target: { value: "  Confirmed manifest correction  " },
    });

    expect((submit as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(submit);
    expect(onCorrect).toHaveBeenCalledWith("group-a", "target", "Confirmed manifest correction");
  });

  it("keeps the correction action disabled without administrator access", () => {
    render(
      <ManifestCorrectionPanel
        administrator={false}
        board={board}
        busy={false}
        onCorrect={vi.fn()}
      />,
    );

    expect(
      (
        screen.getByRole("button", {
          name: "Besetzung protokolliert korrigieren",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("shows an empty state when no rotation has departed", () => {
    render(
      <ManifestCorrectionPanel
        administrator
        board={{ rotations: [rotation("draft", "group-a", "DRAFT", 1)] } as OperationBoard}
        busy={false}
        onCorrect={vi.fn()}
      />,
    );

    expect(
      screen.getByText("Aktuell ist keine Korrektur nach Flugstart erforderlich."),
    ).toBeTruthy();
  });
});
