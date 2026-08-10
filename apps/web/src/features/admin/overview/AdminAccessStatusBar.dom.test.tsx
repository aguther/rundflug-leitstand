// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminAccessStatusBar } from "./AdminAccessStatusBar";

const baseProps = {
  adminModeUnlocked: false,
  administrator: true,
  authenticatedAdminLoginCode: null,
  boardLoadFailed: false,
  logoutBusy: false,
  onLockAdminMode: vi.fn(),
  onLogout: vi.fn(),
  onRefresh: vi.fn(),
  onRequestAdminModeUnlock: vi.fn(),
  refreshing: false,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("admin access status bar", () => {
  it("attributes changes to an authenticated administrator and logs out", () => {
    const onLogout = vi.fn();
    render(
      <AdminAccessStatusBar
        {...baseProps}
        authenticatedAdminLoginCode="ADMIN-01"
        onLogout={onLogout}
      />,
    );

    expect(screen.getByText("Administration aktiv")).toBeTruthy();
    expect(screen.getByText(/ADMIN-01 · Änderungen werden/)).toBeTruthy();
    const logoutButton = screen.getByRole("button", { name: "Abmelden" });
    expect(logoutButton.className).toContain("secondary-action");
    fireEvent.click(logoutButton);
    expect(onLogout).toHaveBeenCalledOnce();
  });

  it("keeps legacy administrator changes locked until explicitly unlocked", () => {
    const onRequestAdminModeUnlock = vi.fn();
    render(
      <AdminAccessStatusBar {...baseProps} onRequestAdminModeUnlock={onRequestAdminModeUnlock} />,
    );

    expect(screen.getByText("Administration gesperrt")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Bearbeitungsmodus entsperren" }));
    expect(onRequestAdminModeUnlock).toHaveBeenCalledOnce();
  });

  it("offers recovery actions without hiding a board loading failure", () => {
    const onRefresh = vi.fn();
    render(
      <AdminAccessStatusBar
        {...baseProps}
        administrator={false}
        boardLoadFailed
        onRefresh={onRefresh}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Erneut laden" }));
    expect(onRefresh).toHaveBeenCalledOnce();
    expect(screen.getByText(/Betriebsstand konnte nicht geladen werden/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Mit Administrationskonto anmelden" })).toBeTruthy();
  });
});
