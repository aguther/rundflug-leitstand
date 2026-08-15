import { RefreshCw } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { PageNotice } from "./PageNotifications";
import { PWA_UPDATE_CONTROLLER_READY_EVENT } from "./pwa-update-events";

export type PwaUpdateStatus = "idle" | "available" | "blocked" | "applying" | "failed";
export type UpdateBlockerKind = "dirty" | "pending";
export type UpdateServiceWorker = (reloadPage?: boolean) => Promise<void>;

export interface PwaUpdateSnapshot {
  status: PwaUpdateStatus;
  dirtyCount: number;
  pendingCount: number;
  applyRequested: boolean;
}

const listeners = new Set<() => void>();
const blockers = new Map<string, UpdateBlockerKind>();
const RELOAD_FALLBACK_DELAY_MS = 4_000;
let updateServiceWorker: UpdateServiceWorker | null = null;
let reloadFallbackTimer: ReturnType<typeof setTimeout> | null = null;
let removeControllerChangeListener: (() => void) | null = null;

function defaultReloadApplication() {
  window.location.reload();
}

let reloadApplication = defaultReloadApplication;
let snapshot: PwaUpdateSnapshot = {
  status: "idle",
  dirtyCount: 0,
  pendingCount: 0,
  applyRequested: false,
};

function blockerCount(kind: UpdateBlockerKind): number {
  let count = 0;
  for (const blockerKind of blockers.values()) {
    if (blockerKind === kind) count += 1;
  }
  return count;
}

function publish(next: Partial<PwaUpdateSnapshot>) {
  snapshot = {
    ...snapshot,
    ...next,
    dirtyCount: blockerCount("dirty"),
    pendingCount: blockerCount("pending"),
  };
  for (const listener of listeners) listener();
}

function hasBlockers(): boolean {
  return blockers.size > 0;
}

function clearReloadFallback() {
  if (reloadFallbackTimer === null) return;
  globalThis.clearTimeout(reloadFallbackTimer);
  reloadFallbackTimer = null;
}

function clearControllerChangeListener() {
  removeControllerChangeListener?.();
  removeControllerChangeListener = null;
}

function reloadUpdatedApplication() {
  clearReloadFallback();
  clearControllerChangeListener();
  reloadApplication();
}

function monitorControllerChange() {
  clearControllerChangeListener();
  if (typeof window === "undefined") return;
  const serviceWorker = typeof navigator === "undefined" ? undefined : navigator.serviceWorker;
  const handleControllerChange = () => reloadUpdatedApplication();
  window.addEventListener(PWA_UPDATE_CONTROLLER_READY_EVENT, handleControllerChange, {
    once: true,
  });
  serviceWorker?.addEventListener("controllerchange", handleControllerChange, { once: true });
  removeControllerChangeListener = () => {
    window.removeEventListener(PWA_UPDATE_CONTROLLER_READY_EVENT, handleControllerChange);
    serviceWorker?.removeEventListener("controllerchange", handleControllerChange);
  };
}

function scheduleReloadFallback() {
  clearReloadFallback();
  reloadFallbackTimer = globalThis.setTimeout(() => {
    reloadFallbackTimer = null;
    reloadUpdatedApplication();
  }, RELOAD_FALLBACK_DELAY_MS);
}

async function applyAvailableUpdate() {
  if (!updateServiceWorker) return;
  if (hasBlockers()) {
    publish({ applyRequested: true, status: "blocked" });
    return;
  }
  publish({ applyRequested: false, status: "applying" });
  monitorControllerChange();
  scheduleReloadFallback();
  try {
    await updateServiceWorker(true);
  } catch {
    clearReloadFallback();
    clearControllerChangeListener();
    publish({ status: "failed" });
  }
}

export function announcePwaUpdate(serviceWorkerUpdater: UpdateServiceWorker) {
  updateServiceWorker = serviceWorkerUpdater;
  publish({
    applyRequested: false,
    status: hasBlockers() ? "blocked" : "available",
  });
}

export function requestPwaUpdate() {
  return applyAvailableUpdate();
}

export function deferPwaUpdate() {
  clearReloadFallback();
  clearControllerChangeListener();
  if (typeof window !== "undefined") delete window.rundflugPwaUpdateServiceWorker;
  publish({ applyRequested: false, status: "idle" });
}

export function registerUpdateBlocker(kind: UpdateBlockerKind, id: string): () => void {
  const key = `${kind}:${id}`;
  blockers.set(key, kind);
  if (snapshot.status === "available" || snapshot.status === "blocked") {
    publish({ status: "blocked" });
  } else {
    publish({});
  }
  let registered = true;
  return () => {
    if (!registered) return;
    registered = false;
    blockers.delete(key);
    if (blockers.size === 0 && snapshot.status === "blocked") {
      if (snapshot.applyRequested) {
        void applyAvailableUpdate();
      } else {
        publish({ status: "available" });
      }
      return;
    }
    publish({});
  };
}

