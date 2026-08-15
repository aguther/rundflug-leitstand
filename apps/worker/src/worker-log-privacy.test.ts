import { describe, expect, it } from "vitest";
import { safeErrorMessage } from "./snapshot";
import { pushErrorMessage } from "./web-push";

describe("Worker log privacy", () => {
  it.each([
    "PIN 123456",
    "phone +49 170 1234567",
    "token secret-synthetic-value",
    "ticket code ABCD-EFGH",
    "https://push.invalid/subscription/synthetic-secret",
  ])("does not expose sensitive error details: %s", (detail) => {
    expect(safeErrorMessage(new Error(detail))).toBe("Error");
    expect(pushErrorMessage(new Error(detail))).toBe("Error");
  });

  it("keeps a safe error class for diagnostics", () => {
    expect(safeErrorMessage(new TypeError("synthetic private detail"))).toBe("TypeError");
    expect(safeErrorMessage({ message: "synthetic private detail" })).toBe("Unknown error");
  });
});
