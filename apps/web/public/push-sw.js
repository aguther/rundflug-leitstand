self.PUBLIC_STATUS_PATH = /^\/(?:ticket|gruppe)\/[A-Z2-9]{12,32}$/;

function safePublicStatusPath(value) {
  return typeof value === "string" && self.PUBLIC_STATUS_PATH.test(value) ? value : null;
}

self.addEventListener("push", (event) => {
  const message = event.data?.json() ?? {
    title: "Rundflug-Leitstand",
    body: "Der Status Ihres Tickets hat sich geändert.",
  };
  const targetPath = safePublicStatusPath(message.url);
  event.waitUntil(
    self.registration.showNotification(message.title, {
      body: message.body,
      data: targetPath ? { url: targetPath } : {},
      tag: "rundflug-ticket-status",
    }),
  );
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
