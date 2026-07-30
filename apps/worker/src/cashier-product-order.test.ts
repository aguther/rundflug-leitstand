import { describe, expect, it } from "vitest";
import coordinatorSource from "./event-coordinator.ts?raw";

const reorderHandler = coordinatorSource.slice(
  coordinatorSource.indexOf("private async handleCashierProductReorder"),
  coordinatorSource.indexOf("private async handleMasterDataDeletion"),
);

describe("cashier product order persistence", () => {
  it("compares the complete expected order independently of the global event version", () => {
    const versionValidation = coordinatorSource.slice(
      coordinatorSource.indexOf("private async validateCommandVersion"),
      coordinatorSource.indexOf("private async validatePlannedOperationLink"),
    );
    expect(versionValidation).toContain('command.type === "REORDER_CASHIER_PRODUCTS"');
    expect(versionValidation).toContain("observedEventVersion <= current.version");
    expect(reorderHandler).toContain("sameOrder(currentProductIds, expectedProductIds)");
    expect(reorderHandler).toContain("CASHIER_PRODUCT_ORDER_CONFLICT");
    expect(reorderHandler).toContain("orderedProductIds.length !== currentProductIds.length");
    expect(reorderHandler).toContain("!currentIds.has(productId)");
  });

  it("normalizes order, version, audit, idempotency, and outbox in one D1 batch", () => {
    expect(reorderHandler).toContain("SET sort_order = ?1");
    expect(reorderHandler).toContain("(index + 1) * 10");
    expect(reorderHandler).toContain("'CASHIER_PRODUCT_ORDER_CHANGED'");
    expect(reorderHandler).toContain("affectsOperationalPriority: false");
    expect(reorderHandler).toContain("INSERT INTO idempotency_receipts");
    expect(reorderHandler).toContain("INSERT INTO outbox");
    expect(reorderHandler).toContain("await this.env.DB.batch(statements)");
    expect(reorderHandler.indexOf("await this.env.DB.batch(statements)")).toBeLessThan(
      reorderHandler.indexOf("this.broadcast(result)"),
    );
  });

  it("preserves an existing product order and appends a new product", () => {
    const masterDataHandler = coordinatorSource.slice(
      coordinatorSource.indexOf("private async handleMasterData("),
      coordinatorSource.indexOf("private async handleCashierProductReorder"),
    );
    const productBranch = masterDataHandler.slice(
      masterDataHandler.indexOf("const [resourceGroup, gate, duplicateCode"),
      masterDataHandler.indexOf("const result: CommandResult"),
    );
    expect(productBranch).toContain("MAX(sort_order)");
    expect(productBranch).toContain("existing?.sort_order ?? nextOrder?.next_sort_order");
    expect(productBranch).not.toContain("sort_order = excluded.sort_order");
  });
});
