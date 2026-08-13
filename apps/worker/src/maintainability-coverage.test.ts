import { commandEnvelopeSchema } from "@rundflug/contracts/operations-dispatch";
import { describe, expect, it } from "vitest";
import ciWorkflow from "../../../.github/workflows/ci.yml?raw";
import cloudflarePerformanceWorkflow from "../../../.github/workflows/cloudflare-performance.yml?raw";
import deployCloudflareWorkflow from "../../../.github/workflows/deploy-cloudflare.yml?raw";
import nodeVersion from "../../../.nvmrc?raw";
import interfaceDocumentation from "../../../docs/architecture/command-and-realtime-interface.md?raw";
import rootManifestRaw from "../../../package.json?raw";
import packageLockRaw from "../../../package-lock.json?raw";
import contractsManifestRaw from "../../../packages/contracts/package.json?raw";
import domainManifestRaw from "../../../packages/domain/package.json?raw";
import capacitySource from "../../../packages/domain/src/capacity.ts?raw";
import forecastSource from "../../../packages/domain/src/forecast.ts?raw";
import domainIndexSource from "../../../packages/domain/src/index.ts?raw";
import outageRecoverySource from "../../../packages/domain/src/outage-recovery.ts?raw";
import queueSource from "../../../packages/domain/src/queue.ts?raw";
import sonarProperties from "../../../sonar-project.properties?raw";
import webManifestRaw from "../../web/package.json?raw";
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
type PackageLock = {
  packages?: Record<
    string,
    {
      dependencies?: Record<string, string>;
      version?: string;
    }
  >;
};
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
    const packageLock = JSON.parse(packageLockRaw) as PackageLock;
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
      mermaid: "11.16.1",
      typescript: "7.0.2",
      wrangler: "4.122.0",
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
      "workerd@1.20260714.1": true,
      "workerd@1.20260801.1": true,
      "workerd@1.20260811.1": true,
      sharp: false,
    });
    expect(packageLock.packages?.["node_modules/wrangler"]).toMatchObject({
      version: "4.122.0",
      dependencies: {
        miniflare: "5.20260811.0-alpha",
        workerd: "1.20260811.1",
      },
    });
    expect(
      packageLock.packages?.["node_modules/@cloudflare/vitest-pool-workers/node_modules/wrangler"],
    ).toMatchObject({ version: "4.120.0" });
    const defaultNodeVersion = nodeVersion.trim();
    expect(defaultNodeVersion).toBe("24.18.0");
    expect(rootManifest.scripts?.["check:ci"]).toBe(
      "npm run lint && npm run refactor:guardrails && npm run typecheck && npm run test:ci && npm run build:web && npm run build:worker && npm run requirements:verify",
    );
    expect(rootManifest.scripts?.["test:ci"]).toBe(
      "vitest run apps/worker/src/maintainability-coverage.test.ts packages/contracts/src/index.test.ts packages/domain/src/index.test.ts apps/web/src/api.test.ts",
    );
    expect(ciWorkflow).toContain("npm run check:ci");
    for (const workflow of [ciWorkflow, deployCloudflareWorkflow, cloudflarePerformanceWorkflow]) {
      expect(workflow).toContain("actions/checkout@v7");
      expect(workflow).toContain("actions/setup-node@v7");
      expect(workflow).toContain("node-version-file: .nvmrc");
      expect(workflow).not.toMatch(/\n\s+node-version: /);
      expect(workflow).toContain('npm install --global --prefix "$RUNNER_TEMP/npm" npm@12.0.2');
      expect(workflow).toContain('echo "$RUNNER_TEMP/npm/bin" >> "$GITHUB_PATH"');
    }
    expect(ciWorkflow).toContain("actions/setup-python@v7");
    expect(ciWorkflow).not.toContain("actions/setup-python@v5");
    expect(ciWorkflow).toContain("python -m pip install --disable-pip-version-check pypdf==6.10.0");
    const workerRuntimeJob = ciWorkflow.slice(
      ciWorkflow.indexOf("  worker-runtime:"),
      ciWorkflow.indexOf("  v1-core:"),
    );
    expect(workerRuntimeJob.indexOf("npm run build:web")).toBeLessThan(
      workerRuntimeJob.indexOf("npm run test:worker-runtime"),
    );
  });

  it("keeps SonarQube Cloud analysis separate from the local quality gate", () => {
    const rootManifest = JSON.parse(rootManifestRaw) as Manifest;

    expect(rootManifest.scripts).toMatchObject({
      sonar: "npm run test:coverage && sonar-scanner-npm",
      "test:coverage":
        'vitest run --coverage --exclude=apps/web/src/features/forecast-simulation/comparison.test.ts --testNamePattern="^(?!.*projects all 300 eligible groups beyond the bounded dispatch horizon).*$"',
    });
    expect(rootManifest.scripts?.build).not.toContain("sonar");
    expect(rootManifest.scripts?.check).not.toContain("sonar");
    expect(sonarProperties).toContain("sonar.projectKey=aguther_rundflug-leitstand");
    expect(sonarProperties).toContain("sonar.javascript.lcov.reportPaths=coverage/lcov.info");
    expect(ciWorkflow).toContain(`SONAR_TOKEN: \${{ secrets.SONAR_TOKEN }}`);
    expect(ciWorkflow).toContain("fetch-depth: 0");
    expect(ciWorkflow).toContain(
      "github.event.pull_request.head.repo.full_name == github.repository",
    );
    expect(ciWorkflow).toContain(
      "SonarSource/sonarqube-scan-action@7006c4492b2e0ee0f816d36501671557c97f5995",
    );
    expect(ciWorkflow).toContain("actions/upload-artifact@v7");
    expect(ciWorkflow).toContain("actions/download-artifact@v8");
    expect(ciWorkflow).toContain("npm run test:worker-runtime");
    expect(ciWorkflow).toContain("npm run test:v1-integrations");
    expect(ciWorkflow).toContain("npm run backup:restore:test");
    expect(ciWorkflow).toContain("npm run docs:verify");
    expect(ciWorkflow).not.toContain("npm run test:v1-acceptance-day");
    expect(ciWorkflow).not.toContain("npm run test:soak-reliability");
    expect(ciWorkflow).not.toContain("npm run test:cloudflare-scale-performance");
    expect(ciWorkflow).toContain("needs: check");
    expect(ciWorkflow).toContain("-Dsonar.qualitygate.wait=true");
    expect(ciWorkflow).not.toContain("-Dsonar.qualitygate.wait=false");
    expect(ciWorkflow.indexOf("name: CI Check")).toBeLessThan(
      ciWorkflow.indexOf("name: SonarQube Scan"),
    );
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
      "mermaid",
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
    const commandBase = {
      commandId: "a179125b-8409-48bb-a28f-1267f5ca5111",
      eventId: "synthetic-event",
      deviceId: "synthetic-admin",
      expectedVersion: 7,
      issuedAt: "2026-08-10T08:00:00.000Z",
    };
    const commands = [
      commandEnvelopeSchema.parse({
        ...commandBase,
        type: "CONFIGURE_EVENT_PARAMETERS",
        payload: {
          saleOpensAt: null,
          operationsStartAt: null,
          operationsEndAt: "2026-08-10T18:00:00.000Z",
          noShowAfterMinutes: 15,
          maxTicketDeferrals: 2,
          notificationLeadMinutes: 15,
          automaticPrecallEnabled: true,
          precallLeadMinutes: 15,
          maximumGateWaitMinutes: 20,
          precallMinimumQuality: "CHANGING",
          precallGateCooldownMinutes: 2,
          childReferenceWeightKg: 40,
          normalReferenceWeightKg: 80,
          heavyReferenceWeightKg: 100,
          plannedBoardingMinutes: 5,
          plannedDeboardingMinutes: 5,
          plannedBufferMinutes: 3,
          departedVisibilitySeconds: 15,
          reason: "Synthetic configuration",
          adminPin: "test-admin-pin",
        },
      }),
      commandEnvelopeSchema.parse({
        ...commandBase,
        type: "UPSERT_PRODUCT",
        payload: {
          productId: "synthetic-product",
          resourceGroupId: "synthetic-resource-group",
          gateId: "synthetic-gate",
          name: "Synthetic product",
          code: "SYN-1",
          publicDescription: "Synthetic public description",
          priceCents: 1000,
          referenceCapacity: 3,
          referenceDurationMinutes: 20,
          promisedFlightMinutes: 15,
          childCompanionRequired: false,
          weightClasses: ["NOT_CAPTURED"],
          reason: "Synthetic product configuration",
          adminPin: "test-admin-pin",
        },
      }),
      commandEnvelopeSchema.parse({
        ...commandBase,
        type: "UPSERT_RESOURCE_GROUP",
        payload: {
          resourceGroupId: "synthetic-resource-group",
          name: "Synthetic resource group",
          shortCode: "SYN",
          gateId: "synthetic-gate",
          referenceCapacity: 3,
          compatibleAircraftTypes: ["Synthetic aircraft"],
          automaticPrecallEnabled: true,
          reason: "Synthetic resource configuration",
          adminPin: "test-admin-pin",
        },
      }),
      commandEnvelopeSchema.parse({
        ...commandBase,
        type: "CONFIGURE_PRODUCT_SALES",
        payload: {
          productId: "synthetic-product",
          saleEnabled: true,
          saleClosesAt: null,
          warningThreshold: 10,
          criticalThreshold: 5,
          reason: "Synthetic sales configuration",
          adminPin: "test-admin-pin",
        },
      }),
    ];

    expect(commands.map((command) => command.type)).toEqual([
      "CONFIGURE_EVENT_PARAMETERS",
      "UPSERT_PRODUCT",
      "UPSERT_RESOURCE_GROUP",
      "CONFIGURE_PRODUCT_SALES",
    ]);
  });
});
