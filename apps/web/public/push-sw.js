self.addEventListener('push', event => {
  event.waitUntil((async () => {
    if (!event.data) return;
    const payload = event.data.json();
    // A subscription can remain on a shared device after sign-out. Check the current session.
    const response = await fetch('/api/auth/me', { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) return;
    const { data: user } = await response.json();
    if (user.id !== payload.userId) return;
    await self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/favicon.png',
      tag: payload.id,
      data: { url: `/#/${user.role}/notifications` },
    });
  })().catch(() => {}));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const url = new URL(event.notification.data?.url || '/#/', self.location.origin).href;
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const active = windows.find(client => new URL(client.url).origin === self.location.origin);
    if (active) { await active.navigate(url); await active.focus(); }
    else await self.clients.openWindow(url);
  })());
});
