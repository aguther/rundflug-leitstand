import { describe, expect, it } from "vitest";

import workerSource from "./index.ts?raw";
import projectionSource from "./master-data-export.ts?raw";

const routeStart = workerSource.indexOf('eventRoutes("/exports/simulation-plan.json")');
const routeEnd = workerSource.indexOf(
  'app.post("/api/admin/events/:eventId/master-data-template/validate"',
  routeStart,
);
const exportRouteSource = workerSource.slice(routeStart, routeEnd);

describe("simulation plan export route", () => {
  it("is read-only and restricted to operationally authorized roles", () => {
    expect(workerSource).toContain('eventRoutes("/exports/simulation-plan.json")');
    expect(workerSource).toContain('["ADMIN", "FLIGHT_DIRECTOR"].includes(device.role)');
    expect(workerSource).toMatch(/exports\/simulation-plan\.json[\s\S]*status = 'PLANNED'/);
    expect(projectionSource).not.toMatch(
      /\b(ticket_groups|tickets|rotations|event_ledger|audit|operator_accounts)\b/,
    );
    expect(`${workerSource}\n${projectionSource}`).not.toMatch(
      /exports\/simulation-plan\.json[\s\S]{0,350}\b(INSERT|UPDATE|DELETE)\b/,
    );
  });

  it("does not expose operative rotation ids for after-rotation plans", () => {
    expect(exportRouteSource).toContain("afterCurrentRotation: plan.after_rotation_id !== null");
    expect(exportRouteSource).not.toContain("afterRotationId: plan.after_rotation_id");
    expect(exportRouteSource).toContain('"cache-control": "no-store"');
  });
});
