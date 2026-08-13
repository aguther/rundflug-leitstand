// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppHeader } from "./AppHeader";

const switchActiveEventMock = vi.hoisted(() => vi.fn());
const clipboardWriteMock = vi.hoisted(() => vi.fn());
const sourceRevisionMock = vi.hoisted(() => ({
  current: {
    full: "0123456789abcdef0123456789abcdef01234567",
    known: true,
    short: "0123456",
  },
}));
const authMock = vi.hoisted(() => ({
  logout: vi.fn(),
  session: {
    authenticated: true,
    account: { id: "admin-account", loginCode: "ADMIN-01", role: "ADMIN" },
  } as null | {
    authenticated: boolean;
    account: {
      id: string;
      loginCode: string;
      role: "ADMIN" | "CASHIER";
    };
  },
}));
const themeMock = vi.hoisted(() => ({
  cycle: vi.fn(),
  preference: "system" as "dark" | "light" | "system",
  resolved: "light" as "dark" | "light",
  setPreference: vi.fn(),
  system: "light" as "dark" | "light",
}));

vi.mock("../event-navigation", () => ({
  switchActiveEvent: switchActiveEventMock,
}));

vi.mock("../features/auth/AuthContext", () => ({
  useAuth: () => ({
    session: authMock.session,
    logout: authMock.logout,
  }),
}));

vi.mock("./source-revision", () => ({
  getBuildSourceRevision: () => sourceRevisionMock.current,
}));

vi.mock("../design-system/theme", () => ({
  useTheme: () => themeMock,
}));

beforeEach(() => {
  window.localStorage.setItem("active-event-label", "Synthetischer Flugtag");
  switchActiveEventMock.mockClear();
  authMock.logout.mockReset();
  authMock.session = {
    authenticated: true,
    account: { id: "admin-account", loginCode: "ADMIN-01", role: "ADMIN" },
  };
  themeMock.cycle.mockReset();
  themeMock.preference = "system";
  themeMock.resolved = "light";
  themeMock.setPreference.mockReset();
  themeMock.system = "light";
  clipboardWriteMock.mockReset();
  clipboardWriteMock.mockResolvedValue(undefined);
  sourceRevisionMock.current = {
    full: "0123456789abcdef0123456789abcdef01234567",
    known: true,
    short: "0123456",
  };
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: { writeText: clipboardWriteMock },
  });
});

