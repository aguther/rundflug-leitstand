// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

const auth = vi.hoisted(() => ({
  loading: false,
  session: null as null | { account: { id: string; role: "ADMIN" } },
}));

vi.mock("./app/PageNotifications", () => ({
  ActionNotificationProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("./features/auth/AuthContext", () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useAuth: () => auth,
}));
vi.mock("./features/auth/EventScopedApplication", () => ({
  EventScopedApplication: () => <p>Authentifizierte Anwendung</p>,
}));
vi.mock("./features/auth/LoginPage", () => ({ LoginPage: () => <p>Anmeldeseite</p> }));
vi.mock("./FeatureRouter", () => ({ FeatureRouter: () => <p>Öffentliche Route</p> }));
vi.mock("./features/forecast-simulation/ForecastSimulationView", () => ({
  default: () => <p>Eigenständige Simulation</p>,
}));

describe("application access routing", () => {
  beforeEach(() => {
    auth.loading = false;
    auth.session = null;
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
  });

  it("allows setup, privacy, group, and ticket routes without a session", async () => {
    for (const path of [
      "/setup",
      "/privacy",
      "/datenschutz",
      "/gruppe/ABCD23456789",
      "/ticket/ZYXW98765432",
    ]) {
      window.history.replaceState({}, "", path);
      render(<App />);
      expect(await screen.findByText("Öffentliche Route")).toBeTruthy();
      cleanup();
    }
  });

  it("shows authentication progress before protected workspaces", () => {
    window.history.replaceState({}, "", "/admin");
    auth.loading = true;
    render(<App />);
    expect(screen.getByRole("status").textContent).toContain("Anmeldung wird geprüft");
  });

  it("shows login without a session and enters the event scope with a session", () => {
    window.history.replaceState({}, "", "/admin");
    const { rerender } = render(<App />);
    expect(screen.getByText("Anmeldeseite")).toBeTruthy();

    auth.session = { account: { id: "00000000-0000-4000-8000-000000000001", role: "ADMIN" } };
    rerender(<App />);
    expect(screen.getByText("Authentifizierte Anwendung")).toBeTruthy();
  });

  it("keeps malformed public-looking paths behind authentication", () => {
    for (const path of ["/ticket/invalid-0000", "/gruppe/short"]) {
      window.history.replaceState({}, "", path);
      render(<App />);
      expect(screen.getByText("Anmeldeseite")).toBeTruthy();
      cleanup();
    }
  });

  it("opens the standalone simulation only in simulator mode", async () => {
    vi.stubEnv("MODE", "simulator");
    window.history.replaceState({}, "", "/simulation");
    render(<App />);
    expect(await screen.findByText("Eigenständige Simulation")).toBeTruthy();
  });
});
