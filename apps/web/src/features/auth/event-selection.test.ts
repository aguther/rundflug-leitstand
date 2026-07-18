import { describe, expect, it } from "vitest";
import adminSource from "../../admin-view.tsx?raw";
import shellSource from "../../app/AppShell.tsx?raw";
import pairSource from "../../pair-device-view.tsx?raw";
import appSource from "./EventScopedApplication.tsx?raw";
import selectionSource from "./EventSelectionPage.tsx?raw";

describe("explicit event selection and display binding", () => {
  it("validates persisted context against the authenticated event catalog", () => {
    expect(appSource).toContain("loadSelectableEvents");
    expect(appSource).toContain("events.find((entry) => entry.eventId === requestedEventId)");
    expect(appSource).toContain("<EventSelectionPage");
    expect(selectionSource).toContain("Veranstaltung auswählen");
    expect(selectionSource).toContain("Veranstaltung öffnen");
  });

  it("keeps the current event visible and makes switching explicit", () => {
    expect(shellSource).toContain("activeEventLabel");
    expect(shellSource).toContain('title="Veranstaltung wechseln"');
    expect(shellSource).toContain("forgetActiveEvent");
  });

  it("includes the selected gate and profile in display pairing", () => {
    expect(adminSource).toContain('params.set("gate", displayGateId)');
    expect(adminSource).toContain('params.set("style", displayMode)');
    expect(pairSource).toContain("rememberDisplayBinding");
    expect(pairSource).toContain('role === "DISPLAY"');
  });
});
