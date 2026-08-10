// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminSimulationLauncher } from "./AdminSimulationLauncher";

const downloadSimulationPlan = vi.hoisted(() => vi.fn());

vi.mock("../../../api", () => ({ downloadSimulationPlan }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("admin simulation launcher", () => {
  it("keeps the simulation export unavailable without a loaded board", () => {
    render(
      <AdminSimulationLauncher
        available={false}
        busyActionKey={null}
        onMessage={vi.fn()}
        onRunBusyAction={vi.fn()}
      />,
    );

    expect(
      (
        screen.getByRole("button", {
          name: "Simulationsgrundlage exportieren",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(screen.getByText("Nur Simulation")).toBeTruthy();
    expect(
      screen.getByText("Tickets, Ist-Verläufe und operative Zustände werden nicht exportiert.", {
        exact: false,
      }),
    ).toBeTruthy();
    const simulatorLink = screen.getByRole("link", { name: "Prognose-Simulator öffnen" });
    expect(simulatorLink.getAttribute("href")).toBe("/simulation");
    expect(simulatorLink.getAttribute("target")).toBe("_blank");
    expect(simulatorLink.getAttribute("rel")).toBe("noopener");
  });

  it("exports through the shared busy-action boundary", async () => {
    downloadSimulationPlan.mockResolvedValue(undefined);
    const onMessage = vi.fn();
    const onRunBusyAction = vi.fn((_key: string, action: () => Promise<void>) => action());
    render(
      <AdminSimulationLauncher
        available
        busyActionKey={null}
        onMessage={onMessage}
        onRunBusyAction={onRunBusyAction}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Simulationsgrundlage exportieren" }));

    await waitFor(() => expect(downloadSimulationPlan).toHaveBeenCalledOnce());
    expect(onRunBusyAction).toHaveBeenCalledWith("export-simulation-plan", expect.any(Function));
    expect(onMessage).toHaveBeenCalledWith(
      "Stammdaten und offener Betriebsplan wurden für die Simulation exportiert.",
    );
  });
});
