// @vitest-environment jsdom
import type { OperationBoard } from "@rundflug/contracts";
import { fireEvent, render, screen } from "@testing-library/react";
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
  },
  metrics: { activeRotations: 2, openTickets: 4, completedRotations: 7 },
  products: [{ saleEnabled: true }, { saleEnabled: false }],
} as OperationBoard;

describe("OperationsWorkspace", () => {
  it("keeps three stable tab and panel relationships", () => {
    render(
      <OperationsWorkspace
        board={board}
        exceptions={<p>Sonderlageninhalt</p>}
        plan={<p>Planinhalt</p>}
        sales={<p>Verkaufsinhalt</p>}
      />,
    );

    const salesTab = screen.getByRole("tab", { name: "Verkauf und Kapazität" });
    expect(salesTab.getAttribute("aria-controls")).toBe("admin-operations-sales-panel");
    fireEvent.click(salesTab);
    expect(document.getElementById("admin-operations-sales-panel")?.hasAttribute("hidden")).toBe(false);
    expect(screen.getByText("Verkaufsinhalt").closest("section")?.hasAttribute("hidden")).toBe(false);
  });
});
