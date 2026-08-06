// @vitest-environment jsdom

import type { FidsBoardResponse, FidsBoardRow, FidsPreferences } from "@rundflug/contracts";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FidsBoardPresentation } from "./fids-display";

vi.mock("./design-system/BrandMark", () => ({ BrandMark: () => <span>Logo</span> }));
vi.mock("./design-system/theme", () => ({ useTheme: () => ({ system: "light" }) }));

const preferences: FidsPreferences = {
  visibleRows: 8,
  layout: "SINGLE",
  theme: "LIGHT",
  viewMode: "SPLIT",
  priorityGroupCount: 3,
  rotationIntervalSeconds: 12,
  groupSharedFlights: false,
  contentFilter: { productIds: [], gateIds: [] },
  version: 4,
};

function row(
  rowId: string,
  status: FidsBoardRow["status"],
  overrides: Partial<FidsBoardRow> = {},
): FidsBoardRow {
  return {
    rowId,
    productId: "product-synthetic",
    gateId: "gate-synthetic",
    productName: "Sehr langer synthetischer Panorama-Rundflug mit Sonderroute",
    productCode: "SYNTHETIC_ROUND_TRIP",
    gateLabel: "Sehr langes synthetisches Gate am westlichen Hallenende",
    communicationNumber: 42,
    ticketLabels: ["synthetic/1"],
    aircraftRegistration: null,
    departedAt: null,
    status,
    waitLowerMinutes: 20,
    waitUpperMinutes: 40,
    boardingWindowLowerAt: "2026-08-02T16:20:00.000Z",
    boardingWindowUpperAt: "2026-08-02T16:40:00.000Z",
    forecastState: "DISPATCH_WINDOW",
    forecastReason: null,
    dispatchOrder: 1,
    predictionQuality: "STABLE",
    operationalNotice: "",
    activeRecall: null,
    ...overrides,
  };
}

function splitBoard(overrides: Partial<FidsBoardResponse> = {}): FidsBoardResponse {
  return {
    eventName: "Synthetischer Flugtag",
    timeZone: "Europe/Berlin",
    emergencyMode: false,
    operationalInterrupted: false,
    operationalNotice: "",
    departedVisibilitySeconds: 15,
    updatedAt: "2026-08-02T16:00:00.000Z",
    preferencesVersion: 4,
    viewMode: "SPLIT",
    filterSummary: { productIds: [], gateIds: [] },
    priority: {
      configuredCapacity: 3,
      effectiveCapacity: 3,
      totalItems: 1,
      overflowCount: 0,
      groups: [row("priority", "COME_TO_FLIGHT_LINE")],
    },
    page: {
      requestedPage: 1,
      pageSize: 5,
      totalItems: 11,
      totalPages: 3,
      groups: [row("lower", "WAITING")],
    },
    fleet: [],
    ...overrides,
  };
}

function renderBoard(
  board: FidsBoardResponse | null,
  overrides: Partial<Parameters<typeof FidsBoardPresentation>[0]> = {},
) {
  return render(
    <FidsBoardPresentation
      board={board}
      clock={new Date("2026-08-02T16:00:00.000Z")}
      connectionLabel="VERBUNDEN"
      connectionTone="connected"
      error={null}
      preferences={preferences}
      {...overrides}
    />,
  );
}

afterEach(cleanup);

