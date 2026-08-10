// @vitest-environment jsdom

import type { FidsBoardResponse, FidsBoardRow, FidsPreferences } from "@rundflug/contracts";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FidsDataSource, FidsRefreshRequest } from "./fids-data-source";
import type { FidsLocationAdapter } from "./fids-location";
import { useFidsExperience } from "./useFidsExperience";

const preferences: FidsPreferences = {
  visibleRows: 5,
  layout: "SINGLE",
  theme: "DARK",
  viewMode: "SPLIT",
  priorityGroupCount: 2,
  rotationIntervalSeconds: 5,
  groupSharedFlights: false,
  contentFilter: { productIds: [], gateIds: [] },
  version: 0,
};

const row = (
  rowId: string,
  status: FidsBoardRow["status"] = "WAITING",
  departedAt: string | null = null,
): FidsBoardRow => ({
  rowId,
  productId: "product-1",
  gateId: "gate-1",
  productName: "Panorama",
  productCode: "PAN",
  gateLabel: "Flight Line 1",
  communicationNumber: Number(rowId.replace(/\D/g, "")) + 1,
  ticketLabels: [`${rowId}/1`],
  aircraftRegistration: null,
  departedAt,
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

function splitBoard(
  lowerPage: number,
  overrides: Partial<FidsBoardResponse> = {},
): FidsBoardResponse {
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
    ...overrides,
  };
}

function boardWithDepartures(lowerPage: number, departures: FidsBoardRow[]): FidsBoardResponse {
  return splitBoard(lowerPage, {
    priority: {
      configuredCapacity: 2,
      effectiveCapacity: 2,
      totalItems: departures.length,
      overflowCount: 0,
      groups: departures,
    },
    page: {
      requestedPage: lowerPage,
      pageSize: 3,
      totalItems: 1,
      totalPages: 1,
      groups: [row("lower-1")],
    },
  });
}

function Harness({
  dataSource,
  onRenderedLowerRow,
}: {
  dataSource: FidsDataSource;
  onRenderedLowerRow?: (rowId: string) => void;
}) {
  const location: FidsLocationAdapter = {
    getPage: () => 1,
    setPage: () => undefined,
    isSetupMode: () => false,
    setSetupMode: () => undefined,
    getShareableUrl: () => "https://example.test/fids?page=1",
    subscribe: () => () => undefined,
  };
  const state = useFidsExperience({ dataSource, locationAdapter: location });
  onRenderedLowerRow?.(state.board?.page.groups[0]?.rowId ?? "");
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

  it("delays and coalesces realtime board refreshes", async () => {
    vi.useFakeTimers();
    let triggerRefresh: (request?: FidsRefreshRequest) => void = () => undefined;
    const loadBoard = vi.fn(async ({ lowerPage }: { lowerPage: number }) => splitBoard(lowerPage));
    const source = dataSource(loadBoard);
    source.subscribe = (refresh) => {
      triggerRefresh = refresh;
      return () => undefined;
    };
    render(<Harness dataSource={source} />);
    await act(async () => Promise.resolve());
    expect(loadBoard).toHaveBeenCalledTimes(1);

    act(() => {
      triggerRefresh({ mode: "realtime", eventVersion: 17 });
      triggerRefresh({ mode: "realtime", eventVersion: 19 });
      triggerRefresh({ mode: "realtime", eventVersion: 18 });
    });
    expect(loadBoard).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(750);
      await Promise.resolve();
    });
    expect(loadBoard).toHaveBeenCalledTimes(2);
  });

  it("refreshes once just after the next visible departure expiry", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-02T08:00:00.000Z"));
    const departure = row("departure-1", "IN_FLIGHT", "2026-08-02T07:59:50.000Z");
    const loadBoard = vi.fn(async ({ lowerPage }: { lowerPage: number }) =>
      boardWithDepartures(lowerPage, [departure]),
    );
    render(<Harness dataSource={dataSource(loadBoard)} />);
    await act(async () => Promise.resolve());
    expect(loadBoard).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(5_099);
      await Promise.resolve();
    });
    expect(loadBoard).toHaveBeenCalledTimes(1);
    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });
    expect(loadBoard).toHaveBeenCalledTimes(2);
  });

  it("plans only the nearest departure and replans after a confirmed refresh", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-02T08:00:00.000Z"));
    const first = row("departure-1", "IN_FLIGHT", "2026-08-02T07:59:50.000Z");
    const second = row("departure-2", "LANDED", "2026-08-02T07:59:55.000Z");
    let response = 0;
    const loadBoard = vi.fn(async ({ lowerPage }: { lowerPage: number }) => {
      response += 1;
      return boardWithDepartures(lowerPage, response === 1 ? [first, second] : [second]);
    });
    render(<Harness dataSource={dataSource(loadBoard)} />);
    await act(async () => Promise.resolve());

    await act(async () => {
      vi.advanceTimersByTime(5_100);
      await Promise.resolve();
    });
    expect(loadBoard).toHaveBeenCalledTimes(2);
    await act(async () => {
      vi.advanceTimersByTime(4_999);
      await Promise.resolve();
    });
    expect(loadBoard).toHaveBeenCalledTimes(2);
    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });
    expect(loadBoard).toHaveBeenCalledTimes(3);
  });

  it("does not loop when the server immediately returns the same expired departure", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-02T08:00:20.000Z"));
    const departure = row("departure-1", "COMPLETED", "2026-08-02T08:00:00.000Z");
    const loadBoard = vi.fn(async ({ lowerPage }: { lowerPage: number }) =>
      boardWithDepartures(lowerPage, [departure]),
    );
    render(<Harness dataSource={dataSource(loadBoard)} />);
    await act(async () => Promise.resolve());
    await act(async () => {
      vi.advanceTimersByTime(100);
      await Promise.resolve();
    });
    expect(loadBoard).toHaveBeenCalledTimes(2);
    await act(async () => {
      vi.advanceTimersByTime(10_000);
      await Promise.resolve();
    });
    expect(loadBoard).toHaveBeenCalledTimes(2);
  });

  it("cleans the departure timer on unmount", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-02T08:00:00.000Z"));
    const departure = row("departure-1", "IN_FLIGHT", "2026-08-02T07:59:50.000Z");
    const view = render(
      <Harness
        dataSource={dataSource(async ({ lowerPage }) =>
          boardWithDepartures(lowerPage, [departure]),
        )}
      />,
    );
    await act(async () => Promise.resolve());
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps the confirmed board when an expiry refresh fails", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-02T08:00:00.000Z"));
    const departure = row("departure-1", "IN_FLIGHT", "2026-08-02T07:59:50.000Z");
    let requestCount = 0;
    const loadBoard = vi.fn(async ({ lowerPage }: { lowerPage: number }) => {
      requestCount += 1;
      if (requestCount > 1) throw new Error("Offline beim Ablauf");
      return boardWithDepartures(lowerPage, [departure]);
    });
    render(<Harness dataSource={dataSource(loadBoard)} />);
    await act(async () => Promise.resolve());
    await act(async () => {
      vi.advanceTimersByTime(5_100);
      await Promise.resolve();
    });
    expect(screen.getByTestId("priority-row").textContent).toBe("departure-1");
    expect(screen.getByTestId("error").textContent).toBe("Offline beim Ablauf");
  });

  it("keeps the last valid lower page visible while an invalid page is reset", async () => {
    vi.useFakeTimers();
    let shrink = false;
    let triggerRefresh: () => void = () => undefined;
    const renderedRows: string[] = [];
    const source = dataSource(async ({ lowerPage }) => {
      if (shrink && lowerPage === 2) {
        return splitBoard(2, {
          page: {
            requestedPage: 2,
            pageSize: 3,
            totalItems: 1,
            totalPages: 1,
            groups: [],
          },
        });
      }
      return splitBoard(lowerPage, {
        page: {
          requestedPage: lowerPage,
          pageSize: 3,
          totalItems: shrink ? 1 : 6,
          totalPages: shrink ? 1 : 2,
          groups: [row(`lower-${lowerPage}`)],
        },
      });
    });
    source.subscribe = (refresh) => {
      triggerRefresh = refresh;
      return () => undefined;
    };
    render(
      <Harness dataSource={source} onRenderedLowerRow={(rowId) => renderedRows.push(rowId)} />,
    );
    await act(async () => Promise.resolve());
    await act(async () => {
      vi.advanceTimersByTime(5_000);
      await Promise.resolve();
    });
    expect(screen.getByTestId("lower-row").textContent).toBe("lower-2");
    renderedRows.length = 0;
    shrink = true;
    await act(async () => {
      triggerRefresh();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByTestId("lower-page").textContent).toBe("1");
    expect(screen.getByTestId("lower-row").textContent).toBe("lower-1");
    expect(renderedRows).not.toContain("");
  });
});
