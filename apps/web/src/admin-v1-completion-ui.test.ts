import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import adminUxSource from "./admin-ux.tsx?raw";
import adminViewSource from "./admin-view.tsx?raw";
import notificationsSource from "./app/PageNotifications.tsx?raw";
import assignmentDialogSource from "./features/admin/aircraft/AircraftResourceGroupAssignmentDialog.tsx?raw";
import completionWorkspaceSource from "./features/admin/completion/CompletionWorkspace.tsx?raw";
import eventParametersSource from "./features/admin/event-parameters/EventParametersWorkspace.tsx?raw";
import factoryResetDialogSource from "./features/admin/FactoryResetDialog.tsx?raw";
import masterDataWorkspaceSource from "./features/admin/master-data/MasterDataWorkspace.tsx?raw";
import operationsWorkspaceSource from "./features/admin/operations/OperationsWorkspace.tsx?raw";
import sharedSource from "./operation-workspace.tsx?raw";

const appSource = `${adminViewSource}\n${sharedSource}\n${factoryResetDialogSource}\n${eventParametersSource}\n${assignmentDialogSource}\n${completionWorkspaceSource}\n${masterDataWorkspaceSource}\n${operationsWorkspaceSource}`;

const stylesSource = [
  readFileSync(new URL("./styles.css", import.meta.url), "utf8"),
  readFileSync(new URL("./features/admin/admin-v15.css", import.meta.url), "utf8"),
  readFileSync(
    new URL("./features/admin/event-parameters/event-parameters.css", import.meta.url),
    "utf8",
  ),
].join("\n");