export function useUpdateBlocker(kind: UpdateBlockerKind, id: string, active: boolean) {
  useEffect(() => {
    if (!active) return undefined;
    return registerUpdateBlocker(kind, id);
  }, [active, id, kind]);
}

export function getPwaUpdateSnapshot(): PwaUpdateSnapshot {
  return snapshot;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePwaUpdateSnapshot(): PwaUpdateSnapshot {
  return useSyncExternalStore(subscribe, getPwaUpdateSnapshot, getPwaUpdateSnapshot);
}

function useDocumentPendingBlocker() {
  const [pending, setPending] = useState(false);
  useEffect(() => {
    const updatePendingState = () => {
      setPending(Boolean(document.querySelector('[aria-busy="true"]')));
    };
    updatePendingState();
    const observer = new MutationObserver(updatePendingState);
    observer.observe(document.body, {
      attributeFilter: ["aria-busy"],
      attributes: true,
      childList: true,
      subtree: true,
    });
    return () => observer.disconnect();
  }, []);
  useUpdateBlocker("pending", "document-busy-state", pending);
}

function updateCopy(update: PwaUpdateSnapshot): { title: string; description: string } {
  if (update.status === "blocked") {
    return {
      title: "Nach Abschluss aktualisieren",
      description: update.applyRequested
        ? "Das Update wird angewandt, sobald alle Änderungen und Aktionen abgeschlossen sind."
        : "Offene Änderungen oder laufende Aktionen verhindern den Neustart.",
    };
  }
  if (update.status === "applying") {
    return {
      title: "Aktualisierung wird vorbereitet …",
      description: "Die Anwendung startet anschließend mit dem neuen Stand.",
    };
  }
  if (update.status === "failed") {
    return {
      title: "Aktualisierung fehlgeschlagen",
      description: "Die Anwendung bleibt bedienbar. Das Update kann erneut versucht werden.",
    };
  }
  return {
    title: "Update verfügbar",
    description: "Der neue Stand wird erst nach Ihrer Bestätigung geladen.",
  };
}

function updateActionLabel(update: PwaUpdateSnapshot): string {
  if (update.status === "blocked") return "Nach Abschluss";
  if (update.status === "failed") return "Erneut versuchen";
  return "Jetzt aktualisieren";
}

function updateNoticeTone(update: PwaUpdateSnapshot): "danger" | "info" | "warning" {
  if (update.status === "failed") return "danger";
  if (update.status === "blocked") return "warning";
  return "info";
}

export function PwaUpdateNotice() {
  useEffect(() => {
    const receiveAvailableUpdate = () => {
      if (window.rundflugPwaUpdateServiceWorker) {
        announcePwaUpdate(window.rundflugPwaUpdateServiceWorker);
      }
    };
    receiveAvailableUpdate();
    window.addEventListener("rundflug:pwa-update-available", receiveAvailableUpdate);
    return () =>
      window.removeEventListener("rundflug:pwa-update-available", receiveAvailableUpdate);
  }, []);
  useDocumentPendingBlocker();
  const update = usePwaUpdateSnapshot();
  if (update.status === "idle") return null;
  const copy = updateCopy(update);
  const blocked = update.status === "blocked";
  const applying = update.status === "applying";
  return (
    <PageNotice
      dismissible={false}
      noticeKey={`pwa-update:${update.status}:${update.applyRequested}`}
      tone={updateNoticeTone(update)}
    >
      <div className="pwa-update-notice">
        <span className="pwa-update-copy">
          <strong>{copy.title}</strong>
          <small>{copy.description}</small>
        </span>
        <span className="pwa-update-actions">
          <button
            disabled={applying || (blocked && update.applyRequested)}
            onClick={() => void requestPwaUpdate()}
            type="button"
          >
            <RefreshCw aria-hidden="true" size={16} />
            {updateActionLabel(update)}
          </button>
          {!applying ? (
            <button onClick={deferPwaUpdate} type="button">
              Später
            </button>
          ) : null}
        </span>
      </div>
    </PageNotice>
  );
}

export function resetPwaUpdateStateForTests() {
  clearReloadFallback();
  clearControllerChangeListener();
  blockers.clear();
  updateServiceWorker = null;
  reloadApplication = defaultReloadApplication;
  snapshot = {
    status: "idle",
    dirtyCount: 0,
    pendingCount: 0,
    applyRequested: false,
  };
  for (const listener of listeners) listener();
}

export function setPwaUpdateReloadForTests(reload: () => void) {
  reloadApplication = reload;
}
