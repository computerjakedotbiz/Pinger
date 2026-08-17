/* Service worker: receives Web Push and shows the native notification. */
self.addEventListener("push", event => {
  let data = { title: "Pinger", body: "Reminder", emoji: "🔔" };
  try { data = { ...data, ...event.data.json() }; } catch (e) {}
  const title = data.emoji ? `${data.emoji} ${data.title}` : data.title;
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      tag: data.tag || undefined,   // same tag replaces instead of stacking
      renotify: true,
      icon: "./icon-192.png",
      badge: "./icon-192.png"
    })
  );
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
      for (const c of list) { if ("focus" in c) return c.focus(); }
      if (clients.openWindow) return clients.openWindow("./");
    })
  );
});

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(clients.claim()));
