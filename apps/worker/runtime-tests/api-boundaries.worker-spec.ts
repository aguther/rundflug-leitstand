/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const worker = exports.default as {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
};

describe("Worker runtime API boundaries", () => {
  it("serves health metadata from the real Workers runtime", async () => {
    const response = await worker.fetch("https://worker.test/api/health");

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      applicationVersion: "1.12.0",
      requirementsVersion: "1.12.0",
    });
  }, 10_000);

  it("reports the same release through the deployment metadata endpoint", async () => {
    const response = await worker.fetch("https://worker.test/api/meta");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      applicationVersion: "1.12.0",
      requirementsVersion: "1.12.0",
      dataJurisdiction: "eu",
    });
  });

  it("rejects malformed JSON before route handling", async () => {
    const response = await worker.fetch("https://worker.test/api/not-a-route", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{invalid",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INVALID_JSON" },
    });
  });

  it("rejects oversized API requests with 413", async () => {
    const response = await worker.fetch("https://worker.test/api/not-a-route", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "x".repeat(1_250_000) }),
    });

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "PAYLOAD_TOO_LARGE" },
    });
  });
});
