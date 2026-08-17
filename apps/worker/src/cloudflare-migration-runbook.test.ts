import { describe, expect, it } from "vitest";
import recovery from "../../../docs/operations/backup-restore.md?raw";
import setup from "../../../docs/operations/cloudflare-neuaufbau.md?raw";
import rootPackageSource from "../../../package.json?raw";

const rootPackage = JSON.parse(rootPackageSource) as { scripts: Record<string, string> };

describe("Cloudflare migration runbook", () => {
  it("uses the configured D1 binding for explicit status and apply commands", () => {
    expect(rootPackage.scripts["db:migrations:remote:status"]).toBe(
      "wrangler d1 migrations list DB --remote --config wrangler.jsonc",
    );
    expect(rootPackage.scripts["db:migrate:remote"]).toBe(
      "wrangler d1 migrations apply DB --remote --config wrangler.jsonc",
    );
  });

  it("documents verified automatic migrations separately from resource provisioning", () => {
    expect(setup).toMatch(/löscht\s+oder leert niemals vorhandene Ressourcen/);
    expect(setup).toContain("wendet alle Migrationen auf die leere D1 an");
    expect(setup).toContain(
      "Bei offener Migration verlangt der automatische Pfad vor jeder Änderung einen belegten",
    );
    expect(setup).toContain("ohne `onlineSafe`-Freigabe bricht er ab");
    expect(setup).toContain("vorhandenen Worker, D1-ID, EU-R2 und Bindings, ohne");
    expect(setup).toContain("Ressourcen anzulegen");
    expect(setup).not.toContain("apply_migrations");
    expect(rootPackage.scripts.build).not.toContain("db:migrate");
  });

  it("records recovery notes for both pending additive migrations", () => {
    expect(recovery).toContain("Migrationsnotiz 0030");
    expect(recovery).toContain("Migrationsnotiz 0031");
    expect(recovery).toContain("D1-Time-Travel-Zeitpunkt");
    expect(recovery).toContain("isolierte Datenbank");
    expect(recovery).toContain("PRE_DEPLOY");
  });
});
