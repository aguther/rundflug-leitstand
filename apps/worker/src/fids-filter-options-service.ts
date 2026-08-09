import type { FidsFilterOptions } from "@rundflug/contracts";
import { runD1ReadsSequentially } from "./d1-read-scheduler";

const defaultDependencies = { runD1ReadsSequentially };

type FidsFilterOptionsDependencies = typeof defaultDependencies;

export async function loadFidsFilterOptions(
  database: D1Database,
  eventId: string,
  dependencies: FidsFilterOptionsDependencies = defaultDependencies,
): Promise<FidsFilterOptions> {
  const [gates, products] = await dependencies.runD1ReadsSequentially([
    () =>
      database
        .prepare(
          `SELECT id, label, active
             FROM gates
            WHERE operation_day_id = ?1
            ORDER BY active DESC, label COLLATE NOCASE, id`,
        )
        .bind(eventId)
        .all<{ id: string; label: string; active: number }>(),
    () =>
      database
        .prepare(
          `SELECT p.id, p.code, p.name, COALESCE(p.gate_id, rg.gate_id) AS gate_id,
                  p.sale_enabled AS active
             FROM products p
             JOIN resource_groups rg ON rg.id = p.resource_group_id
            WHERE p.operation_day_id = ?1
            ORDER BY p.sale_enabled DESC, p.sort_order, p.code COLLATE NOCASE, p.id`,
        )
        .bind(eventId)
        .all<{ id: string; code: string; name: string; gate_id: string; active: number }>(),
  ] as const);
  return {
    gates: gates.results.map((gate) => ({
      id: gate.id,
      label: gate.label,
      active: gate.active === 1,
    })),
    products: products.results.map((product) => ({
      id: product.id,
      code: product.code,
      name: product.name,
      gateId: product.gate_id,
      active: product.active === 1,
    })),
  };
}
