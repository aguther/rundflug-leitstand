// @vitest-environment jsdom
import type { OperationBoard } from "@rundflug/contracts";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CompletionWorkspace } from "./CompletionWorkspace";

const board = {
  event: {
    eventId: "demo-event",
    version: 3,
    name: "Synthetischer Flugtag",
    eventDate: "2026-07-31",
    aerodrome: "EDXX",
    timeZone: "Europe/Berlin",
    status: "CLOSED",
  },
} as OperationBoard;

describe("CompletionWorkspace", () => {
  it("opens on the daily summary, routes history tabs and gates corrections", () => {
    const onHistoryTabChange = vi.fn();
    render(
      <CompletionWorkspace
        board={board}
        corrections={<p>Korrekturformular</p>}
        history={<p>Historieninhalt</p>}
        onHistoryTabChange={onHistoryTabChange}
        summary={<p>Tagesinhalt</p>}
      />,
    );

    expect(screen.getByText("Tagesinhalt").closest("section")?.hasAttribute("hidden")).toBe(false);
    fireEvent.click(screen.getByRole("tab", { name: "Prognosegüte" }));
    expect(onHistoryTabChange).toHaveBeenCalledWith("FORECASTS");
    expect(screen.getByText("Historieninhalt").closest("section")?.hasAttribute("hidden")).toBe(false);

    fireEvent.click(screen.getByRole("tab", { name: "Administrative Korrekturen" }));
    expect(screen.queryByText("Korrekturformular")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Korrektur beginnen" }));
    expect(screen.getByText("Korrekturformular")).not.toBeNull();
  });
});
