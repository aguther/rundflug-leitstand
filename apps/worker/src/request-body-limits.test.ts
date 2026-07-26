import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { limitApiBody, requireValidJsonBody } from "./request-body-boundaries";

function testApp(): Hono {
  const app = new Hono();
  app.use("/api/*", limitApiBody);
  app.use("/api/*", requireValidJsonBody);
  app.post("/api/check", (context) => context.json({ ok: true }));
  return app;
}

describe("API request body boundaries", () => {
  it("rejects a declared oversized API body with 413 before route processing", async () => {
    const response = await testApp().request(
      new Request("http://localhost/api/check", {
        method: "POST",
        headers: {
          "content-length": "1250001",
          "content-type": "application/json",
        },
        body: "{}",
      }),
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "PAYLOAD_TOO_LARGE" },
    });
  });

  it("rejects malformed JSON with 400 without logging or entering a route", async () => {
    const response = await testApp().request(
      new Request("http://localhost/api/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '{"accountId":',
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INVALID_JSON" },
    });
  });
});