describe("V1 administration completion UI", () => {
  it("marks the post-departure manifest correction as an audited admin-only path", () => {
    expect(adminViewSource).toContain("<ManifestCorrectionPanel");
    expect(appSource).toContain('type: "CORRECT_ROTATION_MANIFEST"');
    expect(adminViewSource).toContain('runBusyAction("manifest-correction"');
  });

  it("uses account sessions instead of browser device recovery", () => {
    expect(appSource).not.toContain("attemptedDeviceCredentialRecoveries");
    expect(appSource).not.toContain("recoverAdminDevice(");
    expect(appSource).not.toContain("rememberDeviceCredential");
    expect(appSource).toContain("Reset ist sichtbar, bleibt aber gesperrt");
  });

  it("uses the authenticated administrator session for normal changes", () => {
    expect(appSource).toContain("const { session, logout } = useAuth()");
    expect(appSource).toContain('useState(session?.account.role === "ADMIN" ? "000000" : "")');
    expect(appSource).toContain('useState(session?.account.role === "ADMIN")');
    expect(appSource).toContain("<AccountManagement");
    expect(appSource).toContain("createOpen={accountCreateOpen}");
    expect(appSource).toContain("onCreateOpenChange={setAccountCreateOpen}");
  });

  it("keeps product weight controls suspended in the editor", () => {
    expect(appSource).not.toContain('label="Gewichtserfassung"');
    expect(appSource).not.toContain("Bei Kinderbuchungen auf Begleitung hinweisen");
  });

  it("keeps setup saving visible and every information hint bound to its field label", () => {
    expect(appSource).toContain('className="event-parameters-workspace"');
    expect(appSource).toContain("<PageHeader");
    expect(appSource).toContain("<Button");
    expect(appSource).toContain("Änderungen speichern");
    expect(appSource).toContain("className={`field-info");
    expect(appSource).toContain("aria-label={`Hilfe:");
    expect(appSource).toContain('role="tooltip"');
    expect(appSource).toContain('<Info aria-hidden="true" />');
    expect(appSource).toContain("onBlur={close}");
    expect(appSource).toContain('document.addEventListener("pointerdown", handlePointerDown)');
    expect(appSource).toContain("onPointerEnter");
    expect(appSource).toContain("onPointerLeave");
    expect(appSource).toContain('if (event.key !== "Escape") return;');
    expect(appSource).toContain("aria-describedby={open ? tooltipId : undefined}");
    expect(appSource).toContain("<label htmlFor={htmlFor}>{label}</label>");
    expect(appSource).toContain("export function FieldGroupLabel");
    expect(adminViewSource).not.toMatch(/<label[^>]*>\s*<Field(?:Label|GroupLabel)/);
    expect(appSource).not.toContain("onMouseDown={(event) => event.preventDefault()}");
    expect(appSource).not.toContain('<details className="field-info">');
    expect(appSource).toContain("createPortal(");
    expect(appSource).toContain("document.body");
    expect(stylesSource).toContain(".field-info-tooltip.is-open");
    expect(stylesSource).not.toContain(".field-info:focus-visible .field-info-tooltip");
    expect(stylesSource).not.toContain(".field-info:hover .field-info-tooltip");
    expect(stylesSource).toContain(".field-info > svg");
    expect(stylesSource).not.toContain("label:focus-within .field-info");
    expect(stylesSource).toContain("position: fixed");
    expect(stylesSource).toContain(".event-setup-v15 .ds-page-header");
    expect(stylesSource).toContain(".event-setup-v15 .ds-page-header-actions .ds-button");
    expect(stylesSource).toContain(".admin-workspace:not(.master-data-active)");
    expect(stylesSource).toContain("grid-auto-rows: max-content");
  });

  it("routes admin action feedback through the global auto-dismissing notification stack", () => {
    expect(appSource).toContain("useActionMessageBridge(message, setMessage)");
    expect(stylesSource).toContain(".admin-workspace button > span");
    expect(stylesSource).toContain(".page-notification-region");
    expect(stylesSource).toContain("top: 76px");
    expect(notificationsSource).toContain("export function ActionNotificationStack()");
    expect(notificationsSource).toContain('aria-label="Meldung schließen"');
    expect(notificationsSource).toContain('notice.tone === "danger" ? 10_000 : 5_000');
  });

  it("loads the Web Push configuration for the overview", () => {
    expect(appSource).toContain("getPushConfiguration(controller.signal)");
  });

  it("keeps every master-data category operable from create through delete or removal", () => {
    expect(appSource).toContain("Einzelzuordnung Flugzeug–Ressourcengruppe");
    expect(appSource).toContain("masterEditorFooter");
    expect(appSource).toContain("masterEditorMobileFurtherActions");
    expect(appSource).toContain("Speichern");
    expect(appSource).toContain("Abbrechen");
    expect(appSource).toContain("Löschen");
    expect(appSource).not.toContain(">Gate speichern<");
    expect(appSource).not.toContain(">Ressourcengruppe speichern<");
    expect(appSource).not.toContain(">Flugzeug speichern<");
    expect(appSource).not.toContain(">Produkt speichern<");
  });

  it("uses centered responsive master-data dialogs", () => {
    expect(appSource).toContain("useState<MasterDataCategory>(() => {");
    expect(appSource).toContain(': "resource-groups";');
    expect(appSource).toContain("<MasterDataWorkspace");
    expect(appSource).not.toContain('<aside className="master-data-drawer"');
    expect(stylesSource).toContain("grid-template-columns: minmax(0, 1fr)");
    expect(stylesSource).toContain("max-height: none");
  });

  it("guards dirty editors and transitions to destructive confirmation without stacked dialogs", () => {
    expect(appSource).toContain('title="Änderungen verwerfen?"');
    expect(appSource).toContain("Weiter bearbeiten");
  });

  it("separates administrative evaluation from operational flight-line work", () => {
    expect(adminUxSource).toContain('{ id: "evaluation", label: "Auswertung"');
    expect(adminUxSource).not.toContain('label: "Betrieb"');
    expect(appSource).toContain('title: "Auswertung"');
    expect(appSource).toContain('eventStep === "completion"');
    expect(appSource).toContain("<CompletionWorkspace");
  });

  it("keeps the admin bar action touchable", () => {
    expect(stylesSource).toMatch(
      /\.admin-mode-bar > button \{[\s\S]*pointer-events: auto;[\s\S]*touch-action: manipulation;/,
    );
  });

  it("finishes a factory reset even when no service worker is registered", () => {
    expect(appSource).toContain('className="confirmation-dialog factory-reset-dialog"');
    expect(appSource).toContain('type="submit"');
    expect(appSource).toContain("Alles löschen und neu starten");
  });
});
