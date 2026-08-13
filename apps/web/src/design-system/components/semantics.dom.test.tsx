// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BusyIndicator } from "./BusyIndicator";
import { PageHeader } from "./PageHeader";
import { SidePanel } from "./SidePanel";

afterEach(() => cleanup());

describe("design system native semantics", () => {
  it("announces busy actions with an output status", () => {
    render(<BusyIndicator label="Daten werden gespeichert" />);

    expect(screen.getByRole("status").textContent).toContain("Daten werden gespeichert");
  });

  it("exposes an open side panel as a labelled dialog", () => {
    render(
      <SidePanel onClose={vi.fn()} open title="Flugzeug bearbeiten">
        Formular
      </SidePanel>,
    );

    expect(screen.getByRole("dialog", { name: "Flugzeug bearbeiten" })).toBeTruthy();
  });

  it("marks only the final breadcrumb as the current page", () => {
    render(<PageHeader breadcrumb={["Administration", "Flugzeuge"]} title="Bearbeiten" />);

    expect(screen.getByText(/Administration/).hasAttribute("aria-current")).toBe(false);
    expect(screen.getByText("Flugzeuge").getAttribute("aria-current")).toBe("page");
  });
});
