import { describe, expect, it } from "vitest";
import {
  dispatchLeaseRemainingSeconds,
  formatDispatchLeaseCountdown,
} from "./dispatch-recommendation-lease";
import dialogSource from "./flight-line-shared.tsx?raw";
import viewSource from "./flight-line-view.tsx?raw";

describe("dispatch recommendation lease UI", () => {
  it("uses the server clock for a stable mm:ss countdown", () => {
    expect(
      dispatchLeaseRemainingSeconds(
        "2026-08-03T19:01:30.000Z",
        2_000,
        Date.parse("2026-08-03T18:59:58.000Z"),
      ),
    ).toBe(90);
    expect(formatDispatchLeaseCountdown(90)).toBe("01:30");
    expect(formatDispatchLeaseCountdown(15)).toBe("00:15");
    expect(formatDispatchLeaseCountdown(0)).toBe("00:00");
  });

  it("releases on close or manual selection and requires renewed human confirmation", () => {
    expect(dialogSource).toContain("dispatchLease.switchToManual()");
    expect(dialogSource).toContain("Vorschlag neu reservieren");
    expect(dialogSource).toContain("Manuelle Belegung – nicht reserviert");
    expect(dialogSource).toContain('dispatchLease.mode === "EXPIRED"');
    expect(viewSource).toContain("dispatchRecommendationLeaseId");
    expect(viewSource).toContain("await refresh(reason.currentVersion ?? 0, true)");
    expect(viewSource).toContain("Bitte den neuen Vorschlag erneut bestätigen.");
  });
});
