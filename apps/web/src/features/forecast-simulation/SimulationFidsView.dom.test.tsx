// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runSimulation } from "./engine";
import { simulationConfigForPreset } from "./model";
import { SimulationFidsView } from "./SimulationFidsView";
import {
  SIMULATION_FIDS_PROTOCOL_VERSION,
  type SimulationFidsStateMessage,
} from "./simulation-fids-channel";

class MockBroadcastChannel extends EventTarget {
  static instances: MockBroadcastChannel[] = [];
  readonly sent: unknown[] = [];
  readonly close = vi.fn();

  constructor(readonly name: string) {
    super();
    MockBroadcastChannel.instances.push(this);
  }

  postMessage(message: unknown) {
    this.sent.push(message);
  }

  receive(message: unknown) {
    this.dispatchEvent(new MessageEvent("message", { data: message }));
  }
}

vi.mock("../../design-system/theme", () => ({
  useTheme: () => ({ resolved: "dark" }),
}));
vi.mock("../../fids-display", () => ({
  FidsDisplay: ({
    clockOverride,
    dataSource,
    simulationBanner,
    subtitle,
  }: {
    clockOverride: Date;
    dataSource: { initialConnection: { label: string } };
    simulationBanner: string;
    subtitle: string;
  }) => (
    <section aria-label="Simuliertes FIDS">
      <span>{simulationBanner}</span>
      <span>{subtitle}</span>
      <span>{dataSource.initialConnection.label}</span>
      <time>{clockOverride.toISOString()}</time>
    </section>
  ),
}));

const result = runSimulation(simulationConfigForPreset("NORMAL"));

function stateMessage(
  sourceId: string,
  sentAt: number,
  clockMs = Date.parse("2026-07-22T10:00:00.000Z"),
): SimulationFidsStateMessage {
  return {
    protocolVersion: SIMULATION_FIDS_PROTOCOL_VERSION,
    sentAt,
    type: "STATE",
    sourceId,
    result,
    clockMs,
    running: false,
    speed: 10,
    visibleAt: Date.parse(result.runWindow.startAt),
  };
}

beforeEach(() => {
  MockBroadcastChannel.instances.length = 0;
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-13T10:00:00.000Z"));
  vi.stubGlobal("BroadcastChannel", MockBroadcastChannel);
  window.history.replaceState(null, "", "/simulation/fids?page=2&setup=1");
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("standalone simulation FIDS view", () => {
  it("waits without a source, selects the newest discovery response, and preserves URL state", () => {
    render(<SimulationFidsView />);
    const channel = MockBroadcastChannel.instances[0];

    expect(screen.getByRole("heading", { name: "Warte auf laufende Simulation" })).toBeTruthy();
    const launch = screen.getByRole("link", { name: /Simulator in neuem Tab öffnen/ });
    expect(launch.getAttribute("href")).toBe("/simulation");
    expect(launch.getAttribute("target")).toBe("_blank");
    expect(channel?.sent[0]).toMatchObject({
      type: "REQUEST_STATE",
      requestedSourceId: null,
    });

    act(() => {
      channel?.receive(stateMessage("source-old", 10));
      channel?.receive(stateMessage("source-new", 20));
      vi.advanceTimersByTime(50);
    });

    expect(screen.getByRole("region", { name: "Simuliertes FIDS" })).toBeTruthy();
    expect(screen.getByText("LIVE-SIMULATION")).toBeTruthy();
    expect(window.location.search).toContain("source=source-new");
    expect(window.location.search).toContain("page=2");
    expect(window.location.search).toContain("setup=1");
  });

  it("keeps the last board on disconnect and resumes only from the bound source", () => {
    window.history.replaceState(null, "", "/simulation/fids?source=bound-source");
    render(<SimulationFidsView />);
    const channel = MockBroadcastChannel.instances[0];
    const initialClock = Date.parse("2026-07-22T10:00:00.000Z");

    act(() => channel?.receive(stateMessage("different-source", 10, initialClock)));
    expect(screen.getByRole("heading", { name: "Warte auf laufende Simulation" })).toBeTruthy();

    act(() => channel?.receive(stateMessage("bound-source", 20, initialClock)));
    expect(screen.getByText("LIVE-SIMULATION")).toBeTruthy();

    act(() =>
      channel?.receive({
        protocolVersion: SIMULATION_FIDS_PROTOCOL_VERSION,
        sentAt: Date.now(),
        type: "SOURCE_STOPPED",
        sourceId: "bound-source",
      }),
    );
    expect(screen.getByRole("region", { name: "Simuliertes FIDS" })).toBeTruthy();
    expect(screen.getByText("SIMULATION GETRENNT")).toBeTruthy();

    act(() =>
      channel?.receive({
        protocolVersion: SIMULATION_FIDS_PROTOCOL_VERSION,
        sentAt: Date.now(),
        type: "TICK",
        sourceId: "different-source",
        clockMs: initialClock + 1_000,
        running: false,
        speed: 10,
        visibleAt: Date.parse(result.runWindow.startAt),
      }),
    );
    expect(screen.getByText("SIMULATION GETRENNT")).toBeTruthy();

    act(() =>
      channel?.receive({
        protocolVersion: SIMULATION_FIDS_PROTOCOL_VERSION,
        sentAt: Date.now(),
        type: "TICK",
        sourceId: "bound-source",
        clockMs: initialClock + 2_000,
        running: false,
        speed: 10,
        visibleAt: Date.parse(result.runWindow.startAt),
      }),
    );
    expect(screen.getByText("LIVE-SIMULATION")).toBeTruthy();
    expect(screen.getByText(new Date(initialClock + 2_000).toISOString())).toBeTruthy();
  });

  it("marks a paused source disconnected after missed heartbeats", () => {
    window.history.replaceState(null, "", "/simulation/fids?source=paused-source");
    render(<SimulationFidsView />);
    const channel = MockBroadcastChannel.instances[0];

    act(() => channel?.receive(stateMessage("paused-source", Date.now())));
    expect(screen.getByText("LIVE-SIMULATION")).toBeTruthy();
    act(() => vi.advanceTimersByTime(4_000));
    expect(screen.getByText("SIMULATION GETRENNT")).toBeTruthy();
  });
});