describe("FIDS board presentation", () => {
  it("shows lower paging beside the section title without a redundant split footer page", () => {
    const view = renderBoard(splitBoard());

    expect(screen.getByLabelText("Seite 1 von 3").textContent).toContain("SEITE 1 / 3");
    const lowerHeading = screen.getByRole("heading", { name: "WEITERE FLÜGE" });
    expect(lowerHeading.parentElement?.contains(screen.getByLabelText("Seite 1 von 3"))).toBe(true);
    expect(view.container.querySelector(".fids-footer-copy")?.textContent).not.toContain(
      "Unterseite",
    );
  });

  it("keeps section-specific empty states inside their bodies with every heading intact", () => {
    const board = splitBoard({
      priority: {
        configuredCapacity: 3,
        effectiveCapacity: 3,
        totalItems: 0,
        overflowCount: 0,
        groups: [],
      },
      page: {
        requestedPage: 1,
        pageSize: 5,
        totalItems: 0,
        totalPages: 0,
        groups: [],
      },
    });
    const view = renderBoard(board);
    const upperSection = screen.getByRole("heading", { name: "JETZT RELEVANT" }).closest("section");
    const lowerSection = screen.getByRole("heading", { name: "WEITERE FLÜGE" }).closest("section");

    expect(upperSection).not.toBeNull();
    expect(lowerSection).not.toBeNull();
    expect(
      within(upperSection as HTMLElement).getAllByText(
        "Derzeit keine unmittelbar relevanten Gruppen.",
      ),
    ).toHaveLength(2);
    expect(
      within(lowerSection as HTMLElement).getAllByText("Derzeit keine weiteren Gruppen."),
    ).toHaveLength(2);
    expect(view.container.querySelector(".standard-empty")).toBeNull();
    expect(screen.queryByLabelText("Seite 1 von 1")).toBeNull();
    expect(view.container.querySelectorAll(".fids-grid-head")).toHaveLength(6);
  });

  it("renders deterministic single-column slots for both split sections", () => {
    renderBoard(splitBoard());
    const upperSection = screen.getByRole("heading", { name: "JETZT RELEVANT" }).closest("section");
    const lowerSection = screen.getByRole("heading", { name: "WEITERE FLÜGE" }).closest("section");
    const upperSingle = upperSection?.querySelector(".fids-single-board");
    const lowerSingle = lowerSection?.querySelector(".fids-single-board");

    expect(upperSingle?.querySelectorAll(".fids-row")).toHaveLength(3);
    expect(upperSingle?.querySelectorAll(".fids-row--slot")).toHaveLength(2);
    expect(lowerSingle?.querySelectorAll(".fids-row")).toHaveLength(5);
    expect(lowerSingle?.querySelectorAll(".fids-row--slot")).toHaveLength(4);
  });

  it("keeps compact time, status, long labels, recall and highlight metadata accessible", () => {
    const activeRecall = {
      id: "00000000-0000-4000-8000-000000000001",
      sequence: 1,
      startedAt: "2026-08-02T16:00:00.000Z",
      expiresAt: "2026-08-02T16:05:00.000Z",
      fidsMessage: "Synthetischer Nachruf für Gruppe 42",
      publicMessage: "Synthetischer Nachruf",
    };
    const priorityRow = row("priority", "COME_TO_FLIGHT_LINE", { activeRecall });
    const board = splitBoard({
      priority: {
        configuredCapacity: 3,
        effectiveCapacity: 3,
        totalItems: 1,
        overflowCount: 0,
        groups: [priorityRow],
      },
    });
    const view = renderBoard(board, { highlightedRows: new Set(["priority"]) });

    expect(screen.getAllByText("BITTE ZUM GATE").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Jetzt").length).toBeGreaterThan(0);
    expect(screen.getAllByTitle(priorityRow.productName).length).toBeGreaterThan(0);
    expect(screen.getAllByTitle(priorityRow.gateLabel).length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText(activeRecall.fidsMessage).length).toBeGreaterThan(0);
    expect(view.container.querySelector('[data-highlighted="true"]')).not.toBeNull();
  });

  it("shows every booking group of a compacted shared flight", () => {
    const grouped = row("shared", "BOARDING", {
      bookingGroupLabels: ["G-PAN-0101/1", "G-PAN-0102", "G-PAN-0103/2"],
    });
    const board = splitBoard({
      priority: {
        configuredCapacity: 3,
        effectiveCapacity: 3,
        totalItems: 1,
        overflowCount: 0,
        groups: [grouped],
      },
    });

    const view = renderBoard(board);

    for (const label of grouped.bookingGroupLabels ?? []) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(view.container.querySelector('[data-group-count="3"]')).not.toBeNull();
  });

  it("uses Jetzt for every currently running public status", () => {
    const groups = (
      ["COME_TO_FLIGHT_LINE", "BOARDING", "IN_FLIGHT", "LANDED", "COMPLETED"] as const
    ).map((status, index) => row(`running-${index}`, status));
    const fixed = splitBoard({
      viewMode: "FIXED_PAGE",
      priority: null,
      page: {
        requestedPage: 1,
        pageSize: 8,
        totalItems: groups.length,
        totalPages: 1,
        groups,
      },
    });
    const view = renderBoard(fixed, {
      preferences: { ...preferences, viewMode: "FIXED_PAGE" },
    });

    const windows = Array.from(view.container.querySelectorAll(".fids-window"));
    expect(windows).toHaveLength(groups.length * 2);
    expect(windows.every((window) => window.textContent === "Jetzt")).toBe(true);
  });

  it("uses the fixed-page empty message while preserving the column headings", () => {
    const fixed = splitBoard({
      viewMode: "FIXED_PAGE",
      priority: null,
      page: {
        requestedPage: 2,
        pageSize: 8,
        totalItems: 0,
        totalPages: 0,
        groups: [],
      },
    });
    const view = renderBoard(fixed, {
      page: 2,
      preferences: { ...preferences, viewMode: "FIXED_PAGE" },
    });

    expect(screen.getAllByText("Aktuell keine Gruppen auf dieser Seite.")).toHaveLength(2);
    expect(view.container.querySelectorAll(".fids-grid-head")).toHaveLength(3);
    expect(view.container.querySelector(".fids-footer-copy")?.textContent).toContain("Seite 2");
  });
});
