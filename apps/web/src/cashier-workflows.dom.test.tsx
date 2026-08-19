// @vitest-environment jsdom

import type { OperationBoard, TicketSearchResult } from "@rundflug/contracts";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActionNotificationProvider } from "./app/PageNotifications";
import { CashierView } from "./cashier-view";
import { ThemeProvider } from "./design-system/theme";

const api = vi.hoisted(() => ({
  getTicketGroupPrintData: vi.fn(),
  searchTickets: vi.fn(),
  sendCommand: vi.fn(),
}));

const auth = vi.hoisted(() => ({
  loadLoginAccounts: vi.fn(),
}));

const workspace = vi.hoisted(() => ({
  state: {
    backendConfirmed: true,
    board: null as OperationBoard | null,
    confirmEvent: vi.fn(),
    error: null as string | null,
    lastConfirmedAt: "2026-08-11T09:00:00.000Z" as string | null,
    refresh: vi.fn(),
  },
}));

vi.mock("qrcode", () => ({
  default: { toDataURL: vi.fn().mockResolvedValue("data:image/png;base64,c3ludGhldGlj") },
}));

vi.mock("./api", async (importOriginal) => {
  const original = await importOriginal<typeof import("./api")>();
  return {
    ...original,
    getTicketGroupPrintData: api.getTicketGroupPrintData,
    searchTickets: api.searchTickets,
    sendCommand: api.sendCommand,
  };
});

vi.mock("./features/auth/api", () => ({
  loadLoginAccounts: auth.loadLoginAccounts,
}));

vi.mock("./features/auth/AuthContext", () => ({
  useAuth: () => ({
    loading: false,
    logout: vi.fn(),
    refresh: vi.fn(),
    session: {
      account: {
        id: "00000000-0000-4000-8000-000000000001",
        loginCode: "KASSE-01",
        role: "CASHIER",
      },
    },
    setSession: vi.fn(),
    unavailable: false,
  }),
}));

vi.mock("./operation-workspace", () => ({
  CASHIER_DEVICE_ID: "synthetic-cashier-device",
  ConnectionNotice: ({ error }: { error: string | null }) =>
    error ? <p>Möglicherweise veraltet · {error}</p> : null,
  EmergencyNotice: ({ active }: { active: boolean }) =>
    active ? <p>Notfallmodus aktiv · keine Verkäufe oder neuen Aufrufe</p> : null,
  EVENT_ID: "synthetic-event",
  InterruptionNotice: () => null,
  OperationalNotice: () => null,
  deviceTokenFor: () => "synthetic-device-token",
  useOperationIdentity: () => ({
    eventId: "synthetic-event",
    deviceId: "synthetic-cashier-device",
    deviceToken: "synthetic-device-token",
  }),
  useOperationBoard: () => workspace.state,
}));
vi.mock("./features/operations/operation-identity", () => ({
  useOperationIdentity: () => ({
    eventId: "synthetic-event",
    deviceId: "synthetic-cashier-device",
    deviceToken: "synthetic-device-token",
  }),
}));
vi.mock("./features/operations/use-operation-board", () => ({
  useOperationBoard: () => workspace.state,
}));
vi.mock("./features/operations/operation-notices", () => ({
  ConnectionNotice: ({ error }: { error: string | null }) =>
    error ? <p>Möglicherweise veraltet · {error}</p> : null,
  EmergencyNotice: ({ active }: { active: boolean }) =>
    active ? <p>Notfallmodus aktiv · keine Verkäufe oder neuen Aufrufe</p> : null,
  InterruptionNotice: () => null,
  OperationalNotice: () => null,
}));

const activeTicket: TicketSearchResult = {
  bookingGroupLabel: "BG-0007",
  bookingGroupNumber: 7,
  communicationLabel: "G-PN-0042",
  communicationLabels: ["G-PN-0042"],
  communicationNumber: 42,
  communicationNumbers: [42],
  groupSize: 2,
  groupStatus: "QUEUED",
  productCode: "PN",
  productId: "product-a",
  productName: "Panoramaflug",
  queueSequence: 7,
  rotationStatus: null,
  rotationStatuses: [],
  soldAt: "2026-08-11T08:30:00.000Z",
  soldByOperatorAccountId: "00000000-0000-4000-8000-000000000001",
  soldByOperatorLoginCode: "KASSE-01",
  standby: false,
  ticketGroupId: "ticket-group-7",
};

