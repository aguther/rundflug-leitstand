import { useEffect, useState } from "react";
import {
  getPushConfiguration,
  registerGroupPush,
  registerTicketPush,
  revokeGroupPush,
  revokeTicketPush,
} from "../../api";
import type { PublicStatusTarget } from "./use-public-status-manifest";

const IOS_INSTALL_MESSAGE =
  "Auf dem iPhone: Zum Home-Bildschirm hinzufügen, dann Benachrichtigungen aktivieren.";

type PushCapability = "checking" | "ready" | "install-required" | "unsupported" | "unconfigured";

interface IosNavigator extends Navigator {
  standalone?: boolean;
}

export function isIosDevice(input: {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
}): boolean {
  return (
    /iPad|iPhone|iPod/.test(input.userAgent) ||
    (input.platform === "MacIntel" && input.maxTouchPoints > 1)
  );
}

export function isStandaloneDisplay(input: {
  navigatorStandalone: boolean;
  displayModeStandalone: boolean;
}): boolean {
  return input.navigatorStandalone || input.displayModeStandalone;
}

function environmentCapability(): PushCapability {
  const ios = isIosDevice({
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
  });
  const standalone = isStandaloneDisplay({
    navigatorStandalone: (navigator as IosNavigator).standalone === true,
    displayModeStandalone: window.matchMedia("(display-mode: standalone)").matches,
  });
  if (ios && !standalone) return "install-required";
  if (
    !("serviceWorker" in navigator) ||
    !("PushManager" in window) ||
    !("Notification" in window)
  ) {
    return "unsupported";
  }
  return "checking";
}

function capabilityMessage(capability: PushCapability): string | null {
  if (capability === "install-required") return IOS_INSTALL_MESSAGE;
  if (capability === "unsupported")
    return "Benachrichtigungen werden von diesem Browser nicht unterstützt.";
  if (capability === "unconfigured")
    return "Benachrichtigungen sind für diese Veranstaltung noch nicht eingerichtet.";
  return null;
}

export function usePublicPush(target: PublicStatusTarget, code: string) {
  const storageKey = `${target}-push:${code}`;
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [capability, setCapability] = useState<PushCapability>(environmentCapability);
  const [message, setMessage] = useState<string | null>(() =>
    capabilityMessage(environmentCapability()),
  );
  const [publicKey, setPublicKey] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const environment = environmentCapability();
    setCapability(environment);
    setMessage(capabilityMessage(environment));
    setEnabled(false);
    setPublicKey(null);
    if (environment !== "checking") return () => undefined;

    void Promise.all([
      navigator.serviceWorker.ready.then((registration) =>
        registration.pushManager.getSubscription(),
      ),
      getPushConfiguration(),
    ])
      .then(([subscription, configuration]) => {
        if (!active) return;
        const locallyEnabled =
          Boolean(subscription) && window.localStorage.getItem(storageKey) === "1";
        setEnabled(locallyEnabled);
        if (configuration.configured) {
          setPublicKey(configuration.publicKey);
          setCapability("ready");
          setMessage(
            Notification.permission === "denied"
              ? "Benachrichtigungen wurden auf diesem Gerät abgelehnt. Bitte in den Systemeinstellungen erlauben."
              : null,
          );
        } else if (locallyEnabled) {
          setCapability("ready");
        } else {
          setCapability("unconfigured");
          setMessage(capabilityMessage("unconfigured"));
        }
      })
      .catch(() => {
        if (!active) return;
        setCapability("unsupported");
        setMessage("Benachrichtigungen sind momentan nicht verfügbar.");
      });
    return () => {
      active = false;
    };
  }, [storageKey]);

  const change = async (nextEnabled: boolean) => {
    if (busy || capability !== "ready") return;
    setBusy(true);
    setMessage(null);
    try {
      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      if (!nextEnabled) {
        if (existing) {
          if (target === "group") await revokeGroupPush(code, existing.endpoint);
          else await revokeTicketPush(code, existing.endpoint);
          await existing.unsubscribe();
        }
        window.localStorage.removeItem(storageKey);
        setEnabled(false);
        setMessage("Benachrichtigungen wurden deaktiviert.");
        return;
      }
      if (Notification.permission === "denied") {
        throw new Error(
          "Benachrichtigungen wurden auf diesem Gerät abgelehnt. Bitte in den Systemeinstellungen erlauben.",
        );
      }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        throw new Error("Benachrichtigungen wurden nicht erlaubt.");
      }
      if (!publicKey && !existing) {
        throw new Error("Benachrichtigungen sind für diese Veranstaltung noch nicht eingerichtet.");
      }
      const subscription =
        existing ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: publicKey as string,
        }));
      if (target === "group") await registerGroupPush(code, subscription);
      else await registerTicketPush(code, subscription);
      window.localStorage.setItem(storageKey, "1");
      setEnabled(true);
      setMessage(
        target === "group"
          ? "Benachrichtigungen sind für diese Gruppe aktiviert."
          : "Benachrichtigungen sind für dieses Ticket aktiviert.",
      );
    } catch (reason) {
      setEnabled(false);
      setMessage(
        reason instanceof Error ? reason.message : "Benachrichtigungen sind nicht verfügbar.",
      );
    } finally {
      setBusy(false);
    }
  };

  return {
    enabled,
    busy,
    disabled: capability !== "ready" || busy,
    message,
    change,
  };
}
