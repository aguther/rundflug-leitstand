import { describe, expect, it } from "vitest";
import interfaceDocumentation from "../../../docs/architecture/command-and-realtime-interface.md?raw";
import rootManifestRaw from "../../../package.json?raw";
import packageLockRaw from "../../../package-lock.json?raw";
import contractsManifestRaw from "../../../packages/contracts/package.json?raw";
import contractSource from "../../../packages/contracts/src/index.ts?raw";
import domainManifestRaw from "../../../packages/domain/package.json?raw";
import capacitySource from "../../../packages/domain/src/capacity.ts?raw";
import forecastSource from "../../../packages/domain/src/forecast.ts?raw";
import domainIndexSource from "../../../packages/domain/src/index.ts?raw";
import outageRecoverySource from "../../../packages/domain/src/outage-recovery.ts?raw";
import queueSource from "../../../packages/domain/src/queue.ts?raw";
import webManifestRaw from "../../web/package.json?raw";
import webSource from "../../web/src/App.tsx?raw";
import initialMigration from "../migrations/0001_initial.sql?raw";
import masterDataMigration from "../migrations/0015_product_and_gate_master_data.sql?raw";
import multiEventMigration from "../migrations/0017_multi_event_templates.sql?raw";
import workerManifestRaw from "../package.json?raw";
import seedSource from "../seed/demo.sql?raw";
import coordinatorSource from "./event-coordinator.ts?raw";

type Manifest = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};
const dependencyNames = (raw: string) => {
  const manifest = JSON.parse(raw) as Manifest;
  return [
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
  ];
};

describe("V1 maintainability and portability boundaries", () => {
  it("uses a deliberately small allowlist of common open-source runtime and build dependencies", () => {
    const allowed = new Set([
      "@cloudflare/workers-types",
      "@rundflug/config",
      "@rundflug/contracts",
      "@rundflug/domain",
      "@types/qrcode",
      "@types/react",
      "@types/react-dom",
      "@vitejs/plugin-react",
      "@biomejs/biome",
      "concurrently",
      "hono",
      "qrcode",
      "react",
      "react-dom",
      "typescript",
      "vite",
      "vite-plugin-pwa",
      "vitest",
      "workbox-window",
      "wrangler",
      "zod",
    ]);
    const dependencies = [
      ...dependencyNames(rootManifestRaw),
      ...dependencyNames(webManifestRaw),
      ...dependencyNames(workerManifestRaw),
      ...dependencyNames(domainManifestRaw),
      ...dependencyNames(contractsManifestRaw),
    ];

    expect([...new Set(dependencies)].filter((name) => !allowed.has(name))).toEqual([]);
    expect(JSON.parse(domainManifestRaw)).not.toHaveProperty("dependencies");
    expect(packageLockRaw).not.toContain("@block65/webcrypto-web-push");
    expect(packageLockRaw).not.toContain("@block65/custom-error");
  });

  it("keeps the complete domain package free of UI, HTTP, database and Cloudflare adapters", () => {
    const domainSource = [
      domainIndexSource,
      capacitySource,
      forecastSource,
      outageRecoverySource,
      queueSource,
    ].join("\n");

    expect(domainSource).not.toMatch(
      /cloudflare:|DurableObject|D1Database|R2Bucket|\bHono\b|\bReact\b|fetch\(|Request\b|Response\b/,
    );
  });

  it("models the V2-V4 extension seams without embedding them in the domain core", () => {
    expect(initialMigration).toMatch(/CREATE TABLE resource_groups[\s\S]*CREATE TABLE products/);
    expect(initialMigration).toMatch(/resource_group_id TEXT NOT NULL REFERENCES resource_groups/);
    expect(initialMigration).toMatch(/passenger_seats INTEGER NOT NULL/);
    expect(masterDataMigration).toMatch(/CREATE TABLE gates/);
    expect(multiEventMigration).toMatch(/ALTER TABLE operation_days ADD COLUMN template_source_id/);
    expect(seedSource).toContain("'panorama-20', 'demo-2026', 'rg-panorama'");
    expect(seedSource).toContain("'panorama-30', 'demo-2026', 'rg-panorama'");
    expect(interfaceDocumentation).toContain(
      "Weitere Datenquellen integrieren sich über neue Adapter",
    );
  });
});

describe("runtime configuration coverage", () => {
  it("exposes every required operational parameter through typed commands and administration", () => {
    for (const token of [
      "CONFIGURE_EVENT_PARAMETERS",
      "saleOpensAt",
      "operationsEndAt",
      "noShowAfterMinutes",
      "maxTicketDeferrals",
      "notificationLeadMinutes",
      "childReferenceWeightKg",
      "normalReferenceWeightKg",
      "heavyReferenceWeightKg",
      "plannedBoardingMinutes",
      "plannedDeboardingMinutes",
      "plannedBufferMinutes",
      "publicDescription",
      "referenceCapacity",
      "referenceDurationMinutes",
      "weightClasses",
      "childCompanionRequired",
      "plannedRotationMinutes",
      "compatibleAircraftTypes",
    ]) {
      expect(contractSource).toContain(token);
      expect(webSource).toContain(token);
    }
    expect(contractSource).toContain("CONFIGURE_PRODUCT_SALES");
    expect(contractSource).toContain("warningThreshold");
    expect(contractSource).toContain("criticalThreshold");
  });

  it("persists configuration in the serialized, audited command path", () => {
    expect(coordinatorSource).toMatch(
      /handleEventParameters[\s\S]*UPDATE operation_days SET[\s\S]*EVENT_PARAMETERS_CONFIGURED/,
    );
    expect(coordinatorSource).toMatch(
      /PRODUCT_SALES_CONFIGURED[\s\S]*capacity_warning_threshold[\s\S]*capacity_critical_threshold/,
    );
    expect(coordinatorSource).toMatch(/PRODUCT_UPSERTED[\s\S]*weight_classes_json/);
  });
});
