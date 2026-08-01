// @vitest-environment jsdom
import type { OperationBoard } from "@rundflug/contracts";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OperationalPlanWorkspace } from "./OperationalPlanWorkspace";

const board = {
  event: {
    eventId: "demo-event",
    version: 3,
    name: "Synthetischer Flugtag",
    eventDate: "2026-07-31",
    aerodrome: "EDXX",
    timeZone: "Europe/Berlin",
    status: "PREPARATION",
  },
  aircraft: [],
  pilots: [],
  plannedOperations: [],
  recurringOperationalRules: [],
  resourceGroups: [],
  rotations: [],
} as unknown as OperationBoard;

afterEach(cleanup);

describe("OperationalPlanWorkspace", () => {
  it("separates constraints and recurring rules into stable tab panels", () => {
    render(
      <OperationalPlanWorkspace
        board={board}
        panelProps={{
          aircraft: board.aircraft,
          busy: false,
          eventId: board.event.eventId,
          eventTimeZone: board.event.timeZone,
          mode: "admin",
          onCancel: vi.fn(async () => undefined),
          onDisableRecurringRule: vi.fn(async () => undefined),
          onUpsert: vi.fn(async () => undefined),
          onUpsertRecurringRule: vi.fn(async () => undefined),
          pilots: board.pilots,
          plannedOperations: board.plannedOperations,
          recurringOperationalRules: board.recurringOperationalRules,
          resourceGroups: board.resourceGroups,
          rotations: board.rotations,
        }}
      />,
    );

    const plansTab = screen.getByRole("tab", { name: "Einschränkungen" });
    const rulesTab = screen.getByRole("tab", { name: "Wiederkehrende Regeln" });
    expect(plansTab.getAttribute("aria-controls")).toBe("admin-operational-plan-plans-panel");
    expect(rulesTab.getAttribute("aria-controls")).toBe("admin-operational-plan-rules-panel");
    expect(document.getElementById("admin-operational-plan-plans-panel")?.hidden).toBe(false);
    expect(document.getElementById("admin-operational-plan-rules-panel")?.hidden).toBe(true);

    fireEvent.click(rulesTab);
    expect(document.getElementById("admin-operational-plan-plans-panel")?.hidden).toBe(true);
    expect(document.getElementById("admin-operational-plan-rules-panel")?.hidden).toBe(false);
  });
});
