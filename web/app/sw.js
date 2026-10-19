// sw.js -- Mantel's service worker, for Web Push only (docs/phase10/APPLE-APPS.md slice 10.0).
//
// It has NO fetch handler on purpose: every page and API request goes to the network exactly as without it
// (Home Assistant's own service worker fetching Mantel's pages broke sign-in once; PLAN "the 0.1.7 Save bug").
// It shows the notifications the house pushes (push.py: title, body, tag, url, important) and opens Mantel
// where the notification points when it is tapped. The payload was encrypted to this browser (RFC 8291); the
// browser has already decrypted it by the time `push` fires.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

function sameOrigin(url) {
  try {
    const u = new URL(url || '/home', self.location.origin);
    return u.origin === self.location.origin ? u.pathname + u.search + u.hash : '/home';
  } catch (e) {
    return '/home';
  }
}

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { body: event.data ? event.data.text() : '' }; }
  const title = typeof data.title === 'string' && data.title ? data.title : 'Mantel';
  const options = {
    body: typeof data.body === 'string' ? data.body : '',
    tag: typeof data.tag === 'string' && data.tag ? data.tag : undefined,
    renotify: !!data.tag,
    requireInteraction: !!data.important,
    icon: '/app/icons/mantel-192.png',
    badge: '/app/icons/badge-96.png',
    data: { url: sameOrigin(data.url) },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = sameOrigin(event.notification.data && event.notification.data.url);
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if (new URL(w.url).origin === self.location.origin && 'focus' in w) {
        await w.focus();
        if ('navigate' in w) { try { await w.navigate(url); } catch (e) { /* a page we may not steer */ } }
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});
