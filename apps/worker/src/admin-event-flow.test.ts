import { describe, expect, it } from "vitest";
import { buildAdminEventFlow } from "./admin-event-flow";
import workerSource from "./index.ts?raw";

describe("admin event flow", () => {
  it("counts valid ticket sales and completions cumulatively", () => {
    const flow = buildAdminEventFlow({
      eventId: "event-1",
      eventDate: "2026-07-24",
      timeZone: "Europe/Berlin",
      saleOpensAt: "2026-07-24T08:00:00.000Z",
      operationsEndAt: "2026-07-24T10:00:00.000Z",
      observedAt: "2026-07-24T09:00:00.000Z",
      requestedBucketMinutes: 15,
      tickets: [
        { soldAt: "2026-07-24T08:05:00.000Z", completedAt: "2026-07-24T08:40:00.000Z" },
        { soldAt: "2026-07-24T08:20:00.000Z", completedAt: null },
      ],
    });

    expect(flow.points).toHaveLength(5);
    expect(flow.points.at(-1)).toMatchObject({
      soldTickets: 2,
      completedTickets: 1,
      openTickets: 1,
    });
  });

  it("uses the event timezone for a summer and winter event date", () => {
    const summer = buildAdminEventFlow({
      eventId: "summer",
      eventDate: "2026-07-24",
      timeZone: "Europe/Berlin",
      saleOpensAt: null,
      operationsEndAt: null,
      observedAt: "2026-07-24T00:00:00.000Z",
      tickets: [],
    });
    const winter = buildAdminEventFlow({
      eventId: "winter",
      eventDate: "2026-12-24",
      timeZone: "Europe/Berlin",
      saleOpensAt: null,
      operationsEndAt: null,
      observedAt: "2026-12-24T00:00:00.000Z",
      tickets: [],
    });

    expect(summer.from).toBe("2026-07-23T22:00:00.000Z");
    expect(winter.from).toBe("2026-12-23T23:00:00.000Z");
  });

  it("anchors local midnight correctly on both DST transition days", () => {
    const spring = buildAdminEventFlow({
      eventId: "spring-dst",
      eventDate: "2026-03-29",
      timeZone: "Europe/Berlin",
      saleOpensAt: null,
      operationsEndAt: null,
      observedAt: "2026-03-29T03:00:00.000Z",
      tickets: [],
    });
    const autumn = buildAdminEventFlow({
      eventId: "autumn-dst",
      eventDate: "2026-10-25",
      timeZone: "Europe/Berlin",
      saleOpensAt: null,
      operationsEndAt: null,
      observedAt: "2026-10-25T03:00:00.000Z",
      tickets: [],
    });

    expect(spring.from).toBe("2026-03-28T23:00:00.000Z");
    expect(autumn.from).toBe("2026-10-24T22:00:00.000Z");
    expect(spring.points.at(-1)).toMatchObject({
      soldTickets: 0,
      completedTickets: 0,
      openTickets: 0,
    });
  });

  it("adapts the bucket size and never emits more than 96 points", () => {
    const flow = buildAdminEventFlow({
      eventId: "long-event",
      eventDate: "2026-07-24",
      timeZone: "Europe/Berlin",
      saleOpensAt: "2026-07-20T00:00:00.000Z",
      operationsEndAt: "2026-07-24T00:00:00.000Z",
      observedAt: "2026-07-24T00:00:00.000Z",
      requestedBucketMinutes: 15,
      tickets: [],
    });

    expect(flow.bucketMinutes).toBeGreaterThan(15);
    expect(flow.points.length).toBeLessThanOrEqual(96);
  });

  it("reads only valid tickets and completion of the current assignment", () => {
    const route = workerSource.slice(
      workerSource.indexOf('app.get("/api/admin/events/:eventId/flow"'),
      workerSource.indexOf('app.get("/api/admin/events/:eventId/master-data-template"'),
    );
    expect(route).toContain("t.status <> 'CANCELED'");
    expect(route).toContain("rt.released_at IS NULL");
    expect(route).toContain("r.status = 'COMPLETED'");
    expect(route).not.toContain("operational_events");
  });
});
