import { describe, expect, it } from "vitest";
import routerSource from "./FeatureRouter.tsx?raw";
import displaySource from "./fids-display.tsx?raw";
import fidsViewSource from "./fids-view.tsx?raw";

const appSource = `${routerSource}\n${fidsViewSource}`;

describe("Standard- und Terminal-FIDS (F-MON-010/060, F-BEN-090)", () => {
  it("offers two directly addressable profiles backed by the same public board", () => {
    expect(appSource).toContain('path === "/fids/terminal"');
    expect(appSource).toContain("<FidsDisplay board={board}");
    expect(displaySource).toContain("board?.selectedGate");
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

  it("hides departed rows after the persisted 5-to-900-second grace period", () => {
    expect(displaySource).toContain("board?.departedVisibilitySeconds");
    expect(displaySource).toContain("Math.min(900, Math.max(5, requestedVisibilitySeconds))");
    expect(displaySource).toContain('get("departedSeconds")');
    expect(displaySource).toContain("group.departedAt");
  });

  it("shows no personal or ticket-secret data", () => {
    expect(displaySource).not.toMatch(/guestName|phoneNumber|publicCode|ticketLabels/i);
  });
});
