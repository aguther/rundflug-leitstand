import { describe, expect, it } from "vitest";
import migration from "../migrations/0044_event_logo_theme_variants.sql?raw";
import migrationNotes from "../migrations/README.md?raw";
import eventDeletion from "./event-deletion.ts?raw";
import worker from "./index.ts?raw";

describe("theme-specific event logo persistence and delivery", () => {
  it("keeps existing logo columns as light and adds nullable dark columns", () => {
    expect(migration).toContain("logo_dark_object_key");
    expect(migration).toContain("logo_dark_media_type");
    expect(migration).not.toContain("UPDATE operation_days");
    expect(migrationNotes).toContain("0044 – Themevarianten für Veranstaltungslogos");
    expect(migrationNotes).toContain("D1-Time-Travel");
  });

  it("selects a validated theme for admin mutations and public reads", () => {
    expect(worker.match(/parseEventLogoTheme\(context\.req\.query\("theme"\)/g)).toHaveLength(3);
    expect(worker).toContain("EVENT_LOGO_THEME_INVALID");
    expect(worker).toMatch(/return `\$\{operation\}_EVENT_LOGO_\$\{theme\.toUpperCase\(\)\}`;/);
    expect(worker).toContain('eventLogoCommandType("SET", theme)');
    expect(worker).toContain('eventLogoCommandType("REMOVE", theme)');
  });

  it("guards persistence by version and stores variant-aware audit payloads", () => {
    expect(worker).toContain("results[0]?.meta.changes !== 1");
    expect(worker).toContain("JSON.stringify({ theme, mediaType })");
    expect(worker).toContain("JSON.stringify({ theme })");
    expect(worker).toContain("findEventLogoReceipt(context.env, commandId)");
    expect(worker).toContain("IDEMPOTENCY_CONFLICT");
  });

  it("falls back to the opposite variant and cleans both objects on event deletion", () => {
    expect(worker).toContain(
      'const fallbackTheme: EventLogoTheme = requestedTheme === "light" ? "dark" : "light"',
    );
    expect(worker).toContain("for (const resolvedTheme of [requestedTheme, fallbackTheme])");
    expect(worker).toContain('"x-event-logo-theme": resolvedTheme');
    expect(worker).toContain("[event.logo_object_key, event.logo_dark_object_key]");
    expect(worker).toContain("finishEventDeletionAssetCleanup(");
    expect(eventDeletion).toContain("env.BACKUPS.delete([...logoObjectKeys])");
  });
});
