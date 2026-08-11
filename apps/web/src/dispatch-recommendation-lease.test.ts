import { describe, expect, it } from "vitest";
import {
  dispatchLeaseRemainingSeconds,
  formatDispatchLeaseCountdown,
} from "./dispatch-recommendation-lease";
import dialogSource from "./flight-line-shared.tsx?raw";

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

  it("releases on close or manual selection", () => {
    expect(dialogSource).toContain("dispatchLease.switchToManual()");
    expect(dialogSource).toContain("Aktuellsten Vorschlag laden");
    expect(dialogSource).toContain("Vorschlag wird geladen …");
    expect(dialogSource).toContain("Manuelle Belegung – nicht reserviert");
    expect(dialogSource).toContain('dispatchLease.mode === "EXPIRED"');
    expect(dialogSource).toContain('dispatchLease.mode === "REFRESHING"');
    expect(dialogSource).toContain('group.dispatchReservation === "OTHER"');
    expect(dialogSource).toContain("GO TO GATE");
  });

  it("keeps the assignment dialog geometry and scroll ownership stable", () => {
    expect(dialogSource).toContain('className="flight-director-assignment-modal"');
    expect(dialogSource).toContain('className="flight-director-dispatch-slot"');
    expect(dialogSource).toContain('className="flight-director-queue-head"');
    expect(dialogSource).toContain('className="flight-director-queue-scroll"');
    expect(dialogSource).toContain('footerClassName="flight-director-assignment-modal-footer"');
    expect(dialogSource).not.toContain('className="flight-director-selection"');
    expect(dialogSource).not.toContain("flight-director-attendance-action");
    expect(dialogSource).not.toContain("flight-director-missing-action");
  });
});
