// Mantel admin page: why does it say "The page lost its session token"? Read-only; prints no secret.
// Paste into the browser console on the Home Assistant page that shows Mantel (the sidebar panel).
(async () => {
  const find = (root) => { for (const e of root.querySelectorAll('*')) { if (e.localName === 'iframe' && /hassio_ingress/.test(e.src)) return e; if (e.shadowRoot) { const f = find(e.shadowRoot); if (f) return f; } } return null; };
  const fr = find(document);
  const w = fr ? fr.contentWindow : window;
  const base = (fr ? fr.src : location.href).replace(/^https?:\/\/[^/]+/, '').match(/^\/api\/hassio_ingress\/[^/]+/);
  if (!base) return console.log('Open Mantel in the sidebar first.');
  const vals = (w.document.cookie.match(/(?:^|;\s*)mantel_csrf=[^;]*/g) || []).map(s => decodeURIComponent(s.split('=')[1]));
  const ov = await w.fetch(base[0] + '/api/admin/overview', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
  const j = await ov.json().catch(() => null);
  const t = await w.fetch(base[0] + '/api/connections/ma/test', { method: 'POST', credentials: 'same-origin',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-CSRF-Token': (j && j.csrf) || '' }, body: '{}' });
  const tb = await t.json().catch(() => null);
  console.log(JSON.stringify({
    frame: !!fr, frameAt: w.location.pathname.replace(/hassio_ingress\/[^/]+/, 'hassio_ingress/…'),
    csrfCookies: vals.length, cookieNames: w.document.cookie.split(';').map(c => c.trim().split('=')[0]),
    overview: ov.status, serverGaveToken: !!(j && j.csrf),
    firstCookieMatchesServer: !!(j && j.csrf) && vals[0] === j.csrf, anyCookieMatches: !!(j && j.csrf) && vals.includes(j.csrf),
    testWithServerToken: t.status, testAnswer: tb && (tb.error || (tb.ok && 'ok')),
  }, null, 1));
})();
