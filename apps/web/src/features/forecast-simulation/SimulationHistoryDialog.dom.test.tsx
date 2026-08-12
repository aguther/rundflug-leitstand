// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { runSimulation } from "./engine";
import type { SimulationResult } from "./model";
import { simulationConfigForPreset } from "./model";
import { SimulationHistoryDialog } from "./SimulationHistoryDialog";

let result: SimulationResult;
let visibleAt: number;

beforeAll(() => {
  result = runSimulation(simulationConfigForPreset("NORMAL"));
  visibleAt = Date.parse(result.runWindow.endAt);
});

afterEach(cleanup);

function renderHistory() {
  const onClose = vi.fn();
  const onExport = vi.fn();
  render(
    <SimulationHistoryDialog
      initialAircraftId={result.aircraft[0]?.id ?? null}
      initialRotationId={result.rotations[0]?.id ?? null}
      onClose={onClose}
      onExport={onExport}
      open
      result={result}
      visibleAt={visibleAt}
    />,
  );
  return { onClose, onExport };
}

describe("simulation history dialog", () => {
  it("shows realized group milestones and filters the group rail", async () => {
    const user = userEvent.setup();
    renderHistory();
    const firstRotation = result.rotations[0];
    expect(firstRotation).toBeDefined();

    expect(screen.getByRole("dialog", { name: "Verlaufsauswertung" })).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: `Fluggruppe ${firstRotation?.communicationNumber}` }),
    ).toBeTruthy();
    expect(screen.getByText("Alle Prognose-Snapshots")).toBeTruthy();

    const search = screen.getByPlaceholderText("Fluggruppe suchen");
    await user.type(search, "does-not-exist");
    const rail = screen.getByRole("heading", { name: "Fluggruppen" }).parentElement;
    expect(rail).not.toBeNull();
    expect(within(rail as HTMLElement).queryAllByRole("button")).toHaveLength(0);
  });

  it("navigates from a bound group to the aircraft timeline and back", async () => {
    const user = userEvent.setup();
    renderHistory();
    const firstRotation = result.rotations[0];
    const aircraft = result.aircraft.find((entry) => entry.id === firstRotation?.aircraftId);
    if (!aircraft) throw new Error("Synthetic simulation must assign the first rotation");

    await user.click(
      screen.getByRole("button", { name: new RegExp(`${aircraft.registration} öffnen`) }),
    );
    expect(screen.getByRole("heading", { name: aircraft.registration })).toBeTruthy();
    expect(screen.getByText("Realisierte Umläufe")).toBeTruthy();
    expect(screen.getByText("Sperren und Rückkehrereignisse")).toBeTruthy();

    const groupButtons = screen.getAllByRole("button", { name: "Gruppe öffnen" });
    expect(groupButtons.length).toBeGreaterThan(0);
    await user.click(groupButtons[0] as HTMLButtonElement);
    expect(
      screen.getByRole("heading", { name: `Fluggruppe ${firstRotation?.communicationNumber}` }),
    ).toBeTruthy();
  });

  it("exports through the dialog action without mutating the selected history", async () => {
    const user = userEvent.setup();
    const { onExport } = renderHistory();

    await user.click(screen.getByRole("button", { name: /JSON exportieren/ }));

    expect(onExport).toHaveBeenCalledOnce();
    expect(screen.getByRole("tab", { name: "Fluggruppen" }).getAttribute("aria-selected")).toBe(
      "true",
    );
  });
});
