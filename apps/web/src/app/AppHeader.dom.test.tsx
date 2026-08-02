// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppHeader } from "./AppHeader";

const switchActiveEventMock = vi.hoisted(() => vi.fn());

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
