import { ValidationHint } from "../../../admin-ux";
import { Button } from "../../../design-system/components";
import { accessPresentation, BoardStatusHint } from "./admin-access-presentation";

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
