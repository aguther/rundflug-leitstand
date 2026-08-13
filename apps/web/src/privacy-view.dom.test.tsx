// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PrivacyView } from "./privacy-view";

vi.mock("./features/auth/AccessPageFrame", () => ({
  AccessPageFrame: ({ children, title }: { children: ReactNode; title: ReactNode }) => (
    <main>
      <h1>{title}</h1>
      {children}
    </main>
  ),
}));

afterEach(cleanup);

describe("privacy view", () => {
  it("keeps the privacy copy and destination inside the shared access surface", () => {
    render(<PrivacyView />);

    expect(screen.getByRole("heading", { name: "Privatsphäre ohne Gastkonto" })).toBeTruthy();
    expect(screen.getByText(/keine Namen und keine Telefonnummern/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Zurück zum Leitstand" }).getAttribute("href")).toBe(
      "/",
    );
  });
});