function operationBoard(
  overrides: {
    emergencyMode?: boolean;
    eventStatus?: OperationBoard["event"]["status"];
    includeSecondProduct?: boolean;
    operationalInterrupted?: boolean;
    remainingSellableSeats?: number;
    saleEnabled?: boolean;
  } = {},
): OperationBoard {
  return {
    event: {
      emergencyMode: overrides.emergencyMode ?? false,
      operationalInterrupted: overrides.operationalInterrupted ?? false,
      operationalNote: null,
      saleOpensAt: null,
      status: overrides.eventStatus ?? "ACTIVE",
      timeZone: "Europe/Berlin",
      version: 41,
    },
    products: [
      {
        code: "PN",
        id: "product-a",
        name: "Panoramaflug",
        nextBoardingWindowLowerAt: "2026-08-11T10:00:00.000Z",
        nextBoardingWindowUpperAt: "2026-08-11T10:20:00.000Z",
        predictionQuality: "STABLE",
        priceCents: 2500,
        projectedSeats: 4,
        promisedFlightMinutes: 20,
        publicDescription: "Rundflug über die Region",
        referenceCapacity: 4,
        remainingSellableSeats: overrides.remainingSellableSeats ?? 4,
        resourceGroupStatus: "ACTIVE",
        saleEnabled: overrides.saleEnabled ?? true,
      },
      ...(overrides.includeSecondProduct
        ? [
            {
              code: "KS",
              id: "product-b",
              name: "Kurzstrecke",
              nextBoardingWindowLowerAt: "2026-08-11T10:10:00.000Z",
              nextBoardingWindowUpperAt: "2026-08-11T10:30:00.000Z",
              predictionQuality: "CHANGING" as const,
              priceCents: 1800,
              projectedSeats: 3,
              promisedFlightMinutes: 12,
              publicDescription: "Kurzer synthetischer Rundflug",
              referenceCapacity: 3,
              remainingSellableSeats: 3,
              resourceGroupStatus: "ACTIVE" as const,
              saleEnabled: true,
            },
          ]
        : []),
    ],
    rotations: [],
  } as unknown as OperationBoard;
}

function setOnline(online: boolean) {
  Object.defineProperty(window.navigator, "onLine", { configurable: true, value: online });
}

function renderCashier() {
  return render(
    <ThemeProvider>
      <ActionNotificationProvider>
        <CashierView />
      </ActionNotificationProvider>
    </ThemeProvider>,
  );
}

