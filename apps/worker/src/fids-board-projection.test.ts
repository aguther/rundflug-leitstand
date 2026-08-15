import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyDemoSeed, createD1TestDatabase } from "../test-support/migrated-database";
import {
  countFidsProjectionRows,
  loadAllFidsProjectionRows,
  loadFidsProjectionRows,
} from "./fids-board-projection";

const now = "2026-08-15T10:00:00.000Z";
const projectionInput = {
  eventId: "demo-2026",
  filter: { productIds: [] as string[], gateIds: [] as string[], rotationStatuses: [] as string[] },
  departedVisibilityCutoff: "2026-08-15T09:30:00.000Z",
  now,
  band: "ALL" as const,
};

describe("protected FIDS board projection", () => {
  let testDatabase: ReturnType<typeof createD1TestDatabase>;

  beforeEach(() => {
    testDatabase = createD1TestDatabase();
    applyDemoSeed(testDatabase.database);
    testDatabase.database.exec(`
      INSERT INTO flight_groups
        (id, operation_day_id, resource_group_id, product_id, communication_number, status,
         queue_position, precalled_at, precall_decision_status, created_at, updated_at)
      VALUES
        ('group-called', 'demo-2026', 'rg-panorama', 'panorama-20', 101, 'CALLED', 1,
         NULL, NULL, '${now}', '${now}'),
        ('group-precalled', 'demo-2026', 'rg-panorama', 'panorama-20', 102, 'DRAFT', 2,
         '2026-08-15T09:55:00.000Z', 'GO_TO_GATE', '${now}', '${now}'),
        ('group-prepare', 'demo-2026', 'rg-panorama', 'panorama-30', 103, 'DRAFT', 3,
         NULL, 'PREPARE', '${now}', '${now}'),
        ('group-waiting', 'demo-2026', 'rg-panorama', 'panorama-30', 104, 'DRAFT', 4,
         NULL, 'WAITING', '${now}', '${now}'),
        ('group-departed', 'demo-2026', 'rg-panorama', 'panorama-20', 105, 'COMPLETED', 5,
         NULL, NULL, '${now}', '${now}');

      INSERT INTO rotations
        (id, operation_day_id, flight_group_id, status, departed_at, dispatch_order,
         created_at, updated_at)
      VALUES
        ('rotation-called', 'demo-2026', 'group-called', 'CALLED', NULL, NULL, '${now}', '${now}'),
        ('rotation-precalled', 'demo-2026', 'group-precalled', 'DRAFT', NULL, 1, '${now}', '${now}'),
        ('rotation-prepare', 'demo-2026', 'group-prepare', 'DRAFT', NULL, 2, '${now}', '${now}'),
        ('rotation-waiting', 'demo-2026', 'group-waiting', 'DRAFT', NULL, 3, '${now}', '${now}'),
        ('rotation-departed', 'demo-2026', 'group-departed', 'COMPLETED',
         '2026-08-15T09:45:00.000Z', NULL, '${now}', '${now}');
    `);
  });

  afterEach(() => testDatabase.close());

  it("filters before counting and returns the public rows in operational priority order", async () => {
    await expect(countFidsProjectionRows(testDatabase.d1, projectionInput)).resolves.toBe(5);
    await expect(
      loadAllFidsProjectionRows(testDatabase.d1, projectionInput).then((rows) =>
        rows.map(({ rotation_id }) => rotation_id),
      ),
    ).resolves.toEqual([
      "rotation-called",
      "rotation-precalled",
      "rotation-prepare",
      "rotation-waiting",
      "rotation-departed",
    ]);

    await expect(
      loadAllFidsProjectionRows(testDatabase.d1, {
        ...projectionInput,
        filter: { ...projectionInput.filter, productIds: ["panorama-30"] },
      }).then((rows) => rows.map(({ product_id }) => product_id)),
    ).resolves.toEqual(["panorama-30", "panorama-30"]);
  });

  it("separates actionable, preparation, lower-priority and recent-departure bands", async () => {
    const rotationsForBand = async (
      band: "ACTIONABLE" | "PREPARE" | "LOWER" | "RECENT_DEPARTURE",
    ) =>
      loadAllFidsProjectionRows(testDatabase.d1, { ...projectionInput, band }).then((rows) =>
        rows.map(({ rotation_id }) => rotation_id),
      );

    await expect(rotationsForBand("ACTIONABLE")).resolves.toEqual([
      "rotation-called",
      "rotation-precalled",
    ]);
    await expect(rotationsForBand("PREPARE")).resolves.toEqual(["rotation-prepare"]);
    await expect(rotationsForBand("LOWER")).resolves.toEqual([
      "rotation-prepare",
      "rotation-waiting",
    ]);
    await expect(rotationsForBand("RECENT_DEPARTURE")).resolves.toEqual(["rotation-departed"]);
  });

  it("applies exclusions and pagination to the already filtered projection", async () => {
    await expect(
      loadFidsProjectionRows(testDatabase.d1, {
        ...projectionInput,
        excludedRowIds: ["rotation-called:group-called"],
        limit: 2,
        offset: 1,
      }).then((rows) => rows.map(({ rotation_id }) => rotation_id)),
    ).resolves.toEqual(["rotation-prepare", "rotation-waiting"]);
  });

  it("hides departures older than the configured visibility cutoff", async () => {
    testDatabase.database
      .prepare("UPDATE rotations SET departed_at = ?1 WHERE id = 'rotation-departed'")
      .run("2026-08-15T09:00:00.000Z");

    await expect(
      countFidsProjectionRows(testDatabase.d1, {
        ...projectionInput,
        band: "RECENT_DEPARTURE",
      }),
    ).resolves.toBe(0);
  });
});
