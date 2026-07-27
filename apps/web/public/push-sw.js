self.PUBLIC_STATUS_PATH = /^\/(?:ticket|gruppe)\/[A-Z2-9]{12,32}$/;

function safePublicStatusPath(value) {
  if (typeof value !== "string") return null;
  let target;
  try {
    target = new URL(value, self.location.origin);
  } catch {
    return null;
  }
  if (target.origin !== self.location.origin) return null;
  return self.PUBLIC_STATUS_PATH.test(target.pathname) ? target.pathname : null;
}

function pushMessage(data) {
  const notification =
    data?.web_push === 8030 && data.notification && typeof data.notification === "object"
      ? data.notification
      : data;
  return {
    title: typeof notification?.title === "string" ? notification.title : "Rundflug-Leitstand",
    body:
      typeof notification?.body === "string"
        ? notification.body
        : "Der Status Ihres Tickets hat sich geändert.",
    url:
      typeof notification?.navigate === "string"
        ? notification.navigate
        : (notification?.data?.url ?? notification?.url),
  };
}

self.addEventListener("push", (event) => {
  let data;
  try {
    data = event.data?.json();
  } catch {
    data = undefined;
  }
  const message = pushMessage(data);
  const targetPath = safePublicStatusPath(message.url);
  event.waitUntil(
    self.registration.showNotification(message.title, {
      body: message.body,
      data: targetPath ? { url: targetPath } : {},
      lang: "de",
    }),
  );
});

async function renewedSubscription(existing) {
  if (existing) return existing;
  const current = await self.registration.pushManager.getSubscription();
  if (current) return current;
  const response = await self.fetch("/api/public/push/config", { cache: "no-store" });
  if (!response.ok) return null;
  const configuration = await response.json();
  if (typeof configuration?.publicKey !== "string") return null;
  return await self.registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: configuration.publicKey,
  });
}

// Erneuert der Browser das Abonnement, zeigt der Schalter weiter „aktiviert", während der alte
// Endpunkt tot ist. Die Einwilligung wird deshalb ohne Zutun des Gastes auf das neue Ziel gehoben.
async function renewPushSubscription(oldSubscription, newSubscription) {
  const previousEndpoint = oldSubscription?.endpoint;
  if (typeof previousEndpoint !== "string") return;
  const subscription = await renewedSubscription(newSubscription);
  if (!subscription) return;
  await self.fetch("/api/public/push/subscriptions/refresh", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ previousEndpoint, ...subscription.toJSON() }),
  });
}

self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(renewPushSubscription(event.oldSubscription, event.newSubscription));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetPath = safePublicStatusPath(event.notification.data?.url);
  if (!targetPath) return;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((client) => new URL(client.url).pathname === targetPath);
      return existing ? existing.focus() : self.clients.openWindow(targetPath);
    }),
  );
});
