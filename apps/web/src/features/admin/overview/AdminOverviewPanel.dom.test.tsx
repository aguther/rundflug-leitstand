// @vitest-environment jsdom

import type { OperationBoard } from "@rundflug/contracts";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminOverviewPanel } from "./AdminOverviewPanel";

vi.mock("../AdminEventFlowChart", () => ({
  AdminEventFlowChart: () => <div>Verkauf und Abarbeitung</div>,
}));

const board = {
  event: { timeZone: "Europe/Berlin" },
  metrics: {
    openTickets: 12,
    activeRotations: 3,
    completedRotations: 7,
    averageBoardingMinutes: 4,
    averageFlightMinutes: 16,
    averageTurnaroundMinutes: 8,
    averageRotationMinutes: 28,
    averageWaitMinutes: 22,
    informationalRevenueCents: 12_345,
    activeDevices: 5,
    activePushSubscriptions: 9,
  },
} as unknown as OperationBoard;

afterEach(cleanup);

describe("admin overview panel", () => {
  it("presents the operational metrics and configured push subscriptions", () => {
    render(
      <AdminOverviewPanel
        board={board}
        eventFlow={null}
        eventFlowError={null}
        eventFlowLoading={false}
        pushConfigurationStatus="configured"
      />,
    );

    expect(screen.getByRole("region", { name: "Betriebskennzahlen" })).toBeTruthy();
    expect(screen.getByText("12")).toBeTruthy();
    expect(screen.getByText("Web-Push aktiv")).toBeTruthy();
    expect(screen.getByText("9")).toBeTruthy();
  });

  it("distinguishes missing push configuration from zero subscriptions", () => {
    render(
      <AdminOverviewPanel
        board={board}
        eventFlow={null}
        eventFlowError={null}
        eventFlowLoading={false}
        pushConfigurationStatus="missing"
      />,
    );

    expect(screen.getByText("Web-Push fehlt")).toBeTruthy();
    expect(screen.getByText(/Web-Push ist noch nicht eingerichtet/)).toBeTruthy();
    expect(screen.getByText("npm run cloudflare:configure-push")).toBeTruthy();
  });
});
