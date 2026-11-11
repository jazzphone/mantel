// settings/proxy.js -- Mantel Settings, HTTPS and Your Proxy, and Home Assistant's frame.
// @ts-check
import { mantelUrl, base as BASE } from '../base.js';
import { act, api, ask, fmt, K, load, me, redraw, ROUTE, shown } from './core.js';
import { button, copyButton, draft, failed, group, info, pending, result, secretCell } from './kit.js';
import { allowFrame, framedBy, HAD, loadHad, origin } from './ha-screens.js';

// HTTPS and the reverse proxy (proxy_check.py): Owner and Admin read; Owner runs the test, rotates the key
export function pProxy() {
  return { title: 'HTTPS and Your Proxy', back: ['Connections', '#/' + ROUTE + '/connections'], body(c) {
    result(c, 'proxy');
    const got = load('proxy', () => api('GET', '/api/admin/proxy-check/summary'));
    if (!got) { pending(c); return; }
    if (got.err) { failed(c, got.err); return; }
    const s = got.data, owner = me.user.role === 'owner';
    const rows = [info('Mode', s.mode_detail, s.mode_label), info('HTTPS on This Request', s.public_url ? 'Configured address ' + s.public_url : null, s.https_seen ? 'Yes' : 'No'),
      info('Trusted Proxies', null, s.trusted_proxies.length ? s.trusted_proxies.join(', ') : 'None')];
    if (s.door_key.required) rows.push(info('Door Key', s.door_key.header + (s.door_key.since ? ' · since ' + fmt(s.door_key.since) : ''), s.door_key.set ? 'Set' : 'Not Set', s.door_key.set ? '' :
      'warn'));
    c.appendChild(group({ footer: s.door_key.required ? 'Your proxy must send this installation’s door key with the door header. The key is shown once after a change, and in Test My Proxy.' :
      'No door key is needed in this mode.' }, rows));
    drawFrames(c, s);
    const nk = shown.doorKey;
    if (nk) c.appendChild(group({ header: 'New Door Key', footer: 'Shown once: paste it into your proxy.' },
      [secretCell(nk, 'proxy-newkey-value'), copyButton(nk), button('Done', () => { delete shown.doorKey; redraw(); })]));
    const acts = [];
    if (owner) acts.push(button('Test My Proxy', async () => {
      shown.proxy = { running: true }; redraw();
      try { const mod = await import(mantelUrl('/proxy-check/check.js')); shown.proxy = await mod.runProxyCheck(BASE); }
      catch (e) { shown.proxy = { error: e && e.message ? e.message : String(e) }; }
      redraw();
    }, { fk: 'mx:proxy-check' }));
    if (s.door_key.required && s.can_rotate) acts.push(button('Rotate Door Key…', async () => {
      if (!(await ask({ title: 'Rotate the door key?', message: 'Your proxy must then send the new key; until you paste it in, its requests are treated as coming from the internet.', ok: 'Rotate',
        destructive: true }))) return;
      const r = await act('proxy', () => api('POST', '/api/admin/proxy-check/door-key'), 'Door key rotated.', 'proxy');
      if (r) { shown.doorKey = r.door_key.value; redraw(); }
    }, { destructive: true, fk: 'mx:door-key-rotate' }));
    acts.push(K().nav({ label: 'Open the Full Check', href: mantelUrl('/proxy-check'), fk: 'mx:proxy-page' }));
    c.appendChild(group({ footer: owner ? 'The test checks HTTPS, the trusted proxy, the door header, HSTS, the security policy and WebSockets from this browser, and says what to change.' :
      'Only an Owner can run the test.' }, acts));
    const res = shown.proxy;
    if (res && res.running) pending(c, 'Checking…');
    else if (res && res.error) failed(c, 'The check failed: ' + res.error);
    else if (res && res.checks) {
      const bad = res.checks.filter((x) => x.ok === false).length;
      c.appendChild(group({ header: bad ? bad + ' to Fix' : 'Your Proxy Looks Right' }, res.checks.map((x) =>
        info(x.title, [x.detail, x.fix].filter(Boolean).join(' '), x.ok === true ? 'OK' : x.ok === false ? 'Fix' : 'Note', x.ok === false ? 'warn' : ''))));
      const pastes = res.checks.filter((x) => x.paste);
      for (const x of pastes) c.appendChild(group({ header: x.title }, [secretCell(x.paste), copyButton(x.paste)]));
    }
  } };
}

