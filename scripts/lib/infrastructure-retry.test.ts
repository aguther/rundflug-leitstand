import { describe, expect, it, vi } from "vitest";
import {
  isTransientInfrastructureFailure,
  withInfrastructureRetry,
} from "./infrastructure-retry.mjs";

describe("infrastructure retry", () => {
  it.each([
    "HTTP 429",
    "HTTP 503 Service Unavailable",
    "read ECONNRESET",
    "request ETIMEDOUT",
    "fetch failed",
  ])("classifies transient infrastructure failure %s", (message) => {
    expect(isTransientInfrastructureFailure(new Error(message))).toBe(true);
  });

  it.each(["Tests failed", "Migration checksum mismatch", "HTTP 401", "TypeScript error"])(
    "does not classify deterministic failure %s",
    (message) => {
      expect(isTransientInfrastructureFailure(new Error(message))).toBe(false);
    },
  );

  it("retries only transient failures with bounded exponential delays", async () => {
    const action = vi
      .fn()
      .mockRejectedValueOnce(new Error("HTTP 503"))
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValue("ok");
    const sleep = vi.fn(async () => undefined);

    await expect(withInfrastructureRetry(action, { baseDelayMs: 10, sleep })).resolves.toBe("ok");
    expect(action).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenNthCalledWith(1, 10);
    expect(sleep).toHaveBeenNthCalledWith(2, 20);
  });

  it("fails immediately for deterministic errors", async () => {
    const action = vi.fn(async () => {
      throw new Error("Tests failed");
    });
    const sleep = vi.fn();

    await expect(withInfrastructureRetry(action, { sleep })).rejects.toThrow("Tests failed");
    expect(action).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});
