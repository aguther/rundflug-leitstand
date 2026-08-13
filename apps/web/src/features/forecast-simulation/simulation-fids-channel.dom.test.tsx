// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runSimulation } from "./engine";
import { simulationConfigForPreset } from "./model";
import {
  SIMULATION_FIDS_CHANNEL_NAME,
  SIMULATION_FIDS_PROTOCOL_VERSION,
  useSimulationFidsPublisher,
} from "./simulation-fids-channel";

class MockBroadcastChannel extends EventTarget {
  static instances: MockBroadcastChannel[] = [];
  readonly name: string;
  readonly sent: unknown[] = [];
  readonly close = vi.fn();

  constructor(name: string) {
    super();
    this.name = name;
    MockBroadcastChannel.instances.push(this);
  }

  postMessage(message: unknown) {
    this.sent.push(message);
  }

  receive(message: unknown) {
    this.dispatchEvent(new MessageEvent("message", { data: message }));
  }
}

const baseline = runSimulation(simulationConfigForPreset("NORMAL"));

function PublisherProbe({
  clockMs,
  result = baseline,
}: Readonly<{ clockMs: number; result?: typeof baseline }>) {
  const { fidsHref, sourceId } = useSimulationFidsPublisher({
    result,
    clockMs,
    running: false,
    speed: 10,
    visibleAt: clockMs,
  });
  return (
    <a href={fidsHref}>
      {sourceId}:{clockMs}
    </a>
  );
}

beforeEach(() => {
  MockBroadcastChannel.instances.length = 0;
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-13T10:00:00.000Z"));
  vi.stubGlobal("BroadcastChannel", MockBroadcastChannel);
  vi.stubGlobal("crypto", { randomUUID: vi.fn(() => "source-0001") });
  window.history.replaceState(null, "", "/simulation?page=2&setup=1");
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("simulation FIDS publisher", () => {
  it("creates a stable source URL and separates full states from lightweight heartbeats", () => {
    const initialClock = Date.parse("2026-07-22T09:00:00.000Z");
    const rendered = render(<PublisherProbe clockMs={initialClock} />);
    const channel = MockBroadcastChannel.instances[0];

    expect(channel?.name).toBe(SIMULATION_FIDS_CHANNEL_NAME);
    expect(window.location.search).toContain("source=source-0001");
    expect(screen.getByRole("link").getAttribute("href")).toBe(
      "/simulation/fids?source=source-0001&page=2&setup=1",
    );
    expect(
      channel?.sent.filter((message) => (message as { type?: string }).type === "STATE"),
    ).toHaveLength(1);

    rendered.rerender(<PublisherProbe clockMs={initialClock + 5_000} />);
    expect(
      channel?.sent.filter((message) => (message as { type?: string }).type === "STATE"),
    ).toHaveLength(1);
    act(() => vi.advanceTimersByTime(1_000));
    expect(channel?.sent.at(-1)).toMatchObject({
      type: "TICK",
      clockMs: initialClock + 5_000,
      sourceId: "source-0001",
    });
  });

  it("publishes a full state for result changes and matching state requests", () => {
    const rendered = render(<PublisherProbe clockMs={1} />);
    const channel = MockBroadcastChannel.instances[0];
    const changed = runSimulation({ ...simulationConfigForPreset("NORMAL"), seed: 20260813 });

    rendered.rerender(<PublisherProbe clockMs={2} result={changed} />);
    expect(channel?.sent.at(-1)).toMatchObject({ type: "STATE", result: changed });

    act(() => {
      channel?.receive({
        protocolVersion: SIMULATION_FIDS_PROTOCOL_VERSION,
        sentAt: Date.now(),
        type: "REQUEST_STATE",
        requestedSourceId: "source-0001",
      });
    });
    expect(channel?.sent.at(-1)).toMatchObject({
      type: "STATE",
      result: changed,
      clockMs: 2,
    });

    act(() => {
      channel?.receive({
        protocolVersion: SIMULATION_FIDS_PROTOCOL_VERSION,
        sentAt: Date.now(),
        type: "REQUEST_STATE",
        requestedSourceId: "source-0001",
      });
    });
    expect(
      channel?.sent.filter((message) => (message as { type?: string }).type === "STATE"),
    ).toHaveLength(4);

    const stateCount = channel?.sent.filter(
      (message) => (message as { type?: string }).type === "STATE",
    ).length;
    act(() => {
      channel?.receive({
        protocolVersion: SIMULATION_FIDS_PROTOCOL_VERSION,
        sentAt: Date.now(),
        type: "REQUEST_STATE",
        requestedSourceId: "different-source",
      });
    });
    expect(
      channel?.sent.filter((message) => (message as { type?: string }).type === "STATE"),
    ).toHaveLength(stateCount ?? 0);

    rendered.unmount();
    expect(channel?.sent.at(-1)).toMatchObject({
      type: "SOURCE_STOPPED",
      sourceId: "source-0001",
    });
    expect(channel?.close).toHaveBeenCalledOnce();
  });
});
