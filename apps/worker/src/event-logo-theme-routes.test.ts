import { describe, expect, it } from "vitest";
import migration from "../migrations/0044_event_logo_theme_variants.sql?raw";
import migrationNotes from "../migrations/README.md?raw";

describe("theme-specific event logo migration", () => {
  it("keeps existing logo columns as light and adds nullable dark columns", () => {
    expect(migration).toContain("logo_dark_object_key");
    expect(migration).toContain("logo_dark_media_type");
    expect(migration).not.toContain("UPDATE operation_days");
    expect(migrationNotes).toContain("0044 – Themevarianten für Veranstaltungslogos");
    expect(migrationNotes).toContain("D1-Time-Travel");
  });
});
