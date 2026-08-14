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

  it("positions its tooltip from the cursor instead of snapping to flow buckets", () => {
    render(
      <AdminEventFlowChart
        averageWaitMinutes={18}
        error={null}
        flow={flow}
        loading={false}
        timeZone="UTC"
      />,
    );
    const viewport = screen.getByRole("img", { name: /Ticketverlauf/ });
    Object.defineProperties(viewport, {
      clientWidth: { configurable: true, value: 800 },
      getBoundingClientRect: {
        configurable: true,
        value: () => ({ height: 210, left: 100, top: 50, right: 900, width: 800 }),
      },
    });

    fireEvent.pointerMove(viewport, { buttons: 0, clientX: 315.5, clientY: 150 });
    expect(screen.getByText("11:00 Uhr")).not.toBeNull();
    expect(screen.getByText("Verkauft: 0")).not.toBeNull();
    expect(document.querySelector<HTMLElement>(".admin-flow-tooltip-position")?.style.left).toBe(
      "215.5px",
    );
    expect(document.querySelector<HTMLElement>(".admin-flow-tooltip-position")?.style.top).toBe(
      "116px",
    );

    fireEvent.pointerMove(viewport, { buttons: 0, clientX: 694.5, clientY: 150 });
    expect(screen.getByText("17:00 Uhr")).not.toBeNull();
    expect(screen.getByText("Verkauft: 30")).not.toBeNull();
    expect(document.querySelector<HTMLElement>(".admin-flow-tooltip-position")?.style.left).toBe(
      "594.5px",
    );

    fireEvent.pointerMove(viewport, { buttons: 0, clientX: 694.5, clientY: 240 });
    expect(document.querySelector<HTMLElement>(".admin-flow-tooltip-position")?.style.top).toBe(
      "80px",
    );

    fireEvent.pointerLeave(viewport);
    expect(screen.queryByText("17:00 Uhr")).toBeNull();
  });

  it("prevents mouse focus on the Recharts drawing surface", () => {
    render(
      <AdminEventFlowChart
        averageWaitMinutes={18}
        error={null}
        flow={flow}
        loading={false}
        timeZone="UTC"
      />,
    );
    const viewport = screen.getByRole("img", { name: /Ticketverlauf/ });
    const mouseDown = new MouseEvent("mousedown", { bubbles: true, cancelable: true });

    viewport.dispatchEvent(mouseDown);

    expect(mouseDown.defaultPrevented).toBe(true);
  });
});
