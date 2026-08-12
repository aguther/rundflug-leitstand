import { ValidationHint } from "../../../admin-ux";
import { Button } from "../../../design-system/components";

interface AdminAccessStatusBarProps {
  adminModeUnlocked: boolean;
  administrator: boolean;
  authenticatedAdminLoginCode: string | null;
  boardLoadFailed: boolean;
  logoutBusy: boolean;
  onLockAdminMode: () => void;
  onLogout: () => void;
  onRefresh: () => void;
  onRequestAdminModeUnlock: () => void;
  refreshing: boolean;
}

function accessPresentation(authenticated: boolean, unlocked: boolean) {
  if (authenticated) {
    return {
      title: "Administration aktiv",
      descriptionSuffix: " · Änderungen werden dem angemeldeten Konto zugeordnet.",
      actionLabel: "Abmelden",
      hint: "Die Anmeldung ersetzt wiederholte PIN-Abfragen. Jede Änderung bleibt einzeln protokolliert.",
    };
  }
  if (unlocked) {
    return {
      title: "Bearbeitungsmodus aktiv",
      description:
        "Mehrere Änderungen sind möglich. Jede Änderung wird weiterhin einzeln protokolliert.",
      actionLabel: "Bearbeitungsmodus sperren",
      hint: "Änderungen sind freigeschaltet und werden automatisch protokolliert.",
    };
  }
  return {
    title: "Administration gesperrt",
    description:
      "Änderungen fragen die PIN einzeln ab oder können für diese Arbeitssitzung entsperrt werden.",
    actionLabel: "Bearbeitungsmodus entsperren",
    hint: "Beim Auslösen einer administrativen Änderung erscheint die PIN-Abfrage.",
  };
}

function BoardStatusHint({
  administrator,
  boardLoadFailed,
}: Pick<AdminAccessStatusBarProps, "administrator" | "boardLoadFailed">) {
  if (administrator) {
    return null;
  }
  if (boardLoadFailed) {
    return (
      <ValidationHint tone="error">
        Der Betriebsstand konnte nicht geladen werden. Erneut laden oder mit einem
        Administrationskonto anmelden; vorhandene Betriebsdaten bleiben unverändert.
      </ValidationHint>
    );
  }
  return <ValidationHint>Sitzung und Betriebsstand werden geprüft.</ValidationHint>;
}

export function AdminAccessStatusBar({
  adminModeUnlocked,
  administrator,
  authenticatedAdminLoginCode,
  boardLoadFailed,
  logoutBusy,
  onLockAdminMode,
  onLogout,
  onRefresh,
  onRequestAdminModeUnlock,
  refreshing,
}: AdminAccessStatusBarProps) {
  const authenticatedAdministrator = authenticatedAdminLoginCode !== null;
  const presentation = accessPresentation(authenticatedAdministrator, adminModeUnlocked);
  let adminAction = onRequestAdminModeUnlock;
  if (authenticatedAdministrator) {
    adminAction = onLogout;
  } else if (adminModeUnlocked) {
    adminAction = onLockAdminMode;
  }
  const description = authenticatedAdministrator
    ? `${authenticatedAdminLoginCode}${presentation.descriptionSuffix}`
    : presentation.description;

  return (
    <section
      className={`admin-edit-context admin-mode-bar ${adminModeUnlocked ? "unlocked" : "locked"}`}
    >
      <div>
        <strong>{presentation.title}</strong>
        <span>{description}</span>
      </div>
      {administrator ? (
        <Button
          busy={authenticatedAdministrator && logoutBusy}
          className="secondary-action"
          onClick={adminAction}
          type="button"
        >
          {presentation.actionLabel}
        </Button>
      ) : (
        <div className="secondary-actions admin-recovery-actions">
          <Button busy={refreshing} className="secondary-action" onClick={onRefresh} type="button">
            Erneut laden
          </Button>
          <Button
            busy={logoutBusy}
            className="secondary-action"
            disabled={refreshing}
            onClick={onLogout}
            type="button"
          >
            Mit Administrationskonto anmelden
          </Button>
        </div>
      )}
      <BoardStatusHint administrator={administrator} boardLoadFailed={boardLoadFailed} />
      <ValidationHint>{presentation.hint}</ValidationHint>
    </section>
  );
}
