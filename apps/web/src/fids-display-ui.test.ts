import { describe, expect, it } from "vitest";
import appSource from "./App.tsx?raw";
import displaySource from "./fids-display.tsx?raw";

describe("Standard- und Terminal-FIDS (F-MON-010/060, F-BEN-090)", () => {
  it("offers two directly addressable profiles backed by the same public board", () => {
    expect(appSource).toContain('path === "/fids/terminal"');
    expect(appSource).toContain("<FidsDisplay board={board}");
    expect(displaySource).toContain('data-display-mode="standard"');
    expect(displaySource).toContain('data-display-mode="terminal"');
  });

  it("uses only the approved English descriptive status terms in terminal mode", () => {
    for (const term of ["DEPARTURES", "WAITING", "GO TO GATE", "BOARDING", "DELAYED", "DEPARTED"]) {
      expect(displaySource).toContain(term);
    }
    expect(displaySource).toContain("PLEASE KEEP YOUR QR TICKET READY");
    expect(displaySource).toContain("TIME WINDOWS ARE ESTIMATES");
  });

  it("hides departed rows after a configurable one-to-fifteen-minute grace period", () => {
    expect(displaySource).toContain("DEFAULT_DEPARTED_VISIBILITY_MINUTES = 5");
    expect(displaySource).toContain("Math.min(15, Math.max(1, requestedVisibility))");
    expect(displaySource).toContain("group.departedAt");
  });

  it("shows no personal or ticket-secret data", () => {
    expect(displaySource).not.toMatch(/guestName|phoneNumber|publicCode|ticketLabels/i);
  });
});
