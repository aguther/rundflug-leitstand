import { useCallback, useEffect, useRef, useState } from "react";
import { verifyAdminPin } from "../../api";
import { useAdminOperationIdentity } from "../operations/operation-identity";

type PendingAdminAction = () => Promise<void>;

interface UseAdminAuthorizationOptions {
  accountIsAdministrator: boolean;
  administrator: boolean;
  onMessage: (message: string) => void;
}

export function useAdminAuthorization({
  accountIsAdministrator,
  administrator,
  onMessage,
}: UseAdminAuthorizationOptions) {
  const {
    eventId: EVENT_ID,
    deviceId: ADMIN_DEVICE_ID,
    deviceToken: ADMIN_DEVICE_TOKEN,
  } = useAdminOperationIdentity();
  const initialPin = accountIsAdministrator ? "000000" : "";
  const [pin, setPinState] = useState(initialPin);
  const pinRef = useRef(initialPin);
  const [modeUnlocked, setModeUnlocked] = useState(accountIsAdministrator);
  const [dialogMode, setDialogMode] = useState<"unlock" | "action" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pendingActionRef = useRef<PendingAdminAction | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const setPin = useCallback((value: string) => {
    pinRef.current = value;
    setPinState(value);
  }, []);

  const getPin = useCallback(() => pinRef.current, []);

  const clearPinWhenLocked = useCallback(() => {
    if (!modeUnlocked) setPin("");
  }, [modeUnlocked, setPin]);

  const lockMode = useCallback(
    (message = "Bearbeitungsmodus gesperrt.") => {
      setModeUnlocked(false);
      setPin("");
      setDialogMode(null);
      pendingActionRef.current = null;
      onMessage(message);
    },
    [onMessage, setPin],
  );

  const closeDialog = useCallback(() => {
    if (busy) return;
    setDialogMode(null);
    setError(null);
    setPin("");
    pendingActionRef.current = null;
  }, [busy, setPin]);

  const requestAction = useCallback(
    (action: PendingAdminAction): void | Promise<void> => {
      if (!administrator) {
        onMessage("Für diese Änderung wird ein Administrationskonto benötigt.");
        return;
      }
      if (accountIsAdministrator || (modeUnlocked && pinRef.current.length >= 4)) {
        return action();
      }
      pendingActionRef.current = action;
      setPin("");
      setError(null);
      setDialogMode("action");
    },
    [accountIsAdministrator, administrator, modeUnlocked, onMessage, setPin],
  );

  const requestModeUnlock = useCallback(() => {
    if (!administrator) {
      onMessage("Der Bearbeitungsmodus ist nur mit einer Administrationssitzung verfügbar.");
      return;
    }
    if (accountIsAdministrator) {
      setModeUnlocked(true);
      setPin("000000");
      return;
    }
    pendingActionRef.current = null;
    setPin("");
    setError(null);
    setDialogMode("unlock");
  }, [accountIsAdministrator, administrator, onMessage, setPin]);

  const confirmDialog = useCallback(async () => {
    if (!dialogMode || busy || pin.length < 4) return;
    setBusy(true);
    setError(null);
    try {
      await verifyAdminPin(EVENT_ID, ADMIN_DEVICE_ID, ADMIN_DEVICE_TOKEN, pin);
      if (dialogMode === "unlock") {
        setModeUnlocked(true);
        setDialogMode(null);
        onMessage("Bearbeitungsmodus aktiv. Mehrere Änderungen können gespeichert werden.");
        return;
      }
      const action = pendingActionRef.current;
      pendingActionRef.current = null;
      setDialogMode(null);
      if (action) await action();
      setPin("");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Administrator-PIN konnte nicht geprüft werden.",
      );
      window.requestAnimationFrame(() => inputRef.current?.select());
    } finally {
      setBusy(false);
    }
  }, [busy, dialogMode, onMessage, pin, setPin, EVENT_ID, ADMIN_DEVICE_TOKEN, ADMIN_DEVICE_ID]);

  useEffect(() => {
    if (!dialogMode) return;
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [dialogMode]);

  useEffect(() => {
    if (!accountIsAdministrator) return;
    setModeUnlocked(true);
    setPin("000000");
  }, [accountIsAdministrator, setPin]);

  useEffect(() => {
    if (administrator) return;
    setModeUnlocked(false);
    setPin("");
  }, [administrator, setPin]);

  return {
    busy,
    clearPinWhenLocked,
    closeDialog,
    confirmDialog,
    dialogMode,
    error,
    getPin,
    inputRef,
    lockMode,
    modeUnlocked,
    pin,
    requestAction,
    requestModeUnlock,
    setPin,
  };
}
