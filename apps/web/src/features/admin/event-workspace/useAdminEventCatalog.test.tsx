// @vitest-environment jsdom

import type { EventCatalogEntry, OperationBoard } from "@rundflug/contracts";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAdminEventCatalog } from "./useAdminEventCatalog";

const mocks = vi.hoisted(() => ({
  cloneEvent: vi.fn(),
  deleteEvent: vi.fn(),
  downloadMasterDataTemplate: vi.fn(),
  getEventCatalog: vi.fn(),
}));

vi.mock("../../../api", () => mocks);

const events: EventCatalogEntry[] = [
  {
    eventId: "zulu-event",
    name: "Zulu event",
    eventDate: "2026-08-02",
    aerodrome: "EDZZ",
    archivedAt: null,
    status: "PREPARATION",
    templateSourceId: null,
    timeZone: "Europe/Berlin",
    version: 2,
  },
  {
    eventId: "alpha-event",
    name: "Alpha event",
    eventDate: "2026-08-01",
    aerodrome: "EDAA",
    archivedAt: null,
    status: "ACTIVE",
    templateSourceId: null,
    timeZone: "Europe/Berlin",
    version: 3,
  },
];

const board = {
  event: { eventId: "synthetic-event", version: 7, timeZone: "Europe/Berlin" },
} as OperationBoard;

function renderCatalog(administrator = true) {
  const onMessage = vi.fn();
  const onViewChange = vi.fn();
  const hook = renderHook(() =>
    useAdminEventCatalog({
      administrator,
      board,
      onMessage,
      onViewChange,
      view: "catalog",
    }),
  );
  return { ...hook, onMessage, onViewChange };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("admin event catalog state", () => {
  it("loads, searches and sorts the event catalog locally", async () => {
    mocks.getEventCatalog.mockResolvedValue({ events });
    const { result } = renderCatalog();

    await waitFor(() => expect(result.current.visibleEvents).toHaveLength(2));
    act(() => result.current.toggleSort("name"));
    expect(result.current.visibleEvents.map((entry) => entry.name)).toEqual([
      "Alpha event",
      "Zulu event",
    ]);
    act(() => result.current.setSearch("zulu-event"));
    expect(result.current.visibleEvents.map((entry) => entry.eventId)).toEqual(["zulu-event"]);
  });

  it("keeps creation validation and failures inside the event workflow", async () => {
    mocks.getEventCatalog.mockResolvedValue({ events: [] });
    mocks.cloneEvent.mockRejectedValue(new Error("Synthetic clone conflict"));
    const { result, onViewChange } = renderCatalog();

    act(() => result.current.openCreation());
    expect(onViewChange).toHaveBeenCalledWith("create");
    act(() => {
      result.current.setEventId("new-event");
      result.current.setName("New synthetic event");
      result.current.setEventDate("2026-08-03");
      result.current.setAerodrome("EDNE");
      result.current.setConfirmation("NEUSTART");
    });
    expect(result.current.creation.disabled).toBe(false);

    await act(() => result.current.createEvent());

    expect(mocks.cloneEvent).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.objectContaining({
        expectedSourceVersion: 7,
        eventId: "new-event",
        restartMode: "EMPTY",
      }),
    );
    expect(result.current.creation.error).toBe("Synthetic clone conflict");
  });

  it("requires exact deletion confirmation and refreshes the catalog", async () => {
    mocks.getEventCatalog.mockResolvedValue({ events });
    mocks.deleteEvent.mockResolvedValue({ setupRequired: false, assetCleanupPending: false });
    vi.spyOn(window, "prompt")
      .mockReturnValueOnce("alpha-event")
      .mockReturnValueOnce("Synthetic deletion reason");
    const { result, onMessage } = renderCatalog();
    await waitFor(() => expect(result.current.visibleEvents).toHaveLength(2));

    await act(() => result.current.removeEvent(events[1] as EventCatalogEntry));

    expect(mocks.deleteEvent).toHaveBeenCalledWith(
      expect.any(String),
      "alpha-event",
      3,
      expect.any(String),
      expect.any(String),
      "Synthetic deletion reason",
    );
    expect(onMessage).toHaveBeenCalledWith("Veranstaltung vollständig gelöscht.");
    expect(mocks.getEventCatalog).toHaveBeenCalledTimes(2);
  });

  it("does not load catalog data for non-administrators", () => {
    const { result } = renderCatalog(false);

    expect(mocks.getEventCatalog).not.toHaveBeenCalled();
    expect(result.current.creation.disabled).toBe(true);
  });
});
