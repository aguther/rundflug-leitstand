// @vitest-environment jsdom

import type { FidsBoardResponse, FidsBoardRow, FidsPreferences } from "@rundflug/contracts";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FidsDataSource } from "./fids-data-source";
import type { FidsLocationAdapter } from "./fids-location";
import { useFidsExperience } from "./useFidsExperience";

const preferences: FidsPreferences = {
  visibleRows: 5,
  layout: "SINGLE",
  theme: "DARK",
  viewMode: "SPLIT",
  priorityGroupCount: 2,
  rotationIntervalSeconds: 5,
  contentFilter: { productIds: [], gateIds: [] },
  version: 0,
};

const row = (rowId: string, status: FidsBoardRow["status"] = "WAITING"): FidsBoardRow => ({
  rowId,
  productId: "product-1",
  gateId: "gate-1",
  productName: "Panorama",
  productCode: "PAN",
  gateLabel: "Flight Line 1",
  communicationNumber: Number(rowId.replace(/\D/g, "")) + 1,
  ticketLabels: [`${rowId}/1`],
  aircraftRegistration: null,
  departedAt: null,
  status,
  waitLowerMinutes: 0,
  waitUpperMinutes: 30,
  boardingWindowLowerAt: "2026-08-02T08:00:00.000Z",
  boardingWindowUpperAt: "2026-08-02T08:30:00.000Z",
  forecastState: "DISPATCH_WINDOW",
  forecastReason: null,
  dispatchOrder: null,
  predictionQuality: "STABLE",
  operationalNotice: "",
  activeRecall: null,
});

function splitBoard(lowerPage: number): FidsBoardResponse {
  return {
    eventName: "Synthetischer Flugtag",
    timeZone: "Europe/Berlin",
    emergencyMode: false,
    operationalInterrupted: false,
    operationalNotice: "",
    departedVisibilitySeconds: 15,
    updatedAt: "2026-08-02T07:00:00.000Z",
    preferencesVersion: 0,
    viewMode: "SPLIT",
    filterSummary: { productIds: [], gateIds: [] },
    priority: {
      configuredCapacity: 2,
      effectiveCapacity: 2,
      totalItems: 1,
      overflowCount: 0,
      groups: [row("priority-1", "BOARDING")],
    },
    page: {
      requestedPage: lowerPage,
      pageSize: 3,
      totalItems: 6,
      totalPages: 2,
      groups: [row(`lower-${lowerPage}`)],
    },
    fleet: [],
  };
}

function Harness({ dataSource }: { dataSource: FidsDataSource }) {
  const location: FidsLocationAdapter = {
    getPage: () => 1,
    setPage: () => undefined,
    isSetupMode: () => false,
    setSetupMode: () => undefined,
    getShareableUrl: () => "https://example.test/fids?page=1",
    subscribe: () => () => undefined,
  };
  const state = useFidsExperience({ dataSource, locationAdapter: location });
  return (
    <div>
      <span data-testid="lower-page">{state.lowerPage}</span>
      <span data-testid="priority-row">{state.board?.priority?.groups[0]?.rowId}</span>
      <span data-testid="lower-row">{state.board?.page.groups[0]?.rowId}</span>
      <span data-testid="error">{state.error}</span>
    </div>
  );
}

function dataSource(loadBoard: FidsDataSource["loadBoard"]): FidsDataSource {
  return {
    kind: "simulation",
    initialConnection: { connected: true, label: "SIMULATION", tone: "simulation" },
    loadPreferences: async () => preferences,
    loadFilterOptions: async () => ({ gates: [], products: [] }),
    loadBoard,
    savePreferences: async (next, expectedVersion) => ({ ...next, version: expectedVersion + 1 }),
    subscribe: () => () => undefined,
  };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("shared FIDS experience", () => {
  it("rotates only the lower split page and keeps the priority row stable", async () => {
    vi.useFakeTimers();
    const loadBoard = vi.fn(async ({ lowerPage }: { lowerPage: number }) => splitBoard(lowerPage));
    const view = render(<Harness dataSource={dataSource(loadBoard)} />);
    await act(async () => Promise.resolve());
    expect(screen.getByTestId("priority-row").textContent).toBe("priority-1");
    expect(screen.getByTestId("lower-row").textContent).toBe("lower-1");

    await act(async () => {
      vi.advanceTimersByTime(5_000);
      await Promise.resolve();
    });
    expect(screen.getByTestId("priority-row").textContent).toBe("priority-1");
    expect(screen.getByTestId("lower-row").textContent).toBe("lower-2");
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps the last confirmed board when a later refresh fails", async () => {
    let fail = false;
    let triggerRefresh: () => void = () => undefined;
    const source = dataSource(async ({ lowerPage }) => {
      if (fail) throw new Error("Offline");
      return splitBoard(lowerPage);
    });
    source.subscribe = (refresh) => {
      triggerRefresh = refresh;
      return () => undefined;
    };
    render(<Harness dataSource={source} />);
    await waitFor(() => expect(screen.getByTestId("lower-row").textContent).toBe("lower-1"));
    fail = true;
    act(() => triggerRefresh());
    await waitFor(() => expect(screen.getByTestId("error").textContent).toBe("Offline"));
    expect(screen.getByTestId("lower-row").textContent).toBe("lower-1");
  });
});
