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

  return (
    <section
      className={`admin-edit-context admin-mode-bar ${adminModeUnlocked ? "unlocked" : "locked"}`}
    >
      <div>
        <strong>
          {authenticatedAdministrator
            ? "Administration aktiv"
            : adminModeUnlocked
              ? "Bearbeitungsmodus aktiv"
              : "Administration gesperrt"}
        </strong>
        <span>
          {authenticatedAdministrator
            ? `${authenticatedAdminLoginCode} · Änderungen werden dem angemeldeten Konto zugeordnet.`
            : adminModeUnlocked
              ? "Mehrere Änderungen sind möglich. Jede Änderung wird weiterhin einzeln protokolliert."
              : "Änderungen fragen die PIN einzeln ab oder können für diese Arbeitssitzung entsperrt werden."}
        </span>
      </div>
      {administrator ? (
        <Button
          busy={authenticatedAdministrator && logoutBusy}
          className="secondary-action"
          onClick={
            authenticatedAdministrator
              ? onLogout
              : adminModeUnlocked
                ? onLockAdminMode
                : onRequestAdminModeUnlock
          }
          type="button"
        >
          {authenticatedAdministrator
            ? "Abmelden"
            : adminModeUnlocked
              ? "Bearbeitungsmodus sperren"
              : "Bearbeitungsmodus entsperren"}
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
      {!administrator ? (
        boardLoadFailed ? (
          <ValidationHint tone="error">
            Der Betriebsstand konnte nicht geladen werden. Erneut laden oder mit einem
            Administrationskonto anmelden; vorhandene Betriebsdaten bleiben unverändert.
          </ValidationHint>
        ) : (
          <ValidationHint>Sitzung und Betriebsstand werden geprüft.</ValidationHint>
        )
      ) : null}
      <ValidationHint>
        {authenticatedAdministrator
          ? "Die Anmeldung ersetzt wiederholte PIN-Abfragen. Jede Änderung bleibt einzeln protokolliert."
          : adminModeUnlocked
            ? "Änderungen sind freigeschaltet und werden automatisch protokolliert."
            : "Beim Auslösen einer administrativen Änderung erscheint die PIN-Abfrage."}
      </ValidationHint>
    </section>
  );
}
