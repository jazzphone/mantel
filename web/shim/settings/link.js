// settings/link.js -- Mantel Settings, Mantel Link and HK Frontend in Home Assistant, and moving from one to the other.
import { act, api, ask, can, fmt, forget, K, load, me, nowS, redraw, ROUTE, shown, ui } from './core.js';
import { button, copyButton, failed, group, info, nav, pending, result, secretCell } from './kit.js';
import { drawImport } from './connections.js';

// MANTEL IN HOME ASSISTANT (docs/phase9/MANTEL-LINK.md; decision 29, docs/phase9/TWO-PRODUCTS.md): the two
// integrations Home Assistant can have for Mantel, by product -- Mantel Link (Mantel's own) and HK Frontend (HK in
// Home Assistant, a product of its own that can run beside it) -- each its own page under Home Assistant's. Who runs
// each wall tablet, the bridge (who shows Mantel's entities) and The House are Moving from HK Frontend: they change
// only while a house moves between the two. GET/PUT /api/linked/owners and /api/linked/ha-saves; the server says in
// words what can't be done.
export const LINK_NAME = { mantel: 'Mantel Link', hk_frontend: 'HK Frontend' };
export const HA_PAGE = ['Home Assistant', '#/' + ROUTE + '/connections/ha'];
function linkSays(l) {
  const bits = [l.since ? 'Linked since ' + fmt(l.since) : null,
                l.domain === 'hk_frontend' && !(l.features || []).includes('bridge') ? 'update it' : null];
  return bits.filter(Boolean).join(' · ') || null;
}
export function linkState() {
  const got = load('link', () => api('GET', '/api/linked/owners'));
  if (!got || got.err) return got;
  const d = got.data, links = d.links || [];
  const ml = links.filter((l) => l.domain === 'mantel'), hk = links.filter((l) => l.domain === 'hk_frontend');
  const hkThere = hk.length > 0 || ml.some((l) => ((l.report || {}).hk_frontend || {}).installed);
  return { data: { ...d, ml, hk, hkThere, owner: me.user.role === 'owner' } };
}
export function pMantelLink() {
  return { title: 'Mantel Link', back: HA_PAGE, scope: 'Mantel’s own integration in Home Assistant: the wall tablets and the house as entities, Mantel’s actions for automations, its screens in the sidebar, and notifications on phones.', body(c) {
    result(c, 'link');
    const got = linkState();
    if (!got) { pending(c); return; }
    if (got.err) { failed(c, got.err); return; }
    const d = got.data, owner = d.owner;
    c.appendChild(group({ footer: d.ml.length ? null : 'Not in Home Assistant yet. In Home Assistant: Settings, Devices & Services. Open Mantel under Discovered, or Add Integration, Mantel Link. It asks for a pairing code, made below.' },
      d.ml.length ? d.ml.map((l) => info('Status', linkSays(l), 'Connected')) : [info('Status', null, 'Not Linked', 'warn')]));
    if (owner) drawLinkPairing(c);
    else if (!d.ml.length) c.appendChild(group({ footer: 'Only an Owner can make a pairing code.' }, []));
  } };
}
// HK FRONTEND: linked or not, its credential (a Service account made here, shown once, pasted into HK Frontend's
// Configure), whose settings its dashboards draw with, and whether a change made on them is saved
export function pHkFrontend() {
  return { title: 'HK Frontend', back: HA_PAGE, scope: 'HK inside Home Assistant. Linked, its dashboards draw with Mantel’s settings and its features’ actions run in Mantel.', body(c) {
    result(c, 'hkf');
    const got = linkState();
    if (!got) { pending(c); return; }
    if (got.err) { failed(c, got.err); return; }
    const d = got.data;
    const t = shown.hkCred;
    if (t) {
      c.appendChild(group({ header: 'Its Credential', footer: 'Shown this once. In Home Assistant: Settings, Devices & Services, HK Frontend, Configure, Linked to Mantel Server: this Mantel’s address and this credential. Mantel keeps only a hash.' },
        [secretCell(t.token, 'hkf-token'), copyButton(t.token), button('Done', () => { delete shown.hkCred; forget('link', 'service'); redraw(); }, { fk: 'mx:hkf-done' })]));
    }
    drawHkFrontend(c, d);
    if (!d.owner || !can('service')) return;
    const linked = d.hk[0];
    if (!linked && !t) {
      c.appendChild(group({ footer: 'You get a credential for HK Frontend, shown once, to paste into its Configure in Home Assistant. On the home network only.' }, [
        button('Link HK Frontend…', async () => {
          const r = await act('hkf', () => api('POST', '/api/service-accounts', { name: 'HK Frontend', scopes: ['linked', 'linked_saves'] }), null, 'service');
          if (r && r !== true) { shown.hkCred = r; redraw(); }
        }, { fk: 'mx:hkf-link' })]));
    } else if (linked && linked.account_id) {
      c.appendChild(group({ footer: 'Its credential stops working at once. To link it again, make a new one here.' }, [
        button('Unlink HK Frontend…', async () => {
          if (!(await ask({ title: 'Unlink HK Frontend?', message: 'Its credential is revoked and its dashboards in Home Assistant go back to its own settings.', ok: 'Unlink', destructive: true }))) return;
          act('hkf', () => api('DELETE', '/api/service-accounts/' + encodeURIComponent(linked.account_id)), 'HK Frontend is unlinked.', 'link', 'service');
          setTimeout(() => { forget('link'); redraw(); }, 3000);
        }, { destructive: true, fk: 'mx:hkf-unlink' })]));
    }
  } };
}
// MOVING FROM HK FRONTEND: who runs each wall tablet, HK's settings imported once, and the bridge (Advanced)
export function pMoving() {
  return { title: 'Moving from HK Frontend', back: HA_PAGE, scope: 'While a house moves from HK Frontend to Mantel: who runs each wall tablet and the house, and HK’s settings copied once. Each change is in the Audit Log.', body(c) {
    result(c, 'link');
    result(c, 'connections');
    const got = linkState();
    if (!got) { pending(c); return; }
    if (got.err) { failed(c, got.err); return; }
    const d = got.data, owner = d.owner;
    const tabs = (d.tablets || []).filter(Boolean);
    if (tabs.length) c.appendChild(group({ header: 'Wall Tablets', footer: 'Each tablet has one engine. Mantel runs a tablet on Mantel’s screens: its Sleep Screen and black screen. Off, HK Frontend runs it, for a tablet showing HK Frontend’s dashboards in Home Assistant. Home Assistant’s scripts reach it by the same entity ids either way.' + (owner ? '' : ' Only an Owner can change it.') },
      tabs.map((u) => ownerRow(u, u.name || u.unit, owner))));
    const conns = load('connections', () => api('GET', '/api/connections'));
    drawImport(c, !!(conns && conns.data && conns.data.connections.ha && conns.data.connections.ha.state === 'set'));
    c.appendChild(group({ footer: 'Which integration shows Mantel’s entities, and who runs the house’s Seasonal Decorations, Alarm PIN keypad and Live TV.' },
      [nav('Advanced', 'connections/ha/moving/advanced', { icon: 'mdi:tune-variant' })]));
  } };
}
const ownerRow = (u, label, owner) => {
  const mine = u.owner === 'mantel';
  if (!owner) return info(label, null, mine ? 'Mantel' : 'HK Frontend');
  return K().toggle({ label, sub: (mine ? 'Run by Mantel' : 'Run by HK Frontend') + (u.changed ? ' · since ' + fmt(u.changed) : ''), on: mine, fk: 'mx:owner:' + u.unit,
    onChange: (on) => act('link', () => api('PUT', '/api/linked/owners', { unit: u.unit, owner: on ? 'mantel' : 'ha' }),
                         label + (on ? ' is run by Mantel.' : ' is run by HK Frontend.'), 'link', 'hasaves') });
};
// HK FRONTEND, beside Mantel (linked_settings.py): linked or not, whose settings its dashboards draw with, and
// whether a change made on them is saved (the Service account's linked_saves: Changes from Home Assistant)
function drawHkFrontend(c, d) {
  const owner = d.owner, linked = d.hk.length > 0, mantelHouse = d.house && d.house.owner === 'mantel';
  const rows = [info('Status', linked ? linkSays(d.hk[0]) : null, linked ? 'Connected' : 'Not Linked', linked ? '' : 'warn')];
  let footer = linked ? null : 'In Home Assistant, not linked to Mantel yet: its dashboards draw with its own settings.';
  if (linked && mantelHouse) {
    rows.push(info('Its Settings', 'Its dashboards in Home Assistant draw with Mantel’s', 'Mantel’s'));
    const got = load('hasaves', () => api('GET', '/api/linked/ha-saves'));
    const saves = got && got.data ? !!got.data.saves : null;
    if (saves !== null) {
      rows.push(owner ? K().toggle({ label: 'Changes from Home Assistant', sub: saves ? 'Saved in Mantel, as the person' : 'Refused', on: saves, fk: 'mx:ha-saves',
                                     onChange: (on) => act('link', () => api('PUT', '/api/linked/ha-saves', { on }),
                                                           on ? 'Changes made in Home Assistant are saved.' : 'Changes made in Home Assistant are refused.', 'hasaves') })
                      : info('Changes from Home Assistant', null, saves ? 'Saved' : 'Refused'));
    }
    footer = 'A change made on HK Frontend’s dashboards (a favorite, a calendar’s color, an accessory) is saved in Mantel as the person linked to that Home Assistant user, checked by their role. People links each Home Assistant user to a person. Its features’ actions run in Mantel, and its items in Home Assistant point here.';
  } else if (linked) {
    rows.push(info('Its Settings', 'HK Frontend runs the house (Moving from HK Frontend), so it keeps its own', 'Its Own'));
  }
  c.appendChild(group({ footer }, rows));
}
export function pLinkAdvanced() {
  return { title: 'Advanced', back: ['Moving from HK Frontend', '#/' + ROUTE + '/connections/ha/moving'], scope: 'Only while moving a house between HK Frontend and Mantel. Each change is in the Audit Log.', body(c) {
    result(c, 'link');
    const got = linkState();
    if (!got) { pending(c); return; }
    if (got.err) { failed(c, got.err); return; }
    const d = got.data, owner = d.owner, b = d.bridge || {};
    const holder = b.holder || 'hk_frontend';
    // a Home Assistant without HK Frontend has no one else: Mantel Link shows them whoever holds the bridge
    const alone = holder !== 'mantel' && d.ml.length && !d.hkThere;
    const rows = [info('Shown By', alone ? 'Home Assistant has no HK Frontend' : b.changed ? 'since ' + fmt(b.changed) : null,
                       alone ? 'Mantel Link' : LINK_NAME[holder])];
    if (owner && holder !== 'mantel') rows.push(button('Hand the Bridge to Mantel Link…', async () => {
      if (!(await ask({ title: 'Hand the bridge to Mantel Link?', message: 'Mantel Link then shows Mantel’s wall tablets and the house in Home Assistant, under the same entity ids, with their history. HK Frontend lets go of them first. You can give it back.', ok: 'Hand Over' }))) return;
      await act('link', () => api('PUT', '/api/linked/owners', { unit: 'bridge', owner: 'mantel' }), 'Mantel Link holds the bridge.', 'link');
      setTimeout(() => { forget('link'); redraw(); }, 4000);   // the links reconnect after their reload
    }, { fk: 'mx:bridge-mantel' }));
    if (owner && holder === 'mantel' && d.hkThere) rows.push(button('Give the Bridge to HK Frontend…', async () => {
      if (!(await ask({ title: 'Give the bridge to HK Frontend?', message: 'HK Frontend then shows Mantel’s entities in Home Assistant, under the same entity ids. HK Frontend must be linked to Mantel, version 1.9.0 or newer.', ok: 'Give It', destructive: true }))) return;
      await act('link', () => api('PUT', '/api/linked/owners', { unit: 'bridge', owner: 'hk_frontend' }), 'HK Frontend holds the bridge.', 'link');
      setTimeout(() => { forget('link'); redraw(); }, 4000);
    }, { destructive: true, fk: 'mx:bridge-hk' }));
    c.appendChild(group({ header: 'The Bridge', footer: 'One integration in Home Assistant shows Mantel’s entities, never both: Mantel Link (recommended), or HK Frontend. They keep their entity ids either way.' + (owner ? '' : ' Only an Owner can change it.') }, rows));
    // TAKEN BY MANTEL when Home Assistant has no HK Frontend (linked_owners.take_house_alone): nothing to choose
    const houseAlone = d.house && d.house.owner === 'mantel' && d.house.changed_by === 'mantel:no_hk_frontend' && !d.hkThere;
    if (d.house) c.appendChild(group({ header: 'The House', footer: 'Seasonal Decorations, the Alarm PIN keypad and Live TV’s sensors and channels. Run by Mantel, they keep their entity ids and history in Home Assistant, and HK Frontend’s dashboards use Mantel’s settings; run by HK Frontend, it runs them and keeps its own settings. Without HK Frontend in Home Assistant, Mantel takes them by itself.' + (owner || houseAlone ? '' : ' Only an Owner can change it.') },
      [houseAlone ? info('The House', 'Home Assistant has no HK Frontend' + (d.house.changed ? ' · since ' + fmt(d.house.changed) : ''), 'Mantel')
             : ownerRow(d.house, 'The House', owner)]));
  } };
}

