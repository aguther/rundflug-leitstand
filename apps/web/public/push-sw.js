self.PUBLIC_STATUS_PATH = /^\/(?:ticket|gruppe)\/[A-Z2-9]{12,32}$/;

function safePublicStatusPath(value) {
  return typeof value === "string" && self.PUBLIC_STATUS_PATH.test(value) ? value : null;
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