describe("header presentation and navigation", () => {
  it("shows connection state and applies account theme choices", async () => {
    window.history.replaceState(null, "", "/admin");
    authMock.session = {
      authenticated: true,
      account: { id: "cashier-account", loginCode: "CASH-01", role: "CASHIER" },
    };
    const user = userEvent.setup();
    render(<AppHeader connectionStatus="degraded" title="Administration" />);

    expect(screen.getByRole("status", { name: "Verbindung gestört" })).toBeTruthy();
    await user.click(screen.getByText("CASH-01", { selector: ".app-account span" }));
    await user.click(screen.getByRole("radio", { name: "Dunkel" }));
    expect(themeMock.setPreference).toHaveBeenCalledWith("dark");
    expect(screen.getByRole("link", { name: /Kasse/ })).toBeTruthy();
    expect(screen.getAllByText("Andere Rolle erforderlich").length).toBeGreaterThan(0);
  });

  it("keeps public and kiosk headers free of authenticated controls", () => {
    window.history.replaceState(null, "", "/ticket/ABCDE2345678");
    const { rerender } = render(
      <AppHeader
        connectionStatus="offline"
        publicEvent={{ eventId: "demo-event", eventName: "Öffentlicher Flugtag" }}
        publicView
        title="Ticketstatus"
      />,
    );

    expect(screen.getByText("Öffentlicher Flugtag")).toBeTruthy();
    expect(screen.queryByRole("status", { name: "Offline" })).toBeNull();
    expect(screen.queryByText("ADMIN-01")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Helle Darstellung aktiv. Zu Dunkel wechseln" }),
    ).toBeTruthy();

    window.history.replaceState(null, "", "/fids");
    rerender(<AppHeader kiosk title="Fluginformation" />);
    expect(screen.queryByTitle("Veranstaltung wechseln")).toBeNull();
    expect(screen.queryByText("ADMIN-01")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Systemdarstellung aktiv. Zu Hell wechseln" }),
    ).toBeTruthy();
  });

  it("closes open menus for escape and outside pointer input", async () => {
    window.history.replaceState(null, "", "/admin");
    const user = userEvent.setup();
    render(<AppHeader title="Administration" />);
    const accountSummary = screen.getByText("ADMIN-01", { selector: ".app-account span" });
    await user.click(accountSummary);
    const accountMenu = accountSummary.closest("details");
    expect(accountMenu?.open).toBe(true);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(accountMenu?.open).toBe(true);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(accountMenu?.open).toBe(false);

    const viewSummary = screen.getByLabelText(/Ansicht wechseln/);
    await user.click(viewSummary);
    const viewMenu = viewSummary.closest("details");
    expect(viewMenu?.open).toBe(true);
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(viewMenu?.open).toBe(false);
  });
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("F-ADM-080 active event switching", () => {
  it("uses the centralized switch from the integrated account menu", async () => {
    window.history.replaceState(null, "", "/admin?event=e1&area=events&step=products#editor");
    const user = userEvent.setup();
    render(<AppHeader title="Administration" />);

    await user.click(screen.getByRole("button", { name: /Veranstaltung wechseln/ }));

    expect(switchActiveEventMock).toHaveBeenCalledOnce();
  });

  it("uses the same centralized switch from the FIDS event button", async () => {
    window.history.replaceState(null, "", "/fids?event=e1#display");
    const user = userEvent.setup();
    render(<AppHeader title="Fluginformation" />);

    await user.click(screen.getByTitle("Veranstaltung wechseln"));

    expect(switchActiveEventMock).toHaveBeenCalledOnce();
  });
});

describe("V161-UI-030 release metadata", () => {
  it("shows seven revision characters and copies the complete source revision", async () => {
    window.history.replaceState(null, "", "/admin");
    const user = userEvent.setup();
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: { writeText: clipboardWriteMock },
    });
    render(<AppHeader title="Administration" />);

    await user.click(screen.getByRole("button", { name: /^Über Rundflug-Leitstand/ }));

    expect(screen.getByRole("dialog", { name: "Über Rundflug-Leitstand" })).toBeTruthy();
    expect(screen.getByText("Source Revision")).toBeTruthy();
    expect(screen.getByText("0123456")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Vollständige Source Revision kopieren" }));

    expect(clipboardWriteMock).toHaveBeenCalledWith("0123456789abcdef0123456789abcdef01234567");
    expect(await screen.findByText("Kopiert")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Source Revision kopiert" })).toBeTruthy();

    await user.click(
      within(screen.getByRole("dialog", { name: "Über Rundflug-Leitstand" })).getByRole("button", {
        name: "Dialog schließen",
      }),
    );
    expect(screen.queryByRole("dialog", { name: "Über Rundflug-Leitstand" })).toBeNull();
  });

  it("reports clipboard failures without claiming success", async () => {
    clipboardWriteMock.mockRejectedValueOnce(new Error("Clipboard unavailable"));
    const user = userEvent.setup();
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: { writeText: clipboardWriteMock },
    });
    render(<AppHeader title="Administration" />);

    await user.click(screen.getByRole("button", { name: /^Über Rundflug-Leitstand/ }));
    await user.click(screen.getByRole("button", { name: "Vollständige Source Revision kopieren" }));

    expect(await screen.findByText("Kopieren nicht möglich.")).toBeTruthy();
    expect(screen.queryByText("Kopiert")).toBeNull();
  });

  it("shows an unknown revision without a copy action", async () => {
    sourceRevisionMock.current = {
      full: "unknown",
      known: false,
      short: "unbekannt",
    };
    const user = userEvent.setup();
    render(<AppHeader title="Administration" />);

    await user.click(screen.getByRole("button", { name: /^Über Rundflug-Leitstand/ }));

    expect(screen.getByText("unbekannt")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Vollständige Source Revision kopieren" }),
    ).toBeNull();

    await user.click(
      within(screen.getByRole("dialog", { name: "Über Rundflug-Leitstand" })).getByRole("button", {
        name: "Dialog schließen",
      }),
    );
    expect(screen.queryByRole("dialog", { name: "Über Rundflug-Leitstand" })).toBeNull();
  });
});