// PAIR MANTEL LINK (linked_pairing.py): a one-time code, ten minutes, typed into Mantel Link's setup in Home
// Assistant (by hand, or after it discovered Mantel); shown once, then only "spent" or "expired"
let linkPairTimer = null;
function drawLinkPairing(c) {
  const code = shown.linkPair;
  if (code) {
    const left = code.expires - nowS();
    c.appendChild(group({ header: 'Pairing Code', footer: 'Valid once, for ' + (left > 0 ? Math.ceil(left / 60) + ' min' : 'no longer: it expired') +
      '. In Home Assistant: Settings, Devices & Services. Open Mantel (Discovered), or Add Integration, Mantel Link with this Mantel’s address, and enter the code.' },
      [secretCell(code.code, 'link-pairing-code'), copyButton(code.code, 'Copy Code'),
       button('Withdraw This Code', async () => { await act('link', () => api('DELETE', '/api/linked/pair')); delete shown.linkPair; redraw(); }, { destructive: true, fk: 'mx:link-withdraw' })]));
    return;
  }
  c.appendChild(group({ header: 'Pair Mantel Link', footer: 'For Mantel Link in a Home Assistant that found Mantel on the network, or one you add by hand. You get a one-time code that works for ten minutes; Home Assistant trades it for its own credential.' }, [
    button('Make a Pairing Code', async () => {
      const r = await act('link', () => api('POST', '/api/linked/pair', {}));
      if (!r) return;
      shown.linkPair = r;
      watchLinkPairing(r);
      redraw();
    }, { fk: 'mx:link-pair' })]));
}
function watchLinkPairing(r) {
  clearInterval(linkPairTimer);
  linkPairTimer = setInterval(async () => {
    if (!shown.linkPair) { clearInterval(linkPairTimer); return; }
    try {
      const got = await api('GET', '/api/linked/pair');
      if (!got.pending) {
        clearInterval(linkPairTimer);
        const paired = (got.paired || []).some((p) => p.at >= r.expires - got.ttl - 1);
        delete shown.linkPair;
        ui.flash = { key: 'link', text: paired ? 'Mantel Link is paired. The code is spent.' : 'The code expired or was withdrawn.', err: !paired };
        forget('link');
        redraw();
      }
    } catch (e) { /* the next tick tries again */ }
  }, 3000);
}
