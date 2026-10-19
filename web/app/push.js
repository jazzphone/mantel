// push.js -- turn this browser's notifications on or off (Web Push, docs/phase10/APPLE-APPS.md slice 10.0).
//
// Used by Mantel Settings → Me → Notifications. On an iPhone or iPad this works only in the web app added to the
// Home Screen (iOS 16.4+), which is what `supported()` says; in Safari's tab it explains that instead. The
// subscription goes to POST /api/push/web/subscribe (push.py), which accepts only the known push services.
// Not in Home Assistant's sidebar (Ingress): there the page is Home Assistant's, and so would the worker be.

export function supported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && window.isSecureContext;
}

export function standalone() {
  return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
}

export function appleMobile() {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function keyBytes(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function registration() {
  return (await navigator.serviceWorker.getRegistration('/')) || navigator.serviceWorker.register('/sw.js', { scope: '/' });
}

export async function current() {
  if (!supported()) return null;
  const reg = await navigator.serviceWorker.getRegistration('/');
  return reg ? reg.pushManager.getSubscription() : null;
}

// api(method, path, body) is the settings page's own (CSRF and errors handled there)
export async function enable(api, name) {
  if (!supported()) throw new Error(appleMobile() && !standalone()
    ? 'Add Mantel to your Home Screen first (Share → Add to Home Screen), then turn notifications on there.'
    : 'This browser cannot receive notifications.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notifications are not allowed for Mantel in this browser’s settings.');
  const { key } = await api('GET', '/api/push/web/key');
  const reg = await registration();
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
  await api('POST', '/api/push/web/subscribe', { subscription: sub.toJSON(), name });
  return sub;
}

export async function disable(api) {
  const sub = await current();
  if (!sub) return;
  try { await api('POST', '/api/push/web/unsubscribe', { endpoint: sub.endpoint }); } finally { await sub.unsubscribe(); }
}
