// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type FlightLineQueueGroup, TicketGroupRecallButton } from "./flight-line-shared";

const inactiveGroup = {
  id: "ticket-group-1",
  communicationNumber: 112,
  productCode: "RN",
  status: "QUEUED",
  recallCount: 1,
  activeRecall: null,
} as FlightLineQueueGroup;

const activeGroup = {
  ...inactiveGroup,
  recallCount: 2,
  activeRecall: {
    id: "019bf87a-97b0-7000-8000-000000000001",
    sequence: 2,
    startedAt: "2026-07-31T14:30:00.000Z",
    expiresAt: "2026-07-31T14:35:00.000Z",
    fidsMessage: "Bitte kommen Sie zur Flight Line.",
    publicMessage: "Bitte kommen Sie zur Flight Line.",
  },
} as FlightLineQueueGroup;

describe("ticket group recall button", () => {
  afterEach(() => cleanup());

  it("starts an eligible inactive recall directly without a confirmation preview", () => {
    const onStart = vi.fn();
    const { container } = render(
      <TicketGroupRecallButton
        group={inactiveGroup}
        onClear={vi.fn()}
        onStart={onStart}
        timeZone="Europe/Berlin"
      />,
    );

    const button = screen.getByRole("button", { name: "G-RN-0112 nachrufen" });
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(container.textContent).not.toContain("FIDS");
    expect(container.textContent).not.toContain("Statusseite");
    expect(container.textContent).not.toContain("Push");
    fireEvent.click(button);
    expect(onStart).toHaveBeenCalledWith("ticket-group-1");
  });

  it("shows the confirmed active state and clears the exact current recall", () => {
    const onClear = vi.fn();
    render(
      <TicketGroupRecallButton
        group={activeGroup}
        onClear={onClear}
        onStart={vi.fn()}
        timeZone="Europe/Berlin"
      />,
    );

    const button = screen.getByRole("button", {
      name: "G-RN-0112 · Nachruf aktiv seit 16:30 · Nachruf 2 · erneut klicken zum Beenden",
    });
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(button.getAttribute("title")).toContain("Nachruf aktiv seit 16:30");
    expect(button.innerHTML).toContain("lucide-bell-off");
    fireEvent.click(button);
    expect(onClear).toHaveBeenCalledWith("ticket-group-1", "019bf87a-97b0-7000-8000-000000000001");
  });

  it("keeps one action slot while the confirmed state changes", () => {
    const { container, rerender } = render(
      <TicketGroupRecallButton
        group={inactiveGroup}
        onClear={vi.fn()}
        onStart={vi.fn()}
        timeZone="Europe/Berlin"
      />,
    );
    expect(container.querySelectorAll(".ticket-group-recall-action")).toHaveLength(1);

    rerender(
      <TicketGroupRecallButton
        group={activeGroup}
        onClear={vi.fn()}
        onStart={vi.fn()}
        timeZone="Europe/Berlin"
      />,
    );
    expect(container.querySelectorAll(".ticket-group-recall-action")).toHaveLength(1);
  });

  it("does not expose a start action for an ineligible inactive group", () => {
    const { container } = render(
      <TicketGroupRecallButton
        group={{ ...inactiveGroup, status: "PRESENT" }}
        onClear={vi.fn()}
        onStart={vi.fn()}
        timeZone="Europe/Berlin"
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("prevents duplicate commands while the recall action is busy", () => {
    let resolveStart: () => void = () => {};
    const onStart = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveStart = resolve;
        }),
    );
    render(
      <TicketGroupRecallButton
        group={inactiveGroup}
        onClear={vi.fn()}
        onStart={onStart}
        timeZone="Europe/Berlin"
      />,
    );
    const button = screen.getByRole("button", { name: "G-RN-0112 nachrufen" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(onStart).toHaveBeenCalledTimes(1);
    expect((button as HTMLButtonElement).disabled).toBe(true);
    resolveStart();
  });
});
