import { describe, expect, it } from "vitest";
import pushSource from "./web-push.ts?raw";

describe("persisted forecast freshness", () => {
  it("gates preparation push with the persisted prediction timestamp", () => {
    expect(pushSource).toContain("assessForecastFreshness");
    expect(pushSource).toContain("r.prediction_updated_at");
    expect(pushSource).toContain('freshness.quality !== "UNCERTAIN"');
  });
});
