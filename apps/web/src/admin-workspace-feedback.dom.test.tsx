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
    render(
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
  });

  it("renders keyboard and click help outside dialog scroll measurements", async () => {
    const user = userEvent.setup();
    render(<FieldHelp help="Synthetische Hilfe" />);
    const button = screen.getByRole("button", { name: "Hilfe: Synthetische Hilfe" });

    await user.tab();
    expect(document.activeElement).toBe(button);
    expect(screen.getByRole("tooltip").parentElement).toBe(document.body);
    expect(button.getAttribute("aria-describedby")).toBe(screen.getByRole("tooltip").id);

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("tooltip")).toBeNull();
    await user.click(button);
    expect(screen.getByRole("tooltip").parentElement).toBe(document.body);
  });
});
