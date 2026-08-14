// @vitest-environment jsdom

import type { AdminEventFlow } from "@rundflug/contracts";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AdminEventFlowChart } from "./AdminEventFlowChart";

const flow: AdminEventFlow = {
  eventId: "synthetic-event",
  from: "2026-07-24T08:00:00.000Z",
  plannedUntil: "2026-07-24T20:00:00.000Z",
  observedUntil: "2026-07-24T12:00:00.000Z",
  bucketMinutes: 15,
  points: [
    {
      at: "2026-07-24T08:00:00.000Z",
      soldTickets: 0,
      completedTickets: 0,
      openTickets: 0,
    },
    {
      at: "2026-07-24T12:00:00.000Z",
      soldTickets: 21,
      completedTickets: 12,
      openTickets: 9,
    },
    {
      at: "2026-07-24T16:00:00.000Z",
      soldTickets: 30,
      completedTickets: 25,
      openTickets: 5,
    },
  ],
};

afterEach(cleanup);

describe("admin event flow chart", () => {
  it("zooms its Recharts time domain and restores the full range", () => {
    render(
      <AdminEventFlowChart
        averageWaitMinutes={18}
        error={null}
        flow={flow}
        loading={false}
        timeZone="Europe/Berlin"
      />,
    );
    const viewport = screen.getByRole("img", { name: /Ticketverlauf/ });
    Object.defineProperties(viewport, {
      clientWidth: { configurable: true, value: 800 },
      getBoundingClientRect: {
        configurable: true,
        value: () => ({ left: 100, right: 900, width: 800 }),
      },
    });

    fireEvent.wheel(viewport, { clientX: 500, deltaY: -1 });
    expect(screen.getByText("150 %")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Gesamten Zeitverlauf anzeigen" }));
    expect(screen.getByText("100 %")).not.toBeNull();
    expect(
      viewport.querySelector(".recharts-surface")?.getAttribute("tabindex") ?? null,
    ).toBeNull();
  });
});