// HOME ASSISTANT'S FRAME (security_headers.py frame-ancestors): a Webpage dashboard shows Mantel only from an HA address
// listed there (the Sign-In Address, HA's own, the ones allowed here); the browser refuses any other, so each address HA is opened at
// must be listed. HA sends no Referer, so Mantel can't see a refused one: HA's own addresses, this page's frame and
// an address typed here are checked instead.
function drawFrames(c, s) {
  const got = loadHad();
  if (!got || got.err || got.data.state === 'direct_access_off') return;
  const owner = me.user.role === 'owner', key = 'frames';
  const plain = (o) => o.replace(/^https?:\/\//, '');
  const listed = s.frame_origins || (s.frame_ancestors || []).map((o) => ({ origin: o, source: 'option' }));
  const allowed = listed.map((x) => origin(x.origin)).filter(Boolean);
  const okAt = (o) => allowed.includes(o);
  const SOURCE = { option: 'From the start-up options', sign_in: 'The Sign-In Address (Connections → Home Assistant)', home_assistant: 'Home Assistant’s own address (Settings → System → Network)',
    approved: 'Allowed here' };
  const rows = listed.length ? listed.map((x) => info(plain(x.origin), SOURCE[x.source] || x.source, x.source === 'approved' ? 'Allowed' : 'Automatic'))
    : [info('Allowed to Show Mantel', null, 'None', 'warn')];
  const seen = new Set(allowed);
  const offer = (label, o, sub) => {               // an address HA is (or may be) opened at that is not allowed yet
    if (!o || seen.has(o)) return;
    seen.add(o);
    rows.push(owner ? button('Allow ' + plain(o) + (sub ? ' (' + sub + ')' : ''), () => allowFrame(key, o), { fk: 'mx:frames:allow:' + o })
                    : info(label, plain(o) + (sub ? ' · ' + sub : ''), 'Not Allowed', 'warn'));
  };
  for (const a of got.data.ha_addresses || []) offer(a.kind === 'internal' ? 'Home Assistant at Home' : 'Home Assistant Away', origin(a.url), 'its ' + a.kind + ' URL');
  offer('This Page', framedBy(), 'Home Assistant is open here now');
  c.appendChild(group({ header: 'Home Assistant’s Frame', footer: 'A screen in Home Assistant’s sidebar shows only when Home Assistant is opened at one of ' +
    'these addresses; at any other the browser shows a blank page. Home Assistant’s own internal and external URL are allowed by themselves.' +
    (owner ? ' Allow every other address you open Home Assistant at.' : ' An Owner allows others.') }, rows));
  const approved = listed.filter((x) => x.source === 'approved');
  if (owner) {
    const typed = draft('frames').addr || '';
    c.appendChild(group({ footer: 'Like https://homeassistant.example.com or http://homeassistant.local:8123: the address in the browser when Home Assistant is open, without the page after it.' }, [
      K().text({ label: 'Allow an Address', value: typed, placeholder: 'https://homeassistant.example.com', maxlength: 300, inputmode: 'url',
                 fk: 'mx:frames:addr', onCommit: (v) => { draft('frames').addr = v.trim(); redraw(); } }),
      button('Allow', async () => {
        const v = (draft('frames').addr || '').trim();
        if (!v) return;
        if (await allowFrame(key, /^https?:\/\//i.test(v) ? v : 'https://' + v)) { draft('frames').addr = ''; redraw(); }
      }, { fk: 'mx:frames:add' }),
      ...approved.map((x) => button('Remove ' + plain(x.origin) + '…', async () => {
        if (!(await ask({ title: 'Remove ' + plain(x.origin) + '?', message: 'Home Assistant opened at this address shows a blank page instead of Mantel.', ok: 'Remove', destructive: true }))) return;
        act(key, () => api('DELETE', '/api/admin/frame-origins?origin=' + encodeURIComponent(x.origin)), 'Removed.', HAD, 'proxy');
      }, { destructive: true, fk: 'mx:frames:remove:' + x.origin }))]));
  }
  result(c, key);
}
