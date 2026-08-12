// @vitest-environment jsdom

import type { OperationBoard } from "@rundflug/contracts";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminOperationalPlanPanel } from "./AdminOperationalPlanPanel";

const mocks = vi.hoisted(() => ({ sendCommand: vi.fn() }));

vi.mock("../../../api", () => ({ sendCommand: mocks.sendCommand }));
vi.mock("../../operations/operation-identity", () => ({
  useAdminOperationIdentity: () => ({
    eventId: "synthetic-event",
    deviceId: "synthetic-admin-device",
    deviceToken: "synthetic-device-token",
  }),
}));
vi.mock("./OperationalPlanWorkspace", () => ({
  OperationalPlanWorkspace: ({
    panelProps,
  }: {
    panelProps: {
      busy: boolean;
      onCancel: (plan: { id: string; version: number }) => Promise<void>;
      onDisableRecurringRule: (rule: { id: string; version: number }) => Promise<void>;
      onUpsert: (payload: { kind: string }) => Promise<void>;
      onUpsertRecurringRule: (payload: { kind: string }) => Promise<void>;
      readOnly: boolean;
    };
  }) => (
    <div>
      <output>{panelProps.busy ? "busy" : "ready"}</output>
      <button
        disabled={panelProps.readOnly}
        onClick={() => panelProps.onUpsert({ kind: "plan" })}
        type="button"
      >
        Save plan
      </button>
      <button
        disabled={panelProps.readOnly}
        onClick={() => panelProps.onCancel({ id: "plan-synthetic", version: 2 })}
        type="button"
      >
        Cancel plan
      </button>
      <button
        disabled={panelProps.readOnly}
        onClick={() => panelProps.onUpsertRecurringRule({ kind: "rule" })}
        type="button"
      >
        Save rule
      </button>
      <button
        disabled={panelProps.readOnly}
        onClick={() => panelProps.onDisableRecurringRule({ id: "rule-synthetic", version: 4 })}
        type="button"
      >
        Disable rule
      </button>
    </div>
  ),
}));

const board = {
  event: {
    eventId: "synthetic-event",
    version: 7,
    timeZone: "Europe/Berlin",
  },
  aircraft: [],
  pilots: [],
  plannedOperations: [],
  recurringOperationalRules: [],
  resourceGroups: [],
  rotations: [],
} as unknown as OperationBoard;

function renderPanel(overrides: Partial<Parameters<typeof AdminOperationalPlanPanel>[0]> = {}) {
  const onMessage = vi.fn();
  const onRefresh = vi.fn(async () => undefined);
  const onRefreshHistory = vi.fn(async () => undefined);
  const onRunBusyAction = vi.fn((_key: string, action: () => Promise<void>) => action());
  render(
    <AdminOperationalPlanPanel
      board={board}
      busy={false}
      onMessage={onMessage}
      onRefresh={onRefresh}
      onRefreshHistory={onRefreshHistory}
      onRunBusyAction={onRunBusyAction}
      readOnly={false}
      {...overrides}
    />,
  );
  return { onMessage, onRefresh, onRefreshHistory, onRunBusyAction };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("admin operational plan panel", () => {
  it("persists all planning commands with the current event version", async () => {
    mocks.sendCommand.mockResolvedValue(undefined);
    const callbacks = renderPanel();

    for (const [index, label] of [
      "Save plan",
      "Cancel plan",
      "Save rule",
      "Disable rule",
    ].entries()) {
      fireEvent.click(screen.getByRole("button", { name: label }));
      await waitFor(() => expect(mocks.sendCommand).toHaveBeenCalledTimes(index + 1));
      await waitFor(() => expect(callbacks.onRefresh).toHaveBeenCalledTimes(index + 1));
    }

    expect(mocks.sendCommand.mock.calls.map(([command]) => command.type)).toEqual([
      "UPSERT_PLANNED_OPERATION",
      "CANCEL_PLANNED_OPERATION",
      "UPSERT_RECURRING_OPERATIONAL_RULE",
      "DISABLE_RECURRING_OPERATIONAL_RULE",
    ]);
    expect(mocks.sendCommand.mock.calls.every(([command]) => command.expectedVersion === 7)).toBe(
      true,
    );
    expect(mocks.sendCommand.mock.calls[1]?.[0].payload).toEqual({
      planId: "plan-synthetic",
      planExpectedVersion: 2,
    });
    expect(mocks.sendCommand.mock.calls[3]?.[0].payload).toEqual({
      ruleId: "rule-synthetic",
      ruleExpectedVersion: 4,
      reason: "Wiederkehrende Tagesregel deaktiviert.",
    });
    expect(callbacks.onRefresh).toHaveBeenCalledTimes(4);
    expect(callbacks.onRefreshHistory).toHaveBeenCalledTimes(4);
    expect(callbacks.onRunBusyAction.mock.calls.map(([key]) => key)).toEqual([
      "admin-plan-upsert",
      "admin-plan-cancel",
      "admin-rule-upsert",
      "admin-rule-disable",
    ]);
  });

  it("keeps planning controls read-only without issuing commands", () => {
    renderPanel({ readOnly: true });

    expect((screen.getByRole("button", { name: "Save plan" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(mocks.sendCommand).not.toHaveBeenCalled();
  });

  it("reports command failures and skips refreshes", async () => {
    mocks.sendCommand.mockRejectedValue(new Error("Synthetic planning failure"));
    const callbacks = renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Save plan" }));

    await waitFor(() =>
      expect(callbacks.onMessage).toHaveBeenCalledWith("Synthetic planning failure"),
    );
    expect(callbacks.onRefresh).not.toHaveBeenCalled();
    expect(callbacks.onRefreshHistory).not.toHaveBeenCalled();
  });
});
