import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import appSource from "./App.tsx?raw";

const stylesSource = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

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
    expect(appSource).toContain("Administrationszugang erneuern");
    expect(appSource).toContain("Mit PIN anmelden");
    expect(appSource).toContain("Erneut laden");
    expect(appSource).toContain("vorhandene Betriebsdaten bleiben unverändert");
    expect(appSource).toContain('className="secondary-actions admin-recovery-actions"');
    expect(appSource).toContain("attemptedDeviceCredentialRecoveries.has(deviceId)");
    expect(appSource).toContain("requestAdminDeviceRecovery()");
    expect(appSource).toContain("recoverAdminDevice(");
    expect(appSource).toContain(
      'rememberDeviceCredential(window.localStorage, "ADMIN", result.adminDeviceId, token)',
    );
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
    expect(stylesSource).toContain(".product-weight-section .checkbox-label > span");
    expect(stylesSource).toContain("pointer-events: none");
  });

  it("keeps admin action feedback visible above dialogs and makes text part of the hit target", () => {
    expect(appSource).toContain("factoryResetError");
    expect(appSource).toContain('className="action-message admin-action-message"');
    expect(stylesSource).toContain(".admin-workspace button > span");
    expect(stylesSource).toContain(".admin-action-message");
    expect(stylesSource).toContain("z-index: 90");
    expect(stylesSource).toContain("top: 76px");
    expect(appSource).toContain('aria-label="Hinweis schließen"');
    expect(appSource).toContain("6_000");
  });

  it("distinguishes missing Web Push setup from zero active subscriptions", () => {
    expect(appSource).toContain("getPushConfiguration(controller.signal)");
    expect(appSource).toContain("Web-Push ist noch nicht eingerichtet.");
    expect(appSource).toContain("npm run cloudflare:configure-push");
  });

  it("keeps every master-data category operable from create through delete or removal", () => {
    for (const label of [
      "Gate anlegen",
      "Gate speichern",
      "Gate löschen",
      "Ressourcengruppe anlegen",
      "Ressourcengruppe speichern",
      "Ressourcengruppe löschen",
      "Flugzeug anlegen",
      "Flugzeug speichern",
      "Flugzeug löschen",
      "Zuordnung ändern",
      "Zuordnung entfernen",
      "Pilotencode anlegen",
      "Änderungen speichern",
      "Pilotencode löschen",
      "Produkt anlegen",
      "Produkt speichern",
      "Produkt löschen",
    ]) {
      expect(appSource).toContain(label);
    }
    expect(appSource).toContain("Endgültig löschen");
  });

  it("uses the approved compact list-and-editor administration as the default workspace", () => {
    expect(appSource).toContain('useState<AdminArea>("master-data")');
    expect(appSource).toContain('useState<MasterDataCategory>("resource-groups")');
    expect(appSource).toContain("const [masterEditorOpen, setMasterEditorOpen] = useState(false);");
    expect(appSource).toContain('masterEditorOpen ? "editor-open" : "editor-closed"');
    expect(appSource).toContain("setMasterEditorOpen(false)");
    expect(appSource).toContain("master-data-active ${masterEditorOpen");
    expect(appSource).toContain("Zusammenfassung (abgeleitet)");
    expect(stylesSource).toContain(".admin-workspace.master-data-active > .master-data-workspace");
    expect(stylesSource).toContain(".admin-workspace.master-data-active > .master-data-drawer");
    expect(stylesSource).toContain(".admin-workspace.master-data-active.editor-open");
    expect(stylesSource).toContain("grid-template-columns: minmax(0, 1fr)");
    expect(stylesSource).toContain("max-height: none");
  });

  it("keeps the manual board refresh touchable and exposes its loading state", () => {
    expect(appSource).toContain("aria-busy={refreshing}");
    expect(appSource).toContain("Betriebsstand wird geladen …");
    expect(stylesSource).toMatch(
      /\.admin-mode-bar > button \{[\s\S]*pointer-events: auto;[\s\S]*touch-action: manipulation;/,
    );
  });

  it("finishes a factory reset even when no service worker is registered", () => {
    expect(appSource).toContain("await navigator.serviceWorker?.getRegistration()");
    expect(appSource).toContain('window.location.replace("/setup")');
    expect(appSource).toContain('className="confirmation-dialog factory-reset-dialog"');
    expect(appSource).toContain("void performFactoryReset()");
    expect(appSource).toContain('type="submit"');
    expect(appSource).toContain("Alles löschen und neu starten");
  });
});
