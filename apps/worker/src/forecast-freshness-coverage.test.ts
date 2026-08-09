import { describe, expect, it } from "vitest";
import workerSource from "./index.ts?raw";
import pushSource from "./web-push.ts?raw";

describe("persisted forecast freshness", () => {
  it("uses prediction_updated_at for internal read models", () => {
    expect(workerSource).toContain("assessForecastFreshness");
    expect(workerSource).toContain("predictionUpdatedAt: rotation.prediction_updated_at");
    expect(workerSource).toContain("predictionQuality: effectivePredictionQuality");
    expect(workerSource).toContain("const effectivePredictionQuality =");
    expect(workerSource).toContain("eventRow.emergency_mode === 1");
  });

  it("never treats operation-day or learning-sample age as forecast freshness", () => {
    expect(workerSource).not.toContain(
      "const dataAgeMinutes = Math.max(0, (Date.now() - Date.parse(eventRow.updated_at))",
    );
    expect(workerSource).not.toMatch(/estimateDuration\(\{[\s\S]{0,500}dataAgeMinutes/);
  });

  it("gates preparation push with the persisted prediction timestamp", () => {
    expect(pushSource).toContain("assessForecastFreshness");
    expect(pushSource).toContain("r.prediction_updated_at");
    expect(pushSource).toContain('freshness.quality !== "UNCERTAIN"');
  });
});
