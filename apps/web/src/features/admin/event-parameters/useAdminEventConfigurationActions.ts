import type { EventLogoTheme, OperationBoard } from "@rundflug/contracts";
import { useCallback } from "react";
import { ApiCommandError, removeEventLogo, sendCommand, uploadEventLogo } from "../../../api";
import {
  ADMIN_CONFIGURATION_AUDIT_REASON,
  ADMIN_DEVICE_ID,
  deviceTokenFor,
  EVENT_ID,
} from "../../../operation-workspace";
import type { EventParameterSaveLifecycle } from "./EventParametersWorkspace";
import type { ValidEventParameterPayload } from "./useEventParametersForm";

interface UseAdminEventConfigurationActionsOptions {
  board: OperationBoard | null;
  clearPinWhenLocked: () => void;
  getAdminPin: () => string;
  onMessage: (message: string) => void;
  refreshBoard: () => Promise<void>;
  refreshEvents: () => Promise<void>;
  refreshHistory: () => Promise<void>;
  requestAdminAction: (action: () => Promise<void>) => void | Promise<void>;
  runBusyAction: (key: string, action: () => Promise<void>) => Promise<void>;
}

export function useAdminEventConfigurationActions({
  board,
  clearPinWhenLocked,
  getAdminPin,
  onMessage,
  refreshBoard,
  refreshEvents,
  refreshHistory,
  requestAdminAction,
  runBusyAction,
}: UseAdminEventConfigurationActionsOptions) {
  const setEventLifecycle = useCallback(
    async (status: "PREPARATION" | "ACTIVE" | "CLOSED" | "ARCHIVED") => {
      if (!board || getAdminPin().length < 4) return;
      try {
        await sendCommand(
          {
            commandId: crypto.randomUUID(),
            eventId: EVENT_ID,
            deviceId: ADMIN_DEVICE_ID,
            expectedVersion: board.event.version,
            issuedAt: new Date().toISOString(),
            type: "SET_EVENT_LIFECYCLE",
            payload: {
              status,
              reason: ADMIN_CONFIGURATION_AUDIT_REASON,
              adminPin: getAdminPin(),
            },
          },
          deviceTokenFor(ADMIN_DEVICE_ID),
        );
        onMessage(`Veranstaltungsstatus auf ${status} gesetzt und protokolliert.`);
        clearPinWhenLocked();
        await refreshBoard();
        await refreshEvents();
      } catch (cause) {
        onMessage(cause instanceof Error ? cause.message : "Statusänderung fehlgeschlagen.");
      }
    },
    [board, clearPinWhenLocked, getAdminPin, onMessage, refreshBoard, refreshEvents],
  );

  const requestSaveEventParameters = useCallback(
    (payload: ValidEventParameterPayload, lifecycle: EventParameterSaveLifecycle) => {
      void requestAdminAction(() =>
        runBusyAction("event-parameters", async () => {
          if (!board || getAdminPin().length < 4) return;
          try {
            await sendCommand(
              {
                commandId: crypto.randomUUID(),
                eventId: EVENT_ID,
                deviceId: ADMIN_DEVICE_ID,
                expectedVersion: board.event.version,
                issuedAt: new Date().toISOString(),
                type: "CONFIGURE_EVENT_PARAMETERS",
                payload: {
                  ...payload,
                  reason: ADMIN_CONFIGURATION_AUDIT_REASON,
                  adminPin: getAdminPin(),
                },
              },
              deviceTokenFor(ADMIN_DEVICE_ID),
            );
            lifecycle.onSaved();
            onMessage("Veranstaltungsparameter wurden protokolliert aktualisiert.");
            clearPinWhenLocked();
            await Promise.all([refreshBoard(), refreshHistory()]);
          } catch (cause) {
            if (
              cause instanceof ApiCommandError &&
              ["STALE_VERSION", "EVENT_VERSION_CONFLICT"].includes(cause.code)
            ) {
              lifecycle.onConflict(cause.currentVersion);
              await refreshBoard();
            }
            onMessage(
              cause instanceof Error
                ? cause.message
                : "Parameter konnten nicht gespeichert werden.",
            );
          }
        }),
      );
    },
    [
      board,
      clearPinWhenLocked,
      getAdminPin,
      onMessage,
      refreshBoard,
      refreshHistory,
      requestAdminAction,
      runBusyAction,
    ],
  );

  const saveEventLogo = useCallback(
    async (theme: EventLogoTheme, file: File) => {
      if (!board) return;
      try {
        await uploadEventLogo(
          EVENT_ID,
          ADMIN_DEVICE_ID,
          deviceTokenFor(ADMIN_DEVICE_ID),
          board.event.version,
          theme,
          file,
        );
        onMessage(
          `Logo für das ${theme === "light" ? "helle" : "dunkle"} Theme gespeichert. Die Ansichten verwenden es nach dem Neuladen.`,
        );
        await refreshBoard();
      } catch (cause) {
        onMessage(cause instanceof Error ? cause.message : "Logo konnte nicht gespeichert werden.");
      }
    },
    [board, onMessage, refreshBoard],
  );

  const requestSaveEventLogo = useCallback(
    (theme: EventLogoTheme, file: File) => {
      void requestAdminAction(() =>
        runBusyAction(`event-logo-${theme}`, () => saveEventLogo(theme, file)),
      );
    },
    [requestAdminAction, runBusyAction, saveEventLogo],
  );

  const clearEventLogo = useCallback(
    async (theme: EventLogoTheme) => {
      if (!board) return;
      try {
        await removeEventLogo(
          EVENT_ID,
          ADMIN_DEVICE_ID,
          deviceTokenFor(ADMIN_DEVICE_ID),
          board.event.version,
          theme,
        );
        onMessage(
          `Logo für das ${theme === "light" ? "helle" : "dunkle"} Theme entfernt. Fehlt die andere Variante ebenfalls, wird die Rundflug-Leitstand-Marke verwendet.`,
        );
        await refreshBoard();
      } catch (cause) {
        onMessage(cause instanceof Error ? cause.message : "Logo konnte nicht entfernt werden.");
      }
    },
    [board, onMessage, refreshBoard],
  );

  const requestClearEventLogo = useCallback(
    (theme: EventLogoTheme) => {
      void requestAdminAction(() =>
        runBusyAction(`clear-event-logo-${theme}`, () => clearEventLogo(theme)),
      );
    },
    [clearEventLogo, requestAdminAction, runBusyAction],
  );

  return {
    requestClearEventLogo,
    requestSaveEventLogo,
    requestSaveEventParameters,
    setEventLifecycle,
  };
}
