// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "../../design-system/theme";
import { AccessPageFrame } from "./AccessPageFrame";

afterEach(cleanup);

beforeEach(() => {
  window.matchMedia = vi.fn().mockReturnValue({
    addEventListener: vi.fn(),
    matches: false,
    removeEventListener: vi.fn(),
  });
});

describe("AccessPageFrame", () => {
  it("provides the shared brand, theme, heading, and width variant structure", () => {
    const { container } = render(
      <ThemeProvider>
        <AccessPageFrame
          description="Synthetische Beschreibung"
          eyebrow="Synthetischer Kontext"
          title="Synthetischer Zugang"
          titleId="synthetic-access-title"
          variant="reading"
        >
          <p>Synthetischer Inhalt</p>
        </AccessPageFrame>
      </ThemeProvider>,
    );

    expect(screen.getByRole("link", { name: "Rundflug Leitstand" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /darstellung aktiv/i })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Synthetischer Zugang" }).id).toBe(
      "synthetic-access-title",
    );
    expect(container.querySelector(".access-page--reading .access-page-panel")).toBeTruthy();
    expect(screen.getByText("Synthetische Beschreibung")).toBeTruthy();
    expect(screen.getByText("Synthetischer Inhalt")).toBeTruthy();
  });
});
