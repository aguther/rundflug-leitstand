const DEFAULT_ACTIVATION_TIMEOUT_MS = 4_000;

interface ApplicationVersionRecoveryOptions {
  activationTimeoutMs?: number;
  reload?: () => void;
  serviceWorker?: Pick<ServiceWorkerContainer, "getRegistration">;
}

function currentServiceWorkerContainer():
  | Pick<ServiceWorkerContainer, "getRegistration">
  | undefined {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return undefined;
  return navigator.serviceWorker;
}

function reloadCurrentDocument(): void {
  window.location.reload();
}

function waitForWorkerState(
  worker: ServiceWorker,
  acceptedStates: ReadonlySet<ServiceWorkerState>,
  timeoutMs: number,
): Promise<void> {
  if (acceptedStates.has(worker.state)) return Promise.resolve();

  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timer);
      worker.removeEventListener("statechange", handleStateChange);
      resolve();
    };
    const handleStateChange = () => {
      if (acceptedStates.has(worker.state) || worker.state === "redundant") finish();
    };
    const timer = globalThis.setTimeout(finish, timeoutMs);
    worker.addEventListener("statechange", handleStateChange);
    handleStateChange();
  });
}

async function activateLatestServiceWorker(
  registration: ServiceWorkerRegistration,
  timeoutMs: number,
): Promise<void> {
  await registration.update();

  const installingWorker = registration.installing;
  if (installingWorker) {
    await waitForWorkerState(installingWorker, new Set(["installed", "activated"]), timeoutMs);
  }

  const waitingWorker =
    registration.waiting ?? (installingWorker?.state === "installed" ? installingWorker : null);
  if (!waitingWorker) return;

  waitingWorker.postMessage({ type: "SKIP_WAITING" });
  await waitForWorkerState(waitingWorker, new Set(["activated"]), timeoutMs);
}

export async function recoverApplicationVersion(
  options: ApplicationVersionRecoveryOptions = {},
): Promise<void> {
  const reload = options.reload ?? reloadCurrentDocument;
  const serviceWorker = options.serviceWorker ?? currentServiceWorkerContainer();
  const timeoutMs = options.activationTimeoutMs ?? DEFAULT_ACTIVATION_TIMEOUT_MS;

  try {
    const registration = await serviceWorker?.getRegistration();
    if (registration) await activateLatestServiceWorker(registration, timeoutMs);
  } catch {
    // Reload still provides the normal recovery path when the update check is unavailable.
  } finally {
    reload();
  }
}
