import { describe, expect, it } from "vitest";
import { createBoundedTextRecorder, createHttpFailure } from "./bounded-diagnostics.mjs";

describe("bounded integration diagnostics", () => {
  it("retains only the configured runtime-output tail", () => {
    const recorder = createBoundedTextRecorder(8);

    recorder.append("wrangler-started\n");
    recorder.append("busy");

    expect(recorder.read()).toBe("ted\nbusy");
  });

  it("includes bounded HTTP and runtime details in failures", async () => {
    const failure = await createHttpFailure(
      "Public ticket status failed",
      new Response("database is locked and the response continues", { status: 500 }),
      "SQLITE_BUSY from Wrangler",
      18,
    );

    expect(failure.message).toContain("Public ticket status failed (500)");
    expect(failure.message).toContain("database is locked…");
    expect(failure.message).not.toContain("response continues");
    expect(failure.message).toContain("SQLITE_BUSY from Wrangler");
  });

  it("reports empty response and runtime output explicitly", async () => {
    const failure = await createHttpFailure(
      "Public group status failed",
      new Response(null, { status: 503 }),
      "",
    );

    expect(failure.message).toContain("Response body (limited to 2048 characters): <empty>");
    expect(failure.message).toContain("Wrangler output (bounded tail): <empty>");
  });
});
