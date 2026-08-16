import { APP_NAME, APP_VERSION, REQUIREMENTS_VERSION } from "@rundflug/config";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "./types";

const maintenance = vi.hoisted(() => ({
  run: vi.fn(),
}));
const planningHistory = vi.hoisted(() => ({ start: vi.fn() }));

vi.mock("./scheduled-maintenance", () => ({
  runScheduledMaintenance: maintenance.run,
}));
vi.mock("./planning-history-workflow", () => ({
  PlanningHistoryCompactionWorkflow: class {},
  startPlanningHistoryWorkflows: planningHistory.start,
}));
vi.mock("cloudflare:workers", () => ({
  DurableObject: class<Environment> {
    protected readonly ctx: DurableObjectState;
    protected readonly env: Environment;

    constructor(ctx: DurableObjectState, env: Environment) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

import worker from "./index";

function environment(overrides: Partial<Env> = {}): Env {
  const coordinatorNamespace = {} as DurableObjectNamespace;
  Object.assign(coordinatorNamespace, {
    jurisdiction: vi.fn(() => coordinatorNamespace),
  });
  return {
    APP_ENV: "development",
    DATA_JURISDICTION: "eu",
    EVENT_COORDINATOR: coordinatorNamespace,
    PUBLIC_TICKET_RATE_LIMITER: { limit: vi.fn().mockResolvedValue({ success: true }) },
    SOURCE_REVISION: " source-123 ",
    ...overrides,
  } as unknown as Env;
}

async function fetchWorker(request: Request, env = environment()): Promise<Response> {
  return worker.fetch(request, env, {} as ExecutionContext);
}

describe("worker entry routing", () => {
  beforeEach(() => {
    maintenance.run.mockReset().mockResolvedValue(undefined);
    planningHistory.start.mockReset().mockResolvedValue(0);
  });

  it("serves health and metadata with security and cache boundaries", async () => {
    const health = await fetchWorker(new Request("https://worker.test/api/health"));
    const healthBody = (await health.json()) as Record<string, unknown>;

    expect(health.status).toBe(200);
    expect(healthBody).toMatchObject({
      applicationVersion: APP_VERSION,
      environment: "development",
      ok: true,
      requirementsVersion: REQUIREMENTS_VERSION,
      service: APP_NAME,
    });
    expect(health.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(health.headers.get("x-content-type-options")).toBe("nosniff");

    const metadata = await fetchWorker(new Request("https://worker.test/api/meta"));
    await expect(metadata.json()).resolves.toMatchObject({
      dataJurisdiction: "eu",
      sourceRevision: "source-123",
    });

    const unknownRevision = await fetchWorker(
      new Request("https://worker.test/api/meta"),
      environment({ SOURCE_REVISION: "   " }),
    );
    await expect(unknownRevision.json()).resolves.toMatchObject({ sourceRevision: "unknown" });
  });

  it("redirects production HTTP before any API handler runs", async () => {
    const response = await fetchWorker(
      new Request("http://worker.test/api/health?probe=1"),
      environment({ APP_ENV: "production" }),
    );

    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("https://worker.test/api/health?probe=1");
  });

  it("rejects malformed JSON and returns a stable API not-found contract", async () => {
    const malformed = await fetchWorker(
      new Request("https://worker.test/api/setup/bootstrap", {
        body: "{",
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(malformed.status).toBe(400);
    await expect(malformed.json()).resolves.toMatchObject({
      error: { code: "INVALID_JSON" },
    });

    const missing = await fetchWorker(new Request("https://worker.test/api/not-a-route"));
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toEqual({
      error: { code: "NOT_FOUND", message: "API-Route nicht gefunden." },
    });
  });

  it("conceals invalid public ticket codes and rate-limits repeated probing", async () => {
    const allowed = await fetchWorker(new Request("https://worker.test/api/public/tickets/bad"));
    expect(allowed.status).toBe(404);
    expect(allowed.headers.get("cache-control")).toBe("no-store");
    await expect(allowed.json()).resolves.toMatchObject({ error: { code: "TICKET_NOT_FOUND" } });

    const limited = await fetchWorker(
      new Request("https://worker.test/api/public/tickets/bad"),
      environment({
        PUBLIC_TICKET_RATE_LIMITER: {
          limit: vi.fn().mockResolvedValue({ success: false }),
        },
      } as Partial<Env>),
    );
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
    await expect(limited.json()).resolves.toMatchObject({
      error: { code: "TOO_MANY_TICKET_ATTEMPTS" },
    });
  });

  it("delegates scheduled execution to the maintenance boundary", async () => {
    const env = environment();

    await worker.scheduled(
      {
        cron: "15 2 * * *",
        scheduledTime: Date.parse("2026-08-16T02:15:00Z"),
      } as ScheduledController,
      env,
      {} as ExecutionContext,
    );

    expect(maintenance.run).toHaveBeenCalledWith(env);
    expect(planningHistory.start).toHaveBeenCalledWith(env, new Date("2026-08-16T02:15:00Z"));
  });

  it("starts only compaction discovery on the hourly trigger", async () => {
    const env = environment();

    await worker.scheduled(
      {
        cron: "0 * * * *",
        scheduledTime: Date.parse("2026-08-16T03:00:00Z"),
      } as ScheduledController,
      env,
      {} as ExecutionContext,
    );

    expect(maintenance.run).not.toHaveBeenCalled();
    expect(planningHistory.start).toHaveBeenCalledWith(env, new Date("2026-08-16T03:00:00Z"));
  });
});
