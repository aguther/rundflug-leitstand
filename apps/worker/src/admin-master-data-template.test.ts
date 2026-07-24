import { describe, expect, it } from "vitest";
import workerSource from "./index.ts?raw";

describe("admin master-data template routes", () => {
  it("keeps export, validation and import behind admin authorization", () => {
    expect(workerSource).toMatch(
      /app\.get\("\/api\/admin\/events\/:eventId\/master-data-template"[\s\S]*device\?\.role !== "ADMIN"/,
    );
    expect(workerSource).toMatch(
      /app\.post\("\/api\/admin\/events\/:eventId\/master-data-template\/validate"[\s\S]*device\?\.role !== "ADMIN"/,
    );
    expect(workerSource).toMatch(
      /app\.post\("\/api\/admin\/events\/:eventId\/master-data-template\/import"[\s\S]*device\?\.role !== "ADMIN"/,
    );
  });

  it("guards import by phase, emptiness, version, audit, outbox and idempotency", () => {
    expect(workerSource).toContain("TEMPLATE_TARGET_NOT_EMPTY");
    expect(workerSource).toContain("MASTER_DATA_TEMPLATE_IMPORTED");
    expect(workerSource).toContain("IMPORT_MASTER_DATA_TEMPLATE");
    expect(workerSource).toMatch(
      /UPDATE operation_days[\s\S]*WHERE id = \?1 AND version = \?2 AND status = 'PREPARATION'/,
    );
    expect(workerSource).toContain("const receiptGuard = `EXISTS (");
    expect(workerSource).toMatch(
      /INSERT INTO idempotency_receipts[\s\S]*WHERE EXISTS \([\s\S]*version = \?6 AND status = 'PREPARATION'/,
    );
    expect(workerSource).toContain("receiptGuard");
    expect(workerSource).not.toMatch(
      /MASTER_DATA_TEMPLATE_IMPORTED[\s\S]{0,500}(operator_accounts|operator_sessions|tickets|rotations)/,
    );
  });
});
