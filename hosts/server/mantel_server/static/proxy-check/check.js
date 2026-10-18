// "Test my proxy" (proxy_check.py). runProxyCheck(base) -> { checks, report }: the server's view of a
// request (sent with a probe X-Mantel-Door the proxy must overwrite) plus what only the browser can see:
// the page is https, HSTS and CSP arrived exactly once, and the WebSocket upgrade passes with the same
// door. Exported so the admin page's Connections section can embed it; drawn into #results when this
// module is the page's own.
const API = '/api/admin/proxy-check';

function wsUrl(base, path) {
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${base}${path}`;
}

function socketCheck(base, timeoutMs = 6000) {
  return new Promise((resolve) => {
    let done = false;
    let ws;
    const finish = (v) => { if (!done) { done = true; try { ws && ws.close(); } catch (e) { /* closed */ } resolve(v); } };
    try { ws = new WebSocket(wsUrl(base, API + '/ws')); } catch (e) { finish({ ok: false, error: String(e) }); return; }
    const t = setTimeout(() => finish({ ok: false, error: 'no answer in time' }), timeoutMs);
    ws.onmessage = (ev) => {
      clearTimeout(t);
      try { finish(Object.assign({ ok: true }, JSON.parse(ev.data))); } catch (e) { finish({ ok: false, error: 'bad answer' }); }
    };
    ws.onerror = () => { clearTimeout(t); finish({ ok: false, error: 'the upgrade failed' }); };
    ws.onclose = () => { clearTimeout(t); finish({ ok: false, error: 'closed before answering' }); };
  });
}

export async function runProxyCheck(base = '') {
  const r = await fetch(base + API, { headers: { 'X-Mantel-Door': 'mantel-proxy-check-probe' }, credentials: 'same-origin' });
  if (r.status === 401) {
    // signed out ON THIS DOOR: a session is good only on the door it was made on. Say which door
    // Mantel sees (the usual cause: the proxy sends no X-Mantel-Door, so the LAN looks like the tunnel)
    const b = await fetch(base + '/api/proxy-check/basics', { headers: { 'X-Mantel-Door': 'mantel-proxy-check-probe' } }).then((x) => x.json());
    const checks = [];
    if (b.probe_passed) {
      checks.push({ id: 'door_overwrite', ok: false, title: 'Your proxy passes the browser\'s door header through',
        detail: 'This page sent X-Mantel-Door itself and it reached Mantel unchanged: anyone could claim the LAN door from outside.',
        fix: 'Make the proxy SET the header (overwrite): in Nginx Proxy Manager paste the block below into the Advanced tab; in Traefik use a headers middleware.',
        paste: b.npm_advanced });
    }
    checks.push({ id: 'door_header', ok: b.door === 'lan' ? null : false,
      title: `Signed out on the ${b.door} door`,
      detail: `Mantel sees this browser on the ${b.door} door${b.via_trusted_proxy ? ', through your trusted proxy' : ', NOT through your trusted proxy'}${b.via_trusted_proxy && b.door_header === false ? ', which sent no X-Mantel-Door' : ''}. A session works only on the door it was started on.`,
      fix: b.door === 'lan' ? 'Sign in again, then reopen this page.'
        : 'If this browser is on your LAN, your proxy must send X-Mantel-Door: lan (paste the block below into the proxy host\'s Advanced tab in Nginx Proxy Manager) and MANTEL_TRUSTED_PROXY must be its address. If you are remote, sign in (with your second factor) and reopen this page.',
      paste: b.door === 'lan' ? '' : b.npm_advanced });
    return { checks, report: { peer: '?', client: '?', door: b.door, https: b.https, trusted: [] } };
  }
  if (!r.ok) throw new Error(`the check answered HTTP ${r.status}`);
  const report = await r.json();
  const checks = report.checks.slice();
  const https = location.protocol === 'https:';
  const csp = r.headers.get('content-security-policy') || '';
  const hsts = r.headers.get('strict-transport-security') || '';
  if (!csp) {
    checks.push({ id: 'csp', ok: false, title: 'No Content-Security-Policy arrived',
      detail: 'Mantel sends one on every answer; something between here and Mantel removed it.',
      fix: 'Remove any "hide header" / header-stripping rule for Content-Security-Policy in your proxy.' });
  } else if ((csp.match(/default-src/g) || []).length > 1) {
    checks.push({ id: 'csp', ok: false, title: 'Two Content-Security-Policy headers',
      detail: 'Your proxy adds its own policy next to Mantel\'s. Browsers enforce both, which breaks Music Assistant\'s frame.',
      fix: 'Remove the proxy\'s Content-Security-Policy (Mantel sets its own; NPM: the Advanced block must not add_header one).' });
  } else {
    checks.push({ id: 'csp', ok: true, title: 'Content-Security-Policy arrived', detail: 'Mantel\'s policy reached the browser once.' });
  }
  if (https) {
    checks.push(hsts
      ? { id: 'hsts', ok: true, title: 'HSTS arrived', detail: hsts }
      : { id: 'hsts', ok: false, title: 'No HSTS',
          detail: 'Mantel sends Strict-Transport-Security when it knows the browser is on HTTPS. It did not, so the proxy is not telling Mantel (X-Forwarded-Proto) or strips the header.',
          fix: 'Make the proxy send X-Forwarded-Proto $scheme and make sure Mantel trusts it (MANTEL_TRUSTED_PROXY).' });
  }
  const sock = await socketCheck(base);
  if (!sock.ok) {
    checks.push({ id: 'websocket', ok: false, title: 'WebSocket upgrade failed',
      detail: `The live connection every screen uses could not be opened (${sock.error}).`,
      fix: 'Nginx Proxy Manager: edit the proxy host, Details tab, turn on "Websockets Support" (the Advanced block below sets Upgrade/Connection too). Traefik and Caddy pass WebSockets on their own.',
      paste: report.npm_advanced });
  } else if (sock.door !== report.door) {
    checks.push({ id: 'websocket', ok: false, title: 'The socket arrives by another door',
      detail: `Pages arrive as "${report.door}" but the WebSocket as "${sock.door}": the proxy treats upgrades differently (a custom location without the header?).`,
      fix: 'Put the X-Mantel-Door header in the one location that serves both (the Advanced block below).',
      paste: report.npm_advanced });
  } else {
    checks.push({ id: 'websocket', ok: true, title: 'WebSocket upgrade works', detail: `Same door (${sock.door}).` });
  }
  return { checks, report };
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function csrf() {
  const m = document.cookie.match(/(?:^|; )mantel_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

// THE DOOR KEY (door_key.py): with your own proxy, the door counts only with this installation's key.
// Owner only (the report carries it only for an Owner); rotating means pasting the new key into the proxy.
function doorKeyBox(dk) {
  const wrap = el('div', 'doorkey');
  wrap.appendChild(el('strong', null, 'Door key for your proxy'));
  wrap.appendChild(el('p', null, `Your proxy sends it as ${dk.header} with the door (the blocks above include it). Keep it private.`));
  const pre = el('pre', 'paste', `proxy_set_header ${dk.header} ${dk.value};`);
  wrap.appendChild(pre);
  const copy = el('button', null, 'Copy');
  copy.type = 'button';
  copy.addEventListener('click', () => navigator.clipboard && navigator.clipboard.writeText(dk.value));
  const rot = el('button', null, 'Make a new key');
  rot.type = 'button';
  rot.addEventListener('click', async () => {
    if (!window.confirm('Make a new door key? Your proxy keeps the LAN door only after you paste the new key into it.')) return;
    const base = (document.querySelector('meta[name="mantel-base"]') || {}).content || '';
    const res = await fetch(base + '/api/admin/proxy-check/door-key', { method: 'POST', credentials: 'same-origin',
      headers: { 'X-CSRF-Token': csrf() } });
    const got = await res.json().catch(() => ({}));
    if (res.ok && got.door_key) pre.textContent = `proxy_set_header ${got.door_key.header} ${got.door_key.value};`;
    else pre.textContent = 'Not changed: ' + (got.error || res.status);
  });
  wrap.appendChild(copy);
  wrap.appendChild(rot);
  return wrap;
}

export function render(box, result) {
  box.textContent = '';
  const bad = result.checks.filter((c) => c.ok === false).length;
  box.appendChild(el('p', bad ? 'summary bad' : 'summary good',
    bad ? `${bad} thing${bad > 1 ? 's' : ''} to fix.` : 'Your proxy looks right.'));
  const list = el('ul', 'checks');
  for (const c of result.checks) {
    const li = el('li', c.ok === true ? 'ok' : c.ok === false ? 'fail' : 'info');
    li.appendChild(el('strong', null, (c.ok === true ? 'OK  ' : c.ok === false ? 'FIX  ' : 'NOTE  ') + c.title));
    li.appendChild(el('p', null, c.detail));
    if (c.fix) li.appendChild(el('p', 'fix', c.fix));
    if (c.paste) {
      const pre = el('pre', 'paste', c.paste);
      const btn = el('button', null, 'Copy');
      btn.type = 'button';
      btn.addEventListener('click', () => navigator.clipboard && navigator.clipboard.writeText(c.paste));
      li.appendChild(pre);
      li.appendChild(btn);
    }
    list.appendChild(li);
  }
  box.appendChild(list);
  const r = result.report;
  if (r.door_key && r.door_key.value) box.appendChild(doorKeyBox(r.door_key));
  box.appendChild(el('p', 'note', `Seen by Mantel: from ${r.peer}, client ${r.client}, door ${r.door}, ${r.https ? 'https' : 'http'}; trusted proxy ${r.trusted.join(', ') || 'none'}.`));
}

const box = typeof document !== 'undefined' && document.getElementById('results');
if (box) {
  const meta = document.querySelector('meta[name="mantel-base"]');
  const base = meta && /^\/api\/hassio_ingress\/[A-Za-z0-9_-]{1,128}$/.test(meta.content || '') ? meta.content : '';
  runProxyCheck(base).then((res) => render(box, res), (e) => { box.textContent = 'The check failed: ' + e.message; });
}
