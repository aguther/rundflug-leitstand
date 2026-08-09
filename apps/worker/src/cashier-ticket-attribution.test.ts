import { describe, expect, it } from "vitest";
import migration from "../migrations/0059_ticket_group_cashier_attribution.sql?raw";
import coordinatorSource from "./event-coordinator.ts?raw";

describe("cashier ticket attribution", () => {
  it("adds an optional account reference and a pagination-aligned search index", () => {
    expect(migration).toContain("sold_by_operator_account_id TEXT");
    expect(migration).toContain("REFERENCES operator_accounts(id) ON DELETE SET NULL");
    expect(migration).toContain(
      "operation_day_id, sold_by_operator_account_id, sold_at DESC, id DESC",
    );
    expect(migration).not.toMatch(/UPDATE\s+ticket_groups/i);
  });

  it("attributes regular sales only from the trusted coordinator request header", () => {
    const saleStart = coordinatorSource.indexOf('if (command.type === "SELL_TICKET_GROUP")');
    const saleEnd = coordinatorSource.indexOf('if (command.type === "CANCEL_TICKET_GROUP")');
    const saleHandler = coordinatorSource.slice(saleStart, saleEnd);

    expect(coordinatorSource).toContain(
      'const operatorAccountId = request.headers.get("x-operator-account-id")',
    );
    expect(saleHandler).toContain("sold_by_operator_account_id");
    expect(saleHandler).toContain("operatorAccountId");
    expect(saleHandler).not.toContain("command.payload.soldByOperatorAccountId");
  });
});
