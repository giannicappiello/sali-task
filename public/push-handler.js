self.addEventListener("push", (event) => {
  let payload;
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "Progre Workspace", body: event.data?.text() || "Nuova notifica" };
  }

  event.waitUntil(
    self.registration.showNotification(payload.title || "Progre Workspace", {
      body: payload.body || "Hai una nuova notifica.",
      icon: "/pwa-192x192.png",
      badge: "/pwa-192x192.png",
      tag: payload.tag || payload.id || "workspace-notification",
      renotify: true,
      silent: false,
      vibrate: [250, 100, 250],
      data: {
        url: payload.url || "/",
        notificationId: payload.id || null,
        conversationId: payload.conversationId || payload.metadata?.chat_conversazione_id || null,
      },
    })
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== "WORKSPACE_CHAT_READ" || !event.data.conversationId) return;
  event.waitUntil(
    self.registration.getNotifications().then((notifications) => {
      notifications
        .filter((notification) => notification.data?.conversationId === event.data.conversationId)
        .forEach((notification) => notification.close());
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const existing = windows.find((client) => client.url.startsWith(self.location.origin));
      if (existing) {
        existing.navigate(targetUrl);
        return existing.focus();
      }
      return self.clients.openWindow(targetUrl);
    })
  );
});
