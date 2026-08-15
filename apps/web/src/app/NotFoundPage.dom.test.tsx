// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NotFoundPage } from "./NotFoundPage";

vi.mock("./AppShell", () => ({ AppShell: ({ children }: { children: ReactNode }) => children }));
vi.mock("../features/auth/AuthContext", () => ({
  useAuth: () => ({ session: null }),
}));
vi.mock("../event-navigation", () => ({ switchActiveEvent: vi.fn() }));

afterEach(() => cleanup());

describe("not-found page", () => {
  it("shows only the pathname and offers accessible safe return actions", async () => {
    window.history.replaceState({}, "", "/unbekannt?token=not-visible#secret");
    const back = vi.spyOn(window.history, "back").mockImplementation(() => undefined);
    render(<NotFoundPage />);

    expect(screen.getByRole("heading", { name: "Seite nicht gefunden" })).toBeTruthy();
    expect(document.title).toBe("Seite nicht gefunden · Rundflug-Leitstand");
    expect(screen.getByText("Pfad: /unbekannt")).toBeTruthy();
    expect(screen.queryByText(/not-visible|secret/)).toBeNull();
    expect(screen.getByRole("link", { name: "Zur Startseite" }).getAttribute("href")).toBe("/");

    await userEvent.click(screen.getByRole("button", { name: "Zurück" }));
    expect(back).toHaveBeenCalledOnce();
    back.mockRestore();
  });
});
