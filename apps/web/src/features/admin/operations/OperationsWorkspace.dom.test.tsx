// @vitest-environment jsdom
import type { OperationBoard } from "@rundflug/contracts";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OperationsWorkspace } from "./OperationsWorkspace";

const board = {
  event: {
    eventId: "demo-event",
    version: 3,
    name: "Synthetischer Flugtag",
    eventDate: "2026-07-31",
    aerodrome: "EDXX",
    timeZone: "Europe/Berlin",
    status: "ACTIVE",
    emergencyMode: false,
    operationalInterrupted: false,
    saleOpensAt: null,
  },
  metrics: { activeRotations: 2, openTickets: 4, completedRotations: 7 },
  products: [
    { resourceGroupStatus: "ACTIVE", saleClosesAt: null, saleEnabled: true },
    { resourceGroupStatus: "ACTIVE", saleClosesAt: null, saleEnabled: false },
  ],
} as OperationBoard;

describe("OperationsWorkspace", () => {
  it("shows release and emergency controls without nested operation tabs", () => {
    render(
      <OperationsWorkspace
        board={board}
        emergency={<p>Notfallinhalt</p>}
        release={<p>Freigabeinhalt</p>}
      />,
    );

    expect(screen.getByText("Freigabeinhalt")).not.toBeNull();
    expect(screen.getByText("Notfallinhalt")).not.toBeNull();
    expect(screen.queryByRole("tab")).toBeNull();
    expect(document.querySelector(".operations-workspace-content")).not.toBeNull();
    expect(document.querySelector(".operations-workspace-controls")).not.toBeNull();
    expect(
      screen.getByText((_, element) => element?.textContent === "1 Produkte verkaufbar"),
    ).not.toBeNull();
  });

  it("shows no effectively sellable products after operations close", () => {
    render(
      <OperationsWorkspace
        board={{ ...board, event: { ...board.event, status: "CLOSED" } }}
        emergency={<p>Notfallinhalt</p>}
        release={<p>Freigabeinhalt</p>}
      />,
    );

    expect(
      screen.getByText((_, element) => element?.textContent === "0 Produkte verkaufbar"),
    ).not.toBeNull();
    expect(board.products[0]?.saleEnabled).toBe(true);
  });
});
