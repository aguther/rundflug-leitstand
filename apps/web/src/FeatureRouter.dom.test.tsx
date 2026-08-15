// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FeatureRouter } from "./FeatureRouter";

vi.mock("./admin-view", () => ({ AdminView: () => <p>Administration-Route</p> }));
vi.mock("./cashier-view", () => ({ CashierView: () => <p>Kassen-Route</p> }));
vi.mock("./fids-view", () => ({ FidsView: () => <p>FIDS-Route</p> }));
vi.mock("./flight-line-view", () => ({ FlightLineView: () => <p>Flight-Line-Route</p> }));
vi.mock("./features/forecast-simulation/ForecastSimulationView", () => ({
  default: () => <p>Simulations-Route</p>,
}));
vi.mock("./features/forecast-simulation/SimulationFidsView", () => ({
  default: () => <p>Simulations-FIDS-Route</p>,
}));
vi.mock("./privacy-view", () => ({ PrivacyView: () => <p>Datenschutz-Route</p> }));
vi.mock("./setup-view", () => ({ SetupView: () => <p>Setup-Route</p> }));
vi.mock("./ticket-status-view", () => ({
  TicketStatusView: ({ code }: { code: string }) => <p>Ticket {code}</p>,
}));
vi.mock("./group-status-view", () => ({
  GroupStatusView: ({ code }: { code: string }) => <p>Gruppe {code}</p>,
}));
vi.mock("./app/NotFoundPage", () => ({ NotFoundPage: () => <p>Not-found-Route</p> }));

async function expectRoute(path: string, text: string) {
  window.history.replaceState({}, "", path);
  render(<FeatureRouter />);
  expect(await screen.findByText(text)).toBeTruthy();
  cleanup();
}

describe("feature router", () => {
  afterEach(() => cleanup());

  it("routes public ticket and group codes case-insensitively", async () => {
    await expectRoute("/ticket/abcD23456789", "Ticket ABCD23456789");
    await expectRoute("/gruppe/zyxW98765432", "Gruppe ZYXW98765432");
  });

  it("routes every named workspace and only opens the cashier on its known paths", async () => {
    for (const [path, text] of [
      ["/setup", "Setup-Route"],
      ["/datenschutz", "Datenschutz-Route"],
      ["/flight-director", "Flight-Line-Route"],
      ["/flight-line", "Flight-Line-Route"],
      ["/fids", "FIDS-Route"],
      ["/admin", "Administration-Route"],
      ["/simulation", "Simulations-Route"],
      ["/simulation/fids", "Simulations-FIDS-Route"],
      ["/", "Kassen-Route"],
      ["/kasse", "Kassen-Route"],
      ["/unbekannt", "Not-found-Route"],
    ] as const) {
      await expectRoute(path, text);
    }
  });

  it("rejects malformed or ambiguous public codes", async () => {
    await expectRoute("/ticket/invalid-0000", "Not-found-Route");
    await expectRoute("/gruppe/short", "Not-found-Route");
  });
});
