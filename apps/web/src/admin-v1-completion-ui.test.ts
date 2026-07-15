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

  it("keeps one-time PIN actions usable without retaining the PIN", () => {
    expect(appSource).toContain('const adminPinRef = useRef("")');
    expect(appSource).toContain("adminPinRef.current = value");
    expect(appSource.match(/adminPin: adminPinRef\.current/g)?.length).toBeGreaterThan(10);
    expect(appSource).toContain('if (!adminModeUnlocked) setAdminPin("")');
  });

  it("makes child guidance directly selectable and explains meaningful admin fields", () => {
    expect(appSource).not.toContain('disabled={!productWeightClasses.includes("CHILD")}');
    expect(appSource).toContain("weightClassesForChildCompanion(current, true)");
    expect(appSource).toContain("Bei Kinderbuchungen auf Begleitung hinweisen");
    expect(appSource.match(/<FieldLabel/g)?.length).toBeGreaterThan(35);
  });

  it("distinguishes missing Web Push setup from zero active subscriptions", () => {
    expect(appSource).toContain("getPushConfiguration(controller.signal)");
    expect(appSource).toContain("Web-Push ist noch nicht eingerichtet.");
    expect(appSource).toContain("npm run cloudflare:configure-push");
  });
});
