// @vitest-environment jsdom

import type { OperationBoard } from "@rundflug/contracts";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  OperationalPlanPanel,
  type PlannedOperation,
  type RecurringOperationalRule,
} from "./OperationalPlanPanel";

const aircraft = [
  {
    id: "aircraft-a",
    registration: "D-ESYN",
    refuelReminderThreshold: 6,
  },
] as unknown as OperationBoard["aircraft"];
const pilots = [{ id: "pilot-a", operationalCode: "P-01" }] as unknown as OperationBoard["pilots"];
const resourceGroups = [
  { id: "group-a", name: "Panorama", activeAircraftIds: ["aircraft-a"] },
] as unknown as OperationBoard["resourceGroups"];
const rotations = [
  {
    id: "rotation-a",
    communicationLabel: "PA 7",
    status: "CALLED",
    aircraftId: "aircraft-a",
    pilotId: "pilot-a",
  },
] as unknown as OperationBoard["rotations"];

const plannedOperation = {
  id: "plan-a",
  version: 3,
  recurringRuleId: null,
  scopeType: "RESOURCE_GROUP",
  scopeId: "group-a",
  kind: "WEATHER",
  effectMode: "SLOWDOWN",
  durationMultiplierPercent: 175,
  startMode: "TIME_WINDOW",
  earliestStartAt: "2026-07-22T10:00:00.000Z",
  latestStartAt: "2026-07-22T10:30:00.000Z",
  afterRotationId: null,
  minimumDurationMinutes: 10,
  typicalDurationMinutes: 20,
  maximumDurationMinutes: 30,
  publicNote: "Synthetischer Wetterhinweis",
  status: "PLANNED",
} as unknown as PlannedOperation;

const activeOperation = {
  ...plannedOperation,
  id: "plan-active",
  version: 4,
  scopeType: "AIRCRAFT",
  scopeId: "aircraft-a",
  kind: "REFUELING",
  effectMode: "BLOCKING",
  durationMultiplierPercent: null,
  startMode: "AFTER_CURRENT_ROTATION",
  earliestStartAt: null,
  latestStartAt: null,
  afterRotationId: "rotation-a",
  publicNote: "",
  status: "ACTIVE",
} as unknown as PlannedOperation;

const recurringRule = {
  id: "rule-a",
  version: 5,
  scopeType: "AIRCRAFT",
  scopeId: "aircraft-a",
  kind: "REFUELING",
  triggerMetric: "COMPLETED_ROTATIONS",
  intervalValue: 6,
  progressValue: 2,
  minimumDurationMinutes: 8,
  typicalDurationMinutes: 12,
  maximumDurationMinutes: 18,
  openPlannedOperationId: null,
  status: "ACTIVE",
} as unknown as RecurringOperationalRule;

function renderPanel(overrides: Partial<Parameters<typeof OperationalPlanPanel>[0]> = {}) {
  const callbacks = {
    onCancel: vi.fn(async () => undefined),
    onConfirm: vi.fn(async () => undefined),
    onDisableRecurringRule: vi.fn(async () => undefined),
    onUpsert: vi.fn(async () => undefined),
    onUpsertRecurringRule: vi.fn(async () => undefined),
  };
  render(
    <OperationalPlanPanel
      aircraft={aircraft}
      busy={false}
      eventId="event-a"
      eventTimeZone="Europe/Berlin"
      mode="admin"
      pilots={pilots}
      plannedOperations={[]}
      readOnly={false}
      recurringOperationalRules={[]}
      resourceGroups={resourceGroups}
      rotations={rotations}
      {...callbacks}
      {...overrides}
    />,
  );
  return callbacks;
}

