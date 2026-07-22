import { describe, expect, it } from "vitest";
import coordinatorSource from "./event-coordinator.ts?raw";
import workerSource from "./index.ts?raw";
import pushSource from "./web-push.ts?raw";

describe("persisted forecast freshness", () => {
  it("uses prediction_updated_at for internal and public read models", () => {
    expect(workerSource).toContain("assessForecastFreshness");
    expect(workerSource).toContain("predictionUpdatedAt: rotation.prediction_updated_at");
    expect(workerSource).toContain("predictionQuality: effectivePredictionQuality");
    expect(workerSource).toContain('resourceGroupStatus !== "ACTIVE"');
    const publicTicketRoute = workerSource.slice(
      workerSource.indexOf('app.get("/api/public/tickets/:ticketCode"'),
      workerSource.indexOf('app.get("/api/public/push/config"'),
    );
    expect(publicTicketRoute).toContain("r.prediction_updated_at");
    expect(publicTicketRoute).toContain('effectivePredictionQuality !== "UNCERTAIN"');
    expect(publicTicketRoute).toContain("Prognose wird aktualisiert");
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

  it("calculates automatic precalls from the same fresh projection batch", () => {
    const recalculation = coordinatorSource.slice(
      coordinatorSource.indexOf("private async recalculateForecastTimelines"),
      coordinatorSource.indexOf("private async persistAutomaticPrecalls"),
    );
    expect(recalculation).toContain("const nowIso = now.toISOString()");
    expect(recalculation).toContain("calculateForecastTimelines");
    expect(recalculation).toContain("prediction_updated_at = ?12");
    expect(recalculation).toContain("decideAutomaticPrecall");
  });
});
