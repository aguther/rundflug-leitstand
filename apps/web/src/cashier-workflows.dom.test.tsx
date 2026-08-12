// @vitest-environment jsdom

import type { OperationBoard, TicketSearchResult } from "@rundflug/contracts";
import { cleanup, render, screen, within } from "@testing-library/react";
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
    remainingSellableSeats?: number;
    saleEnabled?: boolean;
  } = {},
): OperationBoard {
  return {
    event: {
      emergencyMode: overrides.emergencyMode ?? false,
      operationalInterrupted: false,
      operationalNote: null,
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
});