beforeEach(() => {
  vi.stubGlobal("crypto", { randomUUID: vi.fn(() => "synthetic-plan-id") });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("operational plan panel", () => {
  it("creates a time-window plan with validated public presentation data", async () => {
    const user = userEvent.setup();
    const callbacks = renderPanel();

    await user.click(screen.getByRole("button", { name: "Einschränkung hinzufügen" }));
    await user.selectOptions(screen.getByLabelText("Geltungsbereich"), "RESOURCE_GROUP");
    await user.selectOptions(screen.getByLabelText("Art"), "WEATHER");
    await user.selectOptions(screen.getByLabelText("Auswirkung"), "SLOWDOWN");
    const multiplier = screen.getByLabelText(/Verzögerungsfaktor/);
    await user.clear(multiplier);
    await user.type(multiplier, "180");
    await user.type(screen.getByLabelText(/Öffentlicher Hinweis/), "  Neutrale Information  ");
    await user.click(screen.getByRole("button", { name: "Einplanen" }));

    await waitFor(() => expect(callbacks.onUpsert).toHaveBeenCalledOnce());
    expect(callbacks.onUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        planId: "synthetic-plan-id",
        planExpectedVersion: null,
        scopeType: "RESOURCE_GROUP",
        scopeId: "group-a",
        kind: "WEATHER",
        effectMode: "SLOWDOWN",
        durationMultiplierPercent: 180,
        startMode: "TIME_WINDOW",
        publicNote: "Neutrale Information",
      }),
    );
    expect(screen.queryByRole("dialog", { name: "Einschränkung einplanen" })).toBeNull();
  });

  it("creates a scoped plan after an eligible current rotation", async () => {
    const user = userEvent.setup();
    const callbacks = renderPanel();

    await user.click(screen.getByRole("button", { name: "Einschränkung hinzufügen" }));
    await user.selectOptions(screen.getByLabelText("Geltungsbereich"), "AIRCRAFT");
    expect((screen.getByLabelText(/Öffentlicher Hinweis/) as HTMLInputElement).disabled).toBe(true);
    await user.selectOptions(screen.getByLabelText(/^Beginn/), "AFTER_CURRENT_ROTATION");
    await user.selectOptions(screen.getByLabelText(/Aktueller Bezugsumlauf/), "rotation-a");
    await user.click(screen.getByRole("button", { name: "Einplanen" }));

    await waitFor(() => expect(callbacks.onUpsert).toHaveBeenCalledOnce());
    expect(callbacks.onUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        scopeType: "AIRCRAFT",
        scopeId: "aircraft-a",
        startMode: "AFTER_CURRENT_ROTATION",
        earliestStartAt: null,
        latestStartAt: null,
        afterRotationId: "rotation-a",
      }),
    );
  });

  it("edits and cancels an existing plan with its expected version", async () => {
    const user = userEvent.setup();
    const callbacks = renderPanel({ plannedOperations: [plannedOperation] });

    expect(screen.getByText("Panorama")).toBeTruthy();
    expect(screen.getByText("Wetter · 175 %")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Wetter bearbeiten" }));
    expect((screen.getByLabelText(/Öffentlicher Hinweis/) as HTMLInputElement).value).toBe(
      "Synthetischer Wetterhinweis",
    );
    await user.click(screen.getByRole("button", { name: "Änderungen speichern" }));
    await waitFor(() => expect(callbacks.onUpsert).toHaveBeenCalledOnce());
    expect(callbacks.onUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ planId: "plan-a", planExpectedVersion: 3 }),
    );

    await user.click(screen.getByRole("button", { name: "Wetter absagen" }));
    await user.click(screen.getByRole("button", { name: "Planeintrag absagen" }));
    await waitFor(() => expect(callbacks.onCancel).toHaveBeenCalledWith(plannedOperation));
  });

  it("creates, edits and disables recurring rules", async () => {
    const user = userEvent.setup();
    const callbacks = renderPanel({ recurringOperationalRules: [recurringRule] });

    expect(screen.getByText("2 / 6")).toBeTruthy();
    expect(screen.getByText("in 4 Umläufen")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Regel bearbeiten" }));
    await user.selectOptions(screen.getByLabelText("Zielart"), "PILOT");
    await user.selectOptions(screen.getByLabelText("Auslöser"), "OPERATING_MINUTES");
    await user.click(screen.getByRole("button", { name: "Änderungen speichern" }));
    await waitFor(() => expect(callbacks.onUpsertRecurringRule).toHaveBeenCalledOnce());
    expect(callbacks.onUpsertRecurringRule).toHaveBeenCalledWith(
      expect.objectContaining({
        ruleId: "rule-a",
        ruleExpectedVersion: 5,
        rule: expect.objectContaining({
          scopeType: "PILOT",
          scopeId: "pilot-a",
          kind: "PAUSE",
          triggerMetric: "OPERATING_MINUTES",
        }),
      }),
    );

    await user.click(screen.getByRole("button", { name: "Regel deaktivieren" }));
    await user.click(
      within(
        screen.getByRole("alertdialog", { name: "Wiederkehrende Regel deaktivieren?" }),
      ).getByRole("button", { name: "Regel deaktivieren" }),
    );
    await waitFor(() =>
      expect(callbacks.onDisableRecurringRule).toHaveBeenCalledWith(recurringRule),
    );
  });

  it("offers explicit start and end confirmation only to the flight director", async () => {
    const user = userEvent.setup();
    const callbacks = renderPanel({
      mode: "flight-director",
      plannedOperations: [plannedOperation, activeOperation],
    });

    await user.click(screen.getByRole("button", { name: "Start bestätigen" }));
    await user.click(screen.getByRole("button", { name: "Ende bestätigen" }));

    expect(callbacks.onConfirm).toHaveBeenNthCalledWith(1, plannedOperation, true);
    expect(callbacks.onConfirm).toHaveBeenNthCalledWith(2, activeOperation, false);
  });
});
