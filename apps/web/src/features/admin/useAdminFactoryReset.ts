import { useState } from "react";
import { factoryReset } from "../../api";
import { clearOfflineOperationBoards } from "../../offline-store";
import { useAdminOperationIdentity } from "../operations/operation-identity";

interface UseAdminFactoryResetOptions {
  onMessage: (message: string | null) => void;
  onResetComplete?: () => Promise<void>;
}

interface FactoryResetClientDependencies {
  getRegistration?: () => Promise<ServiceWorkerRegistration | undefined>;
  navigate?: (path: string) => void;
}

export async function clearFactoryResetClientState({
  getRegistration = () => navigator.serviceWorker?.getRegistration(),
  navigate = (path) => window.location.replace(path),
}: FactoryResetClientDependencies = {}) {
  await clearOfflineOperationBoards();
  try {
    // Service worker readiness may remain pending when no PWA registration exists.
    const registration = await getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    await subscription?.unsubscribe();
  } catch {
    // Server state is already reset; local push cleanup is best effort.
  }
  window.localStorage.clear();
  navigate("/setup");
}

export function useAdminFactoryReset({
  onMessage,
  onResetComplete = clearFactoryResetClientState,
}: UseAdminFactoryResetOptions) {
  const {
    eventId: EVENT_ID,
    deviceId: ADMIN_DEVICE_ID,
    deviceToken: ADMIN_DEVICE_TOKEN,
  } = useAdminOperationIdentity();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [pin, setPin] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [retainRecoveryBackup, setRetainRecoveryBackup] = useState(true);
  const [deleteAllBackups, setDeleteAllBackups] = useState(false);
  const [commandId, setCommandId] = useState(() => crypto.randomUUID());

  function openDialog() {
    setCommandId(crypto.randomUUID());
    setError(null);
    onMessage(null);
    setReason("");
    setPin("");
    setConfirmation("");
    setRetainRecoveryBackup(true);
    setDeleteAllBackups(false);
    setOpen(true);
  }

  async function performReset() {
    if (
      busy ||
      reason.trim().length < 3 ||
      !/^\d{6,12}$/.test(pin) ||
      confirmation !== "WERKSZUSTAND"
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await factoryReset(EVENT_ID, ADMIN_DEVICE_ID, ADMIN_DEVICE_TOKEN, {
        commandId,
        eventId: EVENT_ID,
        reason: reason.trim(),
        adminPin: pin,
        confirmation: "WERKSZUSTAND",
        retainRecoveryBackup,
        deleteAllBackups,
      });
      if (result.resetComplete) await onResetComplete();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Werkszustand konnte nicht hergestellt werden.",
      );
      setBusy(false);
    }
  }

  return {
    busy,
    closeDialog: () => setOpen(false),
    confirmation,
    deleteAllBackups,
    error,
    open,
    openDialog,
    performReset,
    pin,
    reason,
    retainRecoveryBackup,
    setConfirmation,
    setDeleteAllBackups: (checked: boolean) => {
      setDeleteAllBackups(checked);
      if (checked) setRetainRecoveryBackup(false);
    },
    setPin,
    setReason,
    setRetainRecoveryBackup: (checked: boolean) => {
      setRetainRecoveryBackup(checked);
      if (checked) setDeleteAllBackups(false);
    },
  };
}
