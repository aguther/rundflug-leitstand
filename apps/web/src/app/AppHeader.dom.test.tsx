// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
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

vi.mock("../event-navigation", () => ({
  switchActiveEvent: switchActiveEventMock,
}));

vi.mock("../features/auth/AuthContext", () => ({
  useAuth: () => ({
    session: {
      authenticated: true,
      account: { id: "admin-account", loginCode: "ADMIN-01", role: "ADMIN" },
    },
    logout: vi.fn(),
  }),
}));

vi.mock("./source-revision", () => ({
  getBuildSourceRevision: () => sourceRevisionMock.current,
}));

vi.mock("../design-system/theme", () => ({
  useTheme: () => ({
    preference: "system",
    resolved: "light",
    system: "light",
    setPreference: vi.fn(),
    cycle: vi.fn(),
  }),
}));

beforeEach(() => {
  window.localStorage.setItem("active-event-label", "Synthetischer Flugtag");
  switchActiveEventMock.mockClear();
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
  });
});
