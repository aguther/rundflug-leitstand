import { describe, expect, it } from "vitest";
import sonarWorkflow from "../../../.github/workflows/build.yml?raw";
import ciWorkflow from "../../../.github/workflows/ci.yml?raw";
import cloudflarePerformanceWorkflow from "../../../.github/workflows/cloudflare-performance.yml?raw";
import deployCloudflareWorkflow from "../../../.github/workflows/deploy-cloudflare.yml?raw";
import nodeVersion from "../../../.nvmrc?raw";
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
import sonarProperties from "../../../sonar-project.properties?raw";
import webManifestRaw from "../../web/package.json?raw";
import webAdminSource from "../../web/src/admin-view.tsx?raw";
import eventParametersSource from "../../web/src/features/admin/event-parameters/EventParametersWorkspace.tsx?raw";
import eventParametersFormSource from "../../web/src/features/admin/event-parameters/useEventParametersForm.ts?raw";
import initialMigration from "../migrations/0001_initial.sql?raw";
import masterDataMigration from "../migrations/0015_product_and_gate_master_data.sql?raw";
import multiEventMigration from "../migrations/0017_multi_event_templates.sql?raw";
import workerManifestRaw from "../package.json?raw";
import seedSource from "../seed/demo.sql?raw";

type Manifest = {
  allowScripts?: Record<string, boolean>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  engines?: Record<string, string>;
  packageManager?: string;
  scripts?: Record<string, string>;
};
const webSource = `${webAdminSource}\n${eventParametersSource}\n${eventParametersFormSource}`;
const dependencyNames = (raw: string) => {
  const manifest = JSON.parse(raw) as Manifest;
  return [
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
  ];
};

describe("V1 maintainability and portability boundaries", () => {
  it("pins the supported TypeScript 7 and npm 12 toolchain", () => {
    const rootManifest = JSON.parse(rootManifestRaw) as Manifest;
    const webManifest = JSON.parse(webManifestRaw) as Manifest;
    const workerManifest = JSON.parse(workerManifestRaw) as Manifest;

    expect(rootManifest.engines).toEqual({
      node: "^22.22.2 || ^24.15.0 || >=26.0.0",
      npm: ">=12.0.2 <13",
    });
    expect(rootManifest.packageManager).toBe("npm@12.0.2");
    expect(rootManifest.devDependencies).toMatchObject({
      "@biomejs/biome": "^2.5.6",
      "@cloudflare/vitest-pool-workers": "^0.20.3",
      "@cloudflare/workers-types": "^5.20260801.1",
      "@playwright/test": "^1.62.1",
      "@sonar/scan": "^5.0.0",
      "@vitest/coverage-v8": "^4.1.10",
      jsdom: "^30.0.1",
      typescript: "7.0.2",
      wrangler: "^4.120.0",
    });
    expect(webManifest.dependencies).toMatchObject({ "lucide-react": "^1.28.0" });
    expect(webManifest.devDependencies).toMatchObject({
      "@types/react": "19.2.18",
      "@types/react-dom": "19.2.4",
      "@vitejs/plugin-react": "^6.0.5",
      vite: "^8.2.1",
    });
    expect(workerManifest.dependencies).toMatchObject({ hono: "^4.12.34" });
    expect(rootManifest.allowScripts).toEqual({
      "esbuild@0.28.1": true,
      "workerd@1.20260801.1": true,
    });
    const defaultNodeVersion = nodeVersion.trim();
    expect(defaultNodeVersion).toBe("24.18.0");
    expect(ciWorkflow).toContain("node-version: 22.22.2");
    expect(rootManifest.scripts?.["check:ci"]).toBe(
      "npm run lint && npm run refactor:guardrails && npm run build && npm run requirements:verify",
    );
    expect(ciWorkflow).toContain("npm run check:ci");
    for (const workflow of [ciWorkflow, deployCloudflareWorkflow, cloudflarePerformanceWorkflow]) {
      expect(workflow).toContain('npm install --global --prefix "$RUNNER_TEMP/npm" npm@12.0.2');
      expect(workflow).toContain('echo "$RUNNER_TEMP/npm/bin" >> "$GITHUB_PATH"');
    }
    for (const workflow of [deployCloudflareWorkflow, cloudflarePerformanceWorkflow]) {
      expect(workflow).toContain(`node-version: ${defaultNodeVersion}`);
    }
  });

  it("keeps SonarQube Cloud analysis separate from the local quality gate", () => {
    const rootManifest = JSON.parse(rootManifestRaw) as Manifest;

    expect(rootManifest.scripts).toMatchObject({
      sonar: "npm run test:coverage && sonar-scanner-npm",
      "test:coverage":
        'vitest run --coverage --testNamePattern="^(?!.*projects all 300 eligible groups beyond the bounded dispatch horizon).*$"',
    });
    expect(rootManifest.scripts?.build).not.toContain("sonar");
    expect(rootManifest.scripts?.check).not.toContain("sonar");
    expect(sonarProperties).toContain("sonar.projectKey=aguther_rundflug-leitstand");
    expect(sonarProperties).toContain("sonar.javascript.lcov.reportPaths=coverage/lcov.info");
    expect(sonarWorkflow).toContain(`SONAR_TOKEN: \${{ secrets.SONAR_TOKEN }}`);
    expect(sonarWorkflow).toContain(
      "SonarSource/sonarqube-scan-action@7006c4492b2e0ee0f816d36501671557c97f5995",
    );
    expect(sonarWorkflow).toContain("-Dsonar.qualitygate.wait=true");
  });

  it("uses a deliberately small allowlist of common open-source runtime and build dependencies", () => {
    const allowed = new Set([
      "@cloudflare/workers-types",
      "@fontsource/barlow-condensed",
      "@rundflug/config",
      "@rundflug/contracts",
      "@rundflug/domain",
      "@types/qrcode",
      "@types/react",
      "@types/react-dom",
      "@vitejs/plugin-react",
      "@biomejs/biome",
      "@cloudflare/vitest-pool-workers",
      "@playwright/test",
      "@sonar/scan",
      "@testing-library/react",
      "@testing-library/user-event",
      "@vitest/coverage-v8",
      "concurrently",
      "fflate",
      "hono",
      "jsdom",
      "lucide-react",
      "qrcode",
      "react",
      "react-dom",
      "react-is",
      "recharts",
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
      "promisedFlightMinutes",
      "weightClasses",
      "childCompanionRequired",
      "compatibleAircraftTypes",
    ]) {
      expect(contractSource).toContain(token);
      expect(webSource).toContain(token);
    }
    expect(contractSource).toContain("CONFIGURE_PRODUCT_SALES");
    expect(contractSource).toContain("warningThreshold");
    expect(contractSource).toContain("criticalThreshold");
  });
});
