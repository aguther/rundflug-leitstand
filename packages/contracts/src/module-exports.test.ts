import * as contracts from "@rundflug/contracts";
import { eventSnapshotSchema } from "@rundflug/contracts/event-auth";
import { factoryResetRequestSchema } from "@rundflug/contracts/factory-reset";
import { simulationPlanExportSchema } from "@rundflug/contracts/forecast-analysis";
import { masterDataTemplateSchema } from "@rundflug/contracts/master-data";
import { commandEnvelopeSchema } from "@rundflug/contracts/operations-dispatch";
import { auditEntrySchema } from "@rundflug/contracts/reports-recovery";
import { timeZoneSchema } from "@rundflug/contracts/shared";
import { publicTicketStatusSchema } from "@rundflug/contracts/tickets-public-status";
import { describe, expect, it } from "vitest";

describe("contract module exports", () => {
  it("keeps the root barrel compatible with every public subpath", () => {
    expect(contracts.eventSnapshotSchema).toBe(eventSnapshotSchema);
    expect(contracts.factoryResetRequestSchema).toBe(factoryResetRequestSchema);
    expect(contracts.simulationPlanExportSchema).toBe(simulationPlanExportSchema);
    expect(contracts.masterDataTemplateSchema).toBe(masterDataTemplateSchema);
    expect(contracts.commandEnvelopeSchema).toBe(commandEnvelopeSchema);
    expect(contracts.auditEntrySchema).toBe(auditEntrySchema);
    expect(contracts.timeZoneSchema).toBe(timeZoneSchema);
    expect(contracts.publicTicketStatusSchema).toBe(publicTicketStatusSchema);
  });
});
