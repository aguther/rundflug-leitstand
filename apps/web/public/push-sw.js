self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith("/api/")) return;

  // Operational API responses must never come from the PWA cache. Keeping this explicit also
  // repairs older installed clients whose Workbox navigation fallback handled requests too broadly.
  event.respondWith(fetch(new Request(event.request, { cache: "no-store" })));
});

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
