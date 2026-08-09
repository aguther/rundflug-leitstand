import { describe, expect, it } from "vitest";
import { supportSafeOperationBoard } from "./analysis-snapshot";
import snapshotSource from "./analysis-snapshot.ts?raw";
import workerSource from "./index.ts?raw";

describe("support-safe analysis snapshot", () => {
  it("V1120-SEC-010 removes free text and credential canaries recursively", () => {
    const safe = supportSafeOperationBoard({
      event: {
        id: "event-synthetic",
        name: "free-text-canary",
        operationalNote: "note-canary",
        version: 3,
      },
      products: [
        {
          id: "product-synthetic",
          publicDescription: "description-canary",
          credentialHash: "credential-canary",
          capacityStatus: "AVAILABLE",
        },
      ],
      nested: { pushEndpoint: "https://push.invalid/canary", secretValue: "secret-canary" },
    } as never);
    const serialized = JSON.stringify(safe);

    expect(serialized).toContain("event-synthetic");
    expect(serialized).toContain("capacityStatus");
    expect(serialized).not.toContain("canary");
    expect(serialized).not.toContain("pushEndpoint");
  });

  it("V1120-DIA-010 guards the idempotent download by role, version and no-store headers", () => {
    const route = workerSource.slice(
      workerSource.indexOf('eventRoutes("/analysis/snapshot.json")'),
      workerSource.indexOf('eventRoutes("/tickets/search")'),
    );
    expect(route).toContain('app.on("POST"');
    expect(route).toContain('"ADMIN", "FLIGHT_DIRECTOR"');
    expect(route).toContain("analysisSnapshotRequestSchema.safeParse");
    expect(route).toContain("expectedEventVersion");
    expect(route).toContain("ANALYSIS_SNAPSHOT_STALE_VERSION");
    expect(route).toContain("ANALYSIS_SNAPSHOT_IDEMPOTENCY_CONFLICT");
    expect(route).toContain("captureAnalysisSnapshot");
    expect(route).not.toContain("analysis-capture");
    expect(route).toContain('"cache-control": "no-store"');
    expect(route).toContain('"content-disposition"');
  });

  it("V1120-DIA-020 binds the export to the exact manual planning run", () => {
    expect(snapshotSource).toContain("run.id = ?1");
    expect(snapshotSource).toContain("input.planningRunId");
    expect(snapshotSource).not.toContain("ORDER BY run.calculation_now DESC");
  });
});
