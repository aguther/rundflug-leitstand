import { describe, expect, it, vi } from "vitest";
import { waitForExpectedRevision } from "./deployment-verification.mjs";

const EXPECTED_REVISION = "a".repeat(40);
const PREVIOUS_REVISION = "b".repeat(40);

function metadataResponse(sourceRevision: string): Response {
  return Response.json({ sourceRevision });
}

describe("deployment revision verification", () => {
  it("waits for two consecutive observations of the expected revision", async () => {
    const fetchImplementation = vi
      .fn()
      .mockResolvedValueOnce(metadataResponse(PREVIOUS_REVISION))
      .mockResolvedValueOnce(metadataResponse(EXPECTED_REVISION))
      .mockResolvedValueOnce(metadataResponse(PREVIOUS_REVISION))
      .mockResolvedValueOnce(metadataResponse(EXPECTED_REVISION))
      .mockResolvedValueOnce(metadataResponse(EXPECTED_REVISION));
    const sleepImplementation = vi.fn().mockResolvedValue(undefined);

    await expect(
      waitForExpectedRevision({
        baseUrl: "https://worker.example",
        expectedRevision: EXPECTED_REVISION,
        fetchImplementation,
        maxAttempts: 5,
        delayForAttempt: () => 0,
        sleepImplementation,
      }),
    ).resolves.toEqual({ sourceRevision: EXPECTED_REVISION });

    expect(fetchImplementation).toHaveBeenCalledTimes(5);
    expect(sleepImplementation).toHaveBeenCalledTimes(4);
    for (const [index, [url, init]] of fetchImplementation.mock.calls.entries()) {
      expect(url).toBeInstanceOf(URL);
      expect((url as URL).searchParams.get("deployment-verification")).toBe(
        `${EXPECTED_REVISION}-${index + 1}`,
      );
      expect(init).toEqual({ headers: { "cache-control": "no-store" } });
    }
  });

  it("retries transient HTTP and fetch failures before succeeding", async () => {
    const fetchImplementation = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockRejectedValueOnce(new Error("connection reset"))
      .mockResolvedValueOnce(metadataResponse(EXPECTED_REVISION))
      .mockResolvedValueOnce(metadataResponse(EXPECTED_REVISION));
    const onRetry = vi.fn();

    await expect(
      waitForExpectedRevision({
        baseUrl: "https://worker.example/",
        expectedRevision: EXPECTED_REVISION,
        fetchImplementation,
        maxAttempts: 4,
        delayForAttempt: () => 0,
        sleepImplementation: vi.fn().mockResolvedValue(undefined),
        onRetry,
      }),
    ).resolves.toEqual({ sourceRevision: EXPECTED_REVISION });

    expect(onRetry).toHaveBeenCalledTimes(3);
  });

  it("fails after the bounded number of attempts", async () => {
    const fetchImplementation = vi
      .fn()
      .mockImplementation(async () => metadataResponse(PREVIOUS_REVISION));

    await expect(
      waitForExpectedRevision({
        baseUrl: "https://worker.example",
        expectedRevision: EXPECTED_REVISION,
        fetchImplementation,
        maxAttempts: 3,
        delayForAttempt: () => 0,
        sleepImplementation: vi.fn().mockResolvedValue(undefined),
      }),
    ).rejects.toThrow(
      `/api/meta did not stably report expected revision ${EXPECTED_REVISION} after 3 attempts. Last observed revision: ${PREVIOUS_REVISION}.`,
    );
  });

  it("describes non-Error request failures without default object stringification", async () => {
    await expect(
      waitForExpectedRevision({
        baseUrl: "https://worker.example",
        expectedRevision: EXPECTED_REVISION,
        fetchImplementation: vi.fn().mockRejectedValue({ code: "ECONNRESET" }),
        maxAttempts: 1,
      }),
    ).rejects.toThrow('Last request failed: {"code":"ECONNRESET"}');
  });
});