describe("cashier workflows", () => {
  beforeEach(() => {
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.setAttribute("open", "");
    };
    HTMLDialogElement.prototype.close = function close() {
      this.removeAttribute("open");
    };
    window.history.replaceState({}, "", "/kasse");
    window.localStorage.clear();
    window.matchMedia = vi.fn().mockReturnValue({
      addEventListener: vi.fn(),
      matches: false,
      removeEventListener: vi.fn(),
    });
    setOnline(true);
    api.getTicketGroupPrintData.mockReset();
    api.searchTickets.mockReset().mockResolvedValue({ nextCursor: null, results: [] });
    api.sendCommand.mockReset();
    auth.loadLoginAccounts.mockReset().mockResolvedValue([]);
    window.print = vi.fn();
    workspace.state.backendConfirmed = true;
    workspace.state.board = operationBoard();
    workspace.state.confirmEvent.mockReset();
    workspace.state.error = null;
    workspace.state.lastConfirmedAt = "2026-08-11T09:00:00.000Z";
    workspace.state.refresh.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllTimers();
  });

  it("confirms one sale and suppresses a duplicate click while persistence is pending", async () => {
    const user = userEvent.setup();
    let finishSale: (result: unknown) => void = () => undefined;
    api.sendCommand.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishSale = resolve;
        }),
    );
    renderCashier();

    const saleAction = await screen.findByRole("button", {
      name: /1 Ticket für Panoramaflug verkaufen/,
    });
    await user.dblClick(saleAction);
    expect(api.sendCommand).toHaveBeenCalledOnce();
    expect((saleAction as HTMLButtonElement).disabled).toBe(true);

    finishSale({
      aggregate: { id: "ticket-group-7" },
      event: { version: 42 },
      saleReceipt: {
        communicationLabel: "G-PN-0042",
        eventName: "Synthetischer Flugtag",
        gateLabel: "Tor A",
        groupSize: 1,
        productName: "Panoramaflug",
        ticketGroupId: "ticket-group-7",
      },
    });

    expect(await screen.findByText("1 Ticket verkauft.")).toBeTruthy();
    expect(api.sendCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedVersion: 41,
        payload: expect.objectContaining({ productId: "product-a", ticketCount: 1 }),
        type: "SELL_TICKET_GROUP",
      }),
      "synthetic-device-token",
    );
  });

  it("blocks a product whose confirmed server projection has disabled sales", async () => {
    workspace.state.board = operationBoard({ saleEnabled: false });
    renderCashier();

    const saleAction = await screen.findByRole("button", {
      name: /1 Ticket für Panoramaflug verkaufen/,
    });
    expect((saleAction as HTMLButtonElement).disabled).toBe(true);
    expect(api.sendCommand).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "a closed event",
      overrides: { eventStatus: "CLOSED" as const },
      reason: "Betrieb geschlossen",
    },
    {
      label: "an event in preparation",
      overrides: { eventStatus: "PREPARATION" as const },
      reason: "Betrieb nicht freigegeben",
    },
    {
      label: "emergency mode",
      overrides: { emergencyMode: true },
      reason: "Not-Halt aktiv",
    },
    {
      label: "an operational interruption",
      overrides: { operationalInterrupted: true },
      reason: "Betrieb unterbrochen",
    },
  ])("blocks sales during $label and explains the reason", async ({ overrides, reason }) => {
    workspace.state.board = operationBoard(overrides);
    renderCashier();

    const saleAction = await screen.findByRole("button", {
      name: /1 Ticket für Panoramaflug verkaufen/,
    });
    expect((saleAction as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(reason)).toBeTruthy();
    expect(screen.getByText("Verkauf nicht möglich")).toBeTruthy();
    expect(api.sendCommand).not.toHaveBeenCalled();
  });

  it("keeps forecast capacity advisory and weight capture out of the sale decision", async () => {
    workspace.state.board = operationBoard({ remainingSellableSeats: 0, saleEnabled: true });
    renderCashier();

    const saleAction = await screen.findByRole("button", {
      name: /1 Ticket für Panoramaflug verkaufen/,
    });
    expect((saleAction as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText("0/4")).toBeTruthy();
    expect(screen.queryByText(/Gewichtsklasse/)).toBeNull();
  });

  it("cancels the selected booking group with an explicit reason", async () => {
    const user = userEvent.setup();
    api.searchTickets.mockResolvedValue({ nextCursor: null, results: [activeTicket] });
    api.sendCommand.mockResolvedValue({ event: { version: 42 } });
    renderCashier();

    expect(await screen.findByText("BG-0007")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Stornieren" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Tickets stornieren" });
    await user.type(within(dialog).getByRole("textbox", { name: "Grund" }), "Fehlverkauf");
    await user.click(within(dialog).getByRole("button", { name: "Stornieren" }));

    expect(api.sendCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: {
          adminPin: "SESSION",
          reason: "Fehlverkauf",
          ticketGroupId: "ticket-group-7",
        },
        type: "CANCEL_TICKET_GROUP",
      }),
      "synthetic-device-token",
    );
    expect(await screen.findByText("Verkauf storniert und Kapazität freigegeben.")).toBeTruthy();
  });

  it("restores an offline draft for review without replaying it as a command", async () => {
    setOnline(false);
    workspace.state.backendConfirmed = false;
    workspace.state.error = "Server nicht erreichbar";
    workspace.state.lastConfirmedAt = null;
    window.localStorage.setItem(
      "cashier-draft-queue:v2:synthetic-event:synthetic-cashier-device",
      JSON.stringify([
        {
          createdAt: "2026-08-11T08:45:00.000Z",
          draft: { productId: "product-a", size: 3 },
          id: "draft-1",
          source: "OFFLINE_USER_EDIT",
        },
      ]),
    );
    renderCashier();

    expect(
      await screen.findByText(/Entwurf lokal gespeichert · noch nicht bestätigt/),
    ).toBeTruthy();
    const restoredSale = screen.getByRole("button", {
      name: /3 Tickets für Panoramaflug verkaufen/,
    });
    expect((restoredSale as HTMLButtonElement).disabled).toBe(true);
    expect(api.sendCommand).not.toHaveBeenCalled();
  });

  it("searches, filters, reopens, enlarges and prints a confirmed ticket", async () => {
    const user = userEvent.setup();
    auth.loadLoginAccounts.mockResolvedValue([
      { id: activeTicket.soldByOperatorAccountId, loginCode: "KASSE-01", role: "CASHIER" },
      { id: "admin-1", loginCode: "ADMIN-01", role: "ADMIN" },
    ]);
    api.searchTickets.mockResolvedValue({ nextCursor: null, results: [activeTicket] });
    api.getTicketGroupPrintData.mockResolvedValue({
      code: "synthetic-public-code",
      communicationLabel: "G-PN-0042",
      eventName: "Synthetischer Flugtag",
      gateLabel: "Tor A",
      groupSize: 2,
      productName: "Panoramaflug",
    });
    Object.defineProperties(HTMLImageElement.prototype, {
      complete: { configurable: true, value: true },
      decode: { configurable: true, value: vi.fn().mockResolvedValue(undefined) },
      naturalWidth: { configurable: true, value: 768 },
    });
    renderCashier();

    expect(await screen.findByText("BG-0007")).toBeTruthy();
    await user.click(screen.getByText("BG-0007"));
    expect(await screen.findAllByText("G-PN-0042")).toHaveLength(2);
    expect(api.getTicketGroupPrintData).toHaveBeenCalledWith(
      "synthetic-event",
      "ticket-group-7",
      "synthetic-cashier-device",
      "synthetic-device-token",
    );

    await user.click(
      screen.getByRole("button", { name: "QR-Code der Gruppe G-PN-0042 vergrößern" }),
    );
    expect(screen.getByRole("dialog")).toBeTruthy();
    await user.keyboard("{Escape}");

    await user.click(screen.getByRole("button", { name: "Ticket drucken" }));
    expect(window.print).toHaveBeenCalledOnce();
    expect(
      await screen.findByText(
        "Druckdialog geöffnet. Der Verkauf bleibt unabhängig vom Ausdruck gültig.",
      ),
    ).toBeTruthy();

    const search = screen.getByRole("searchbox", { name: "Tickets suchen" });
    expect(search.closest(".ds-search-field")?.parentElement?.className).toContain(
      "cashier-ticket-search",
    );
    await user.type(search, "P");
    await user.keyboard("{Enter}");
    expect(await screen.findByText("Für die Suche mindestens zwei Zeichen eingeben.")).toBeTruthy();
    await user.type(search, "N");
    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(api.searchTickets).toHaveBeenLastCalledWith(
        "synthetic-event",
        "synthetic-cashier-device",
        "synthetic-device-token",
        expect.objectContaining({ q: "PN", status: "ACTIVE" }),
      ),
    );
    await user.click(screen.getByRole("checkbox", { name: "Nur meine Tickets" }));
    await waitFor(() =>
      expect(api.searchTickets).toHaveBeenLastCalledWith(
        "synthetic-event",
        "synthetic-cashier-device",
        "synthetic-device-token",
        expect.objectContaining({ soldByOperatorAccountId: activeTicket.soldByOperatorAccountId }),
      ),
    );
    await user.click(screen.getByRole("tab", { name: "Stornierte Tickets" }));
    await waitFor(() =>
      expect(api.searchTickets).toHaveBeenLastCalledWith(
        "synthetic-event",
        "synthetic-cashier-device",
        "synthetic-device-token",
        expect.objectContaining({ status: "CANCELED" }),
      ),
    );
    await user.click(screen.getByRole("button", { name: "Liste aktualisieren" }));
  });

  it("persists an explicit cashier product order with the current event version", async () => {
    const user = userEvent.setup();
    workspace.state.board = operationBoard({ includeSecondProduct: true });
    api.sendCommand.mockResolvedValue({ event: { version: 42 } });
    renderCashier();

    await user.click(screen.getByRole("button", { name: "Kassenreihenfolge bearbeiten" }));
    await user.click(screen.getByRole("button", { name: "Kurzstrecke nach oben verschieben" }));
    await user.click(screen.getByRole("button", { name: "Speichern" }));

    expect(api.sendCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedVersion: 41,
        payload: {
          expectedProductIds: ["product-a", "product-b"],
          orderedProductIds: ["product-b", "product-a"],
        },
        type: "REORDER_CASHIER_PRODUCTS",
      }),
      "synthetic-device-token",
    );
    expect(workspace.state.confirmEvent).toHaveBeenCalledWith({ version: 42 });
  });

  it("keeps a failed sale retryable and reports the server reason", async () => {
    const user = userEvent.setup();
    api.sendCommand.mockRejectedValue(new Error("Synthetischer Verkaufsfehler"));
    renderCashier();

    const saleAction = await screen.findByRole("button", {
      name: /1 Ticket für Panoramaflug verkaufen/,
    });
    await user.click(saleAction);

    expect(await screen.findByText("Synthetischer Verkaufsfehler")).toBeTruthy();
    expect((saleAction as HTMLButtonElement).disabled).toBe(false);
  });
});
