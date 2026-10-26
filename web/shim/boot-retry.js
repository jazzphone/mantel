// boot-retry.js -- a page whose start failed starts again (web/home.js, shim/settings-page.js).
//
// ONE failed request at the start (a 503 while Mantel restarts, a socket dropped as it opened, a tablet that
// woke before its Wi-Fi did) left the page blank for good, a wall tablet too: it starts again from the top, a
// little later each time (2 s ... 30 s, as the hub's own reconnect), counted per page in sessionStorage. A
// session that ended meanwhile is sent to sign in by the reload.

// the start failed: wait, then reload. `shown(ms)`, when given, tells the person how long. Never resolves.
export async function startAgain(key, e, shown) {
  let n = 0;
  try { n = Number(sessionStorage.getItem(key) || 0); sessionStorage.setItem(key, String(n + 1)); } catch (_) { /* no storage */ }
  const wait = Math.min(2000 * 2 ** n, 30000);
  console.warn('[mantel] the page could not start (' + (e && e.message) + '); again in ' + Math.round(wait / 1000) + ' s');
  if (shown) { try { shown(wait); } catch (_) { /* the reload comes anyway */ } }
  await new Promise((r) => setTimeout(r, wait));
  location.reload();
  await new Promise(() => {});                    // this start goes no further
}

// the start went through: the next failure waits 2 s again
export function started(key) {
  try { sessionStorage.removeItem(key); } catch (_) { /* no storage */ }
}
