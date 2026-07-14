import { describe, expect, it } from "vitest";
import appSource from "./App.tsx?raw";

describe("V1 administration completion UI", () => {
  it("exposes typed gate display filters in the existing gate editor", () => {
    expect(appSource).toContain("Anzeigefilter");
    expect(appSource).toContain("gateDisplayProductIds");
    expect(appSource).toContain("gateDisplayRotationStatuses");
    expect(appSource).toContain("displayFilter:");
    expect(appSource).toContain("Leere Auswahl bedeutet: alle Produkte");
  });

  it("marks the post-departure manifest correction as an audited admin-only path", () => {
    expect(appSource).toContain("Dokumentierte Besetzung korrigieren");
    expect(appSource).toContain('type: "CORRECT_ROTATION_MANIFEST"');
    expect(appSource).toContain("Nur Administration");
    expect(appSource).toContain("keine flugbetriebliche oder");
    expect(appSource).toContain("requestAdminAction(correctRotationManifest)");
  });

  it("keeps recovery controls visible and transfers the anonymous admin credential on restart", () => {
    expect(appSource).toContain("Gerätebindung erneut prüfen");
    expect(appSource).toContain("Betriebsstand erneut laden");
    expect(appSource).toContain("Das bedeutet nicht, dass die");
    expect(appSource).toContain("attemptedDeviceCredentialRecoveries.has(deviceId)");
    expect(appSource).toContain("allowDeviceCredentialRecovery(ADMIN_DEVICE_ID)");
    expect(appSource).toContain("Reset ist sichtbar, bleibt aber gesperrt");
    expect(appSource).toContain(
      'rememberDeviceCredential(window.localStorage, "ADMIN", result.adminDeviceId, adminToken)',
    );
    expect(appSource).toContain("Bearbeitungsmodus entsperren");
  });
});
