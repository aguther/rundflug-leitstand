self.addEventListener("push", (event) => {
  const message = event.data?.json() ?? {
    title: "Rundflug-Leitstand",
    body: "Der Status Ihres Tickets hat sich geändert.",
    url: "/",
  };
  event.waitUntil(
    self.registration.showNotification(message.title, {
      body: message.body,
      data: { url: message.url ?? "/" },
      tag: "rundflug-ticket-status",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow(event.notification.data?.url ?? "/"));
});
