// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SetupView } from "./setup-view";

const api = vi.hoisted(() => ({
  bootstrapSystem: vi.fn(),
  getSetupStatus: vi.fn(),
}));

const notifications = vi.hoisted(() => ({
  useActionMessageBridge: vi.fn(),
}));

vi.mock("./api", () => api);
vi.mock("./app/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
vi.mock("./app/PageNotifications", () => ({
  useActionMessageBridge: notifications.useActionMessageBridge,
}));

describe("setup view", () => {
  beforeEach(() => {
    api.bootstrapSystem.mockReset();
    api.getSetupStatus.mockReset();
    notifications.useActionMessageBridge.mockReset();
  });

  afterEach(() => cleanup());

  it("shows the administration link when setup is already complete", async () => {
    api.getSetupStatus.mockResolvedValue({
      setupRequired: false,
      setupConfigured: true,
      resetSetupAuthorized: false,
      resetSetupExpiresAt: null,
    });

    render(<SetupView />);

    expect(await screen.findByText("Die Ersteinrichtung ist bereits abgeschlossen.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Zur Administration" }).getAttribute("href")).toBe(
      "/admin",
    );
    expect(screen.queryByRole("button", { name: "System einmalig einrichten" })).toBeNull();
  });

  it("keeps bootstrap unavailable while the installation code is not configured", async () => {
    api.getSetupStatus.mockResolvedValue({
      setupRequired: true,
      setupConfigured: false,
      resetSetupAuthorized: false,
      resetSetupExpiresAt: null,
    });

    render(<SetupView />);

    expect(await screen.findByText("Der Installations-Notfallcode fehlt noch.")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "System einmalig einrichten" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("reports local validation errors before issuing a bootstrap request", async () => {
    const user = userEvent.setup();
    api.getSetupStatus.mockResolvedValue({
      setupRequired: true,
      setupConfigured: true,
      resetSetupAuthorized: false,
      resetSetupExpiresAt: null,
    });
    render(<SetupView />);
    const submit = await screen.findByRole("button", { name: "System einmalig einrichten" });

    await user.click(submit);

    expect(api.bootstrapSystem).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(notifications.useActionMessageBridge).toHaveBeenLastCalledWith(
        expect.stringContaining("Flugplatz"),
        expect.any(Function),
      ),
    );
  });

  it("omits the installation code for an authorized reset and surfaces bootstrap failures", async () => {
    const user = userEvent.setup();
    api.getSetupStatus.mockResolvedValue({
      setupRequired: true,
      setupConfigured: true,
      resetSetupAuthorized: true,
      resetSetupExpiresAt: "2026-08-13T12:30:00.000Z",
    });
    api.bootstrapSystem.mockRejectedValue(new Error("Synthetischer Bootstrap-Fehler"));
    render(<SetupView />);
    const submit = await screen.findByRole("button", { name: "System einmalig einrichten" });

    expect(screen.getByText(/nach dem Werksreset direkt fortsetzen/)).toBeTruthy();
    expect(screen.queryByLabelText("Installations-Notfallcode")).toBeNull();
    await user.type(screen.getByLabelText("Flugplatz"), " EDXX ");
    await user.type(screen.getByLabelText(/^Erste Administrator-PIN/), "12ab3456");
    await user.click(submit);

    await waitFor(() => expect(api.bootstrapSystem).toHaveBeenCalledOnce());
    expect(api.bootstrapSystem).toHaveBeenCalledWith(
      expect.objectContaining({
        adminPin: "123456",
        aerodrome: "EDXX",
        timeZone: "Europe/Berlin",
      }),
    );
    expect(api.bootstrapSystem.mock.calls[0]?.[0]).not.toHaveProperty("setupCode");
    await waitFor(() =>
      expect(notifications.useActionMessageBridge).toHaveBeenLastCalledWith(
        "Synthetischer Bootstrap-Fehler",
        expect.any(Function),
      ),
    );
    expect((submit as HTMLButtonElement).disabled).toBe(false);
  });

  it("reports an unavailable setup status without enabling bootstrap", async () => {
    api.getSetupStatus.mockRejectedValue("offline");

    render(<SetupView />);

    await waitFor(() =>
      expect(notifications.useActionMessageBridge).toHaveBeenLastCalledWith(
        "Einrichtungsstatus nicht verfügbar.",
        expect.any(Function),
      ),
    );
    expect(
      (screen.getByRole("button", { name: "System einmalig einrichten" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});
