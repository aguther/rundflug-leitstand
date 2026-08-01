// @vitest-environment jsdom
import type { OperationBoard } from "@rundflug/contracts";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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

function renderWorkspace(operationBoard: OperationBoard) {
  render(
    <OperationalPlanWorkspace
      board={operationBoard}
      panelProps={{
        aircraft: operationBoard.aircraft,
        busy: false,
        eventId: operationBoard.event.eventId,
        eventTimeZone: operationBoard.event.timeZone,
        mode: "admin",
        onCancel: vi.fn(async () => undefined),
        onDisableRecurringRule: vi.fn(async () => undefined),
        onUpsert: vi.fn(async () => undefined),
        onUpsertRecurringRule: vi.fn(async () => undefined),
        pilots: operationBoard.pilots,
        plannedOperations: operationBoard.plannedOperations,
        recurringOperationalRules: operationBoard.recurringOperationalRules,
        resourceGroups: operationBoard.resourceGroups,
        rotations: operationBoard.rotations,
      }}
    />,
  );
}

afterEach(cleanup);

describe("OperationalPlanWorkspace", () => {
  it("separates constraints and recurring rules into stable tab panels", () => {
    renderWorkspace(board);

    const plansTab = screen.getByRole("tab", { name: "Einschränkungen" });
    const rulesTab = screen.getByRole("tab", { name: "Wiederkehrende Regeln" });
    const addPlanButton = screen.getByRole("button", { name: "Einschränkung hinzufügen" });
    expect(plansTab.getAttribute("aria-controls")).toBe("admin-operational-plan-plans-panel");
    expect(rulesTab.getAttribute("aria-controls")).toBe("admin-operational-plan-rules-panel");
    expect(addPlanButton.classList.contains("ds-button--primary")).toBe(true);
    expect(screen.queryByRole("button", { name: "Erste Einschränkung hinzufügen" })).toBeNull();
    expect(document.getElementById("admin-operational-plan-plans-panel")?.hidden).toBe(false);
    expect(document.getElementById("admin-operational-plan-rules-panel")?.hidden).toBe(true);
    expect(
      document
        .getElementById("admin-operational-plan-plans-panel")
        ?.classList.contains("operational-plan-workspace-panel"),
    ).toBe(true);

    fireEvent.click(rulesTab);
    expect(document.getElementById("admin-operational-plan-plans-panel")?.hidden).toBe(true);
    expect(document.getElementById("admin-operational-plan-rules-panel")?.hidden).toBe(false);
    expect(screen.getByText("Noch keine wiederkehrende Regel angelegt")).not.toBeNull();
    expect(
      screen.getByText(
        "Bei Fälligkeit entsteht ein weicher Planeintrag; Start und Ende bleiben menschlich bestätigt.",
      ),
    ).not.toBeNull();
    const rulesPanel = document.getElementById("admin-operational-plan-rules-panel");
    expect(rulesPanel?.querySelector(".operational-plan-title > span")?.textContent).toBe("0");
    expect(
      within(rulesPanel as HTMLElement).getByRole("columnheader", { name: "Regel" }),
    ).not.toBeNull();
    expect(
      within(rulesPanel as HTMLElement).getByRole("columnheader", { name: "Fortschritt" }),
    ).not.toBeNull();
    expect(
      within(rulesPanel as HTMLElement).getByRole("columnheader", { name: "Dauerband" }),
    ).not.toBeNull();
    expect(
      within(rulesPanel as HTMLElement).getByRole("columnheader", { name: "Nächste Fälligkeit" }),
    ).not.toBeNull();
    expect(
      within(rulesPanel as HTMLElement).getByRole("columnheader", { name: "Aktionen" }),
    ).not.toBeNull();
    const addRuleButton = screen.getByRole("button", { name: "Regel hinzufügen" });
    expect(addRuleButton.classList.contains("ds-button--primary")).toBe(true);
    expect(screen.getAllByRole("button", { name: "Regel hinzufügen" })).toHaveLength(1);
  });

  it("renders active recurring rules as counted table rows", () => {
    const boardWithRule = {
      ...board,
      aircraft: [{ id: "aircraft-1", registration: "D-EBXY" }],
      recurringOperationalRules: [
        {
          id: "rule-1",
          intervalValue: 5,
          kind: "REFUELING",
          maximumDurationMinutes: 18,
          minimumDurationMinutes: 8,
          openPlannedOperationId: null,
          progressValue: 1,
          scopeId: "aircraft-1",
          scopeType: "AIRCRAFT",
          status: "ACTIVE",
          triggerMetric: "COMPLETED_ROTATIONS",
          typicalDurationMinutes: 12,
          version: 1,
        },
      ],
    } as unknown as OperationBoard;

    renderWorkspace(boardWithRule);
    fireEvent.click(screen.getByRole("tab", { name: "Wiederkehrende Regeln" }));

    const rulesPanel = document.getElementById("admin-operational-plan-rules-panel");
    expect(rulesPanel?.querySelector(".operational-plan-title > span")?.textContent).toBe("1");
    expect(within(rulesPanel as HTMLElement).getByText("Tanken · D-EBXY")).not.toBeNull();
    expect(within(rulesPanel as HTMLElement).getByText("nach 5 Umläufen")).not.toBeNull();
    expect(within(rulesPanel as HTMLElement).getByText("1 / 5")).not.toBeNull();
    expect(within(rulesPanel as HTMLElement).getByText("8/12/18 Min.")).not.toBeNull();
    expect(within(rulesPanel as HTMLElement).getByText("in 4 Umläufen")).not.toBeNull();
    expect(
      within(rulesPanel as HTMLElement).getByRole("button", { name: "Regel bearbeiten" }),
    ).not.toBeNull();
    expect(
      within(rulesPanel as HTMLElement).getByRole("button", { name: "Regel deaktivieren" }),
    ).not.toBeNull();
  });
});
