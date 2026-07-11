import { describe, expect, it } from "vitest";
import { serializePortableBackup } from "./backup";

describe("portable backup format", () => {
  it("contains an explicit version and no implicit guest-name field", () => {
    const serialized = serializePortableBackup({
      format: "rundflug-leitstand-portable-backup",
      formatVersion: 1,
      createdAt: "2026-07-11T02:15:00.000Z",
      requirementsVersion: "1.4",
      tables: { tickets: [{ id: "synthetic-ticket", status: "QUEUED" }] },
    });
    expect(JSON.parse(serialized)).toMatchObject({ formatVersion: 1, requirementsVersion: "1.4" });
    expect(serialized).not.toContain("guestName");
    expect(serialized).not.toContain("phone");
    expect(serialized).not.toContain("pilotName");
  });
});
