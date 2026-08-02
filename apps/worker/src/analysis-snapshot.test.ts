import { describe, expect, it } from "vitest";
import { supportSafeOperationBoard } from "./analysis-snapshot";
import workerSource from "./index.ts?raw";

describe("support-safe analysis snapshot", () => {
  it("removes free text and credential canaries recursively", () => {
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

  it("guards the download by role, version and no-store headers", () => {
    const route = workerSource.slice(
      workerSource.indexOf('eventRoutes("/analysis/snapshot.json")'),
      workerSource.indexOf('eventRoutes("/tickets/search")'),
    );
    expect(route).toContain('"ADMIN", "FLIGHT_DIRECTOR"');
    expect(route).toContain("expectedEventVersion");
    expect(route).toContain("ANALYSIS_SNAPSHOT_STALE_VERSION");
    expect(route).toContain("ANALYSIS_SNAPSHOT_NOT_READY");
    expect(route).toContain('"cache-control": "no-store"');
    expect(route).toContain('"content-disposition"');
  });
});
