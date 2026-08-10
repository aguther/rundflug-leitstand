import { useCallback, useEffect, useState } from "react";
import { getPushConfiguration, getSetupStatus } from "../../api";
import type { PushConfigurationStatus } from "./overview/AdminOverviewPanel";

interface UseAdminShellStateOptions {
  boardAvailable: boolean;
  logout: () => Promise<void>;
  reload?: () => void;
}

const reloadPage = () => window.location.reload();

export function useAdminShellState({
  boardAvailable,
  logout,
  reload = reloadPage,
}: UseAdminShellStateOptions) {
  const [busyActionKey, setBusyActionKey] = useState<string | null>(null);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [pushConfigurationStatus, setPushConfigurationStatus] =
    useState<PushConfigurationStatus>("loading");
  const [setupRequired, setSetupRequired] = useState(false);

  const runBusyAction = useCallback(
    async (key: string, action: () => Promise<void>) => {
      if (busyActionKey) return;
      setBusyActionKey(key);
      try {
        await action();
      } finally {
        setBusyActionKey(null);
      }
    },
    [busyActionKey],
  );

  const logoutAndReload = useCallback(async () => {
    setLogoutBusy(true);
    try {
      await logout();
      reload();
    } finally {
      setLogoutBusy(false);
    }
  }, [logout, reload]);

  useEffect(() => {
    const controller = new AbortController();
    void getPushConfiguration(controller.signal)
      .then((configuration) =>
        setPushConfigurationStatus(configuration.configured ? "configured" : "missing"),
      )
      .catch((cause) => {
        if (!(cause instanceof DOMException && cause.name === "AbortError")) {
          setPushConfigurationStatus("unavailable");
        }
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (boardAvailable) {
      setSetupRequired(false);
      return;
    }
    void getSetupStatus()
      .then((result) => setSetupRequired(result.setupRequired))
      .catch(() => setSetupRequired(false));
  }, [boardAvailable]);

  return {
    busyActionKey,
    logoutAndReload,
    logoutBusy,
    pushConfigurationStatus,
    runBusyAction,
    setupRequired,
  };
}
