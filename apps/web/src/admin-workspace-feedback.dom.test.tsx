// @vitest-environment jsdom

import type { EventSnapshot } from "@rundflug/contracts";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { EventContextSummary } from "./features/admin/event-workspace/EventContextSummary";
import { FieldHelp } from "./operation-workspace";

afterEach(() => cleanup());

describe("admin workspace feedback interactions", () => {
  it("keeps the event label above a centered title and status row", () => {
    const { container } = render(
      <EventContextSummary
        event={
          {
            name: "Rundflug 2026",
            status: "ACTIVE",
            eventDate: "2026-07-30",
            aerodrome: "EDMG",
            timeZone: "Europe/Berlin",
          } as EventSnapshot
        }
      />,
    );

    const title = screen.getByRole("heading", { name: "Rundflug 2026" });
    expect(screen.getByText("Veranstaltung").nextElementSibling).toBe(title.parentElement);
    expect(title.parentElement?.classList.contains("event-workspace-title-row")).toBe(true);
    expect(title.parentElement?.contains(screen.getByText("Aktiv"))).toBe(true);
    expect(container.querySelectorAll(".event-workspace-context-actions")).toHaveLength(1);
    expect(container.querySelector(".event-workspace-context-actions")?.childElementCount).toBe(0);
  });

  it("skips informative help while keeping form controls and actions keyboard reachable", async () => {
    const user = userEvent.setup();
    render(
      <>
        <input aria-label="Bezeichnung" />
        <FieldHelp help="Synthetische Hilfe" />
        <button type="button">Speichern</button>
      </>,
    );
    const button = screen.getByRole("button", { name: "Hilfe: Synthetische Hilfe" });

    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Bezeichnung" }));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Speichern" }));
    expect(button.tabIndex).toBe(-1);

    await user.click(button);
    expect(screen.getByRole("tooltip").parentElement).toBe(document.body);
    expect(button.getAttribute("aria-describedby")).toBe(screen.getByRole("tooltip").id);
  });
});
