// settings/connect.js -- Mantel Settings, Mantel Connect: the pairing code that puts Mantel in Home Assistant's sidebar.
// @ts-check
import { act, ago, api, ask, fmt, forget, load, me, nowS, panel, redraw, shown, ui } from './core.js';
import { button, copyButton, draft, failed, field, group, info, pending, result, secretCell } from './kit.js';
import { HA_PAGE } from './link.js';

// ============================================================================================ Mantel Connect
let pairTimer = null;
export function pConnect() {
  return { title: 'Sidebar (Mantel Connect)', back: HA_PAGE,
    scope:
    'Puts Mantel in Home Assistant’s sidebar and the Companion app when Mantel runs outside Home Assistant, through the Mantel Connect App. Home Assistant signs people in;' +
    ' their Mantel roles still decide what they see. Managed on the home network only.', body(c) {
    result(c, 'connect');
    const code = shown.pair;
    if (code) {
      const left = code.expires - nowS();
      c.appendChild(group({ header: 'Pairing Code', footer: 'Valid once, for ' + (left > 0 ? Math.ceil(left / 60) + ' min' : 'no longer: it expired') +
        '. In Home Assistant open Settings, Apps, Mantel Connect, Configuration. Enter this Mantel address and the code, press Save, then Restart the App.' },
        [secretCell(code.code, 'pairing-code'), secretCell(code.address, 'pairing-address'), copyButton(code.code, 'Copy Code'),
         button('Withdraw This Code', async () => { await act('connect', () => api('DELETE', '/api/connect/pair')); delete shown.pair; redraw(); }, { destructive: true, fk: 'mx:dismiss-code' })]));
    } else {
      c.appendChild(group({ header: 'Pair the Mantel Connect App', footer: 'The address Home Assistant should use to reach Mantel. You get a one-time code that works for ten minutes.' }, [
        field('pair', 'address', 'Address', { value: `${location.hostname}:${me.connect_port}`, maxlength: 100 }),
        button('Start Pairing', async () => {
          const r = await act('connect', () => api('POST', '/api/connect/pair', {}));
          if (!r) return;
          shown.pair = { ...r, address: (draft('pair').address || '').trim() };
          watchPairing(r);
          redraw();
        }, { fk: 'mx:start-pairing' })]));
    }
    const got = load('connect', () => api('GET', '/api/connect'));
    if (!got) { pending(c); return; }
    if (got.err) { failed(c, got.err); return; }
    const live = got.data.pairings.filter((p) => !p.revoked), gone = got.data.pairings.filter((p) => p.revoked);
    const row = (p) => info(p.name, `Paired ${fmt(p.created)} · last seen ${ago(p.last_seen)}${p.last_ip ? ' from ' + p.last_ip : ''} · certificate until ${fmt(p.cert_expires)}`, p.revoked ?
      'Revoked' : undefined, p.revoked ? 'warn' : '');
    c.appendChild(group({ header: 'Paired Apps' }, live.length ? live.map(row) : [info('Nothing is paired yet')]));
    if (live.length) c.appendChild(group({}, live.map((p) => button('Revoke ' + p.name + '…', async () => {
      if (
        !(
        await ask({ title: 'Revoke ' + p.name + '?', message: 'The Mantel Connect App is cut off at once and its open connections are closed. To use Mantel in Home Assistant again you pair it anew.',
        ok: 'Revoke', destructive: true }))) return;
      act('connect', () => api('DELETE', '/api/connect/pairings/' + encodeURIComponent(p.id)), 'Connection revoked.', 'connect');
    }, { destructive: true, fk: 'mx:revoke-connect:' + p.id }))));
    if (gone.length) c.appendChild(group({ header: 'Revoked', footer: 'They leave this list after 30 days; the Audit Log keeps them.' }, gone.map(row).concat([
      button('Clear List', () => act('connect', () => api('DELETE', '/api/connect/pairings/revoked'), 'Cleared.', 'connect'), { fk: 'mx:connect-clear' })])));
  } };
}
// while a code is shown, notice when it is spent (paired) or has expired
// the code's state every 4 s, drawn only when something shows a change: the code spent or gone, or its minutes
// left (a background redraw, so a field being typed in keeps its text). A few failed polls in a row stop it
// (Mantel restarting, the session gone): the page says what it knows when it is drawn next.
const PAIR_FAILS_MAX = 3;
function watchPairing(r) {
  clearInterval(pairTimer);
  let fails = 0, minutes = null;
  pairTimer = setInterval(async () => {
    if (!shown.pair) { clearInterval(pairTimer); return; }
    try {
      const got = await api('GET', '/api/connect');
      fails = 0;
      if (!got.pending) {
        clearInterval(pairTimer);
        const paired = got.pairings.some((p) => !p.revoked && p.created >= r.expires - got.ttl - 1);
        delete shown.pair;
        ui.flash = { key: 'connect', text: paired ? 'Paired. The code is spent.' : 'The code expired or was withdrawn.', err: !paired };
        forget('connect');
        redraw();
        return;
      }
      const left = Math.ceil((shown.pair.expires - nowS()) / 60);
      if (minutes !== null && left !== minutes && panel) panel.render(true);
      minutes = left;
    } catch (e) {
      if (++fails >= PAIR_FAILS_MAX) clearInterval(pairTimer);
    }
  }, 4000);
}
