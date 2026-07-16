import { describe, expect, it } from "vitest";
import workerSource from "./index.ts?raw";

describe("operational API cache policy", () => {
  it("marks every API response as no-store", () => {
    expect(workerSource).toContain('app.use("/api/*"');
    expect(workerSource).toContain('context.header("cache-control", "no-store")');
  });
});
