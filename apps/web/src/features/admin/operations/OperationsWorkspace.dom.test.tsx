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
  it("keeps the remaining operation tab and panel relationships", () => {
    render(
      <OperationsWorkspace
        board={board}
        exceptions={<p>Sonderlageninhalt</p>}
        plan={<p>Planinhalt</p>}
      />,
    );

    const exceptionsTab = screen.getByRole("tab", { name: "Sonderlagen" });
    expect(exceptionsTab.getAttribute("aria-controls")).toBe("admin-operations-exceptions-panel");
    fireEvent.click(exceptionsTab);
    expect(
      document.getElementById("admin-operations-exceptions-panel")?.hasAttribute("hidden"),
    ).toBe(false);
    expect(screen.getByText("Sonderlageninhalt").closest("section")?.hasAttribute("hidden")).toBe(
      false,
    );
    expect(screen.queryByRole("tab", { name: "Verkauf und Kapazität" })).toBeNull();
  });
});
