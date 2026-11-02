// settings/about.js -- Mantel Settings, About: which Mantel this is and what it talks to.
import { mantelUrl } from '../base.js';
import { act, api, can, fmt, K, load } from './core.js';
import { button, failed, group, info, nav, pending, result } from './kit.js';
import { pPerformance } from './performance.js';
import { modeWords, pSecure, rowSummary, secureHere, tabletsRead } from './secure.js';

// THE UPDATE CHECK (alerts/updates.py): Owners and Admins read it; only the Owner turns it off. Mantel asks GitHub about its own newest release
// (and Mantel Link's and HK Frontend's, when they are installed) and says how to update this install; it installs nothing
const updates = () => load('updates', () => api('GET', '/api/updates'));
function updateRows(u) {
  const rows = [];
  for (const p of u.products) {
    if (!p.installed) continue;                                  // not told to Mantel (or not there): nothing to compare
    if (p.newer) {
      rows.push(info(p.name + ' ' + p.latest + ' Is Available', (p.date ? 'Released ' + fmt(p.date) + '. ' : '') + p.how + ' You have ' + p.installed + '.', 'Update', 'warn'));
      if (p.url) rows.push(button('Release Notes', () => { window.open(p.url, '_blank', 'noopener'); }, { fk: 'mx:update-notes-' + p.id }));
    } else rows.push(info(p.name, null, p.latest ? 'Up to Date' : 'Version ' + p.installed));
  }
  if (u.check && u.error) rows.push(info('Last Check', null, 'Couldn’t check (' + fmt(u.error.at) + ')', 'warn'));
  else if (u.check && u.checked_at) rows.push(info('Last Check', null, fmt(u.checked_at)));
  rows.push(K().toggle({ label: 'Check for Updates', sub: u.check ? 'Mantel asks GitHub once a day for the newest releases; it sends nothing about this house' : 'Mantel never contacts GitHub', on: u.check, disabled: !u.can_edit, fk: 'mx:updates-check',
    onChange: (want) => act('updates', () => api('PUT', '/api/updates', { check: want }), want ? 'Mantel will look for updates.' : 'Mantel won’t look for updates.', 'updates') }));
  if (u.can_edit && u.check) rows.push(button('Check Now', () => act('updates', () => api('POST', '/api/updates/check'), 'Checked.', 'updates'), { fk: 'mx:updates-now' }));
  return rows;
}

// ABOUT (about.py): which Mantel this is and what it talks to; for anyone signed in, nothing secret
export function pAbout(sub = []) {
  if (sub[0] === 'performance' && can('performance')) return pPerformance();     // About, Performance: Owners and Admins
  if (sub[0] === 'secure') return pSecure();     // About, Secure Connection: anyone signed in; the tablets' names and addresses, Owners and Admins
  return { title: 'About', top: true, scope: 'This Mantel, and what it is connected to.', body(c) {
    const got = load('about', () => api('GET', '/api/about'));
    if (!got) { pending(c); return; }
    if (got.err) { failed(c, got.err); return; }
    const a = got.data, ha = a.home_assistant || {}, ma = a.music_assistant || {};
    const ver = a.version ? (a.commit && a.commit !== 'dev' ? a.version + ' (' + a.commit + ')' : a.version) : 'Unknown';
    c.appendChild(group({ header: 'Mantel', footer: 'Build ' + (a.build || 'dev') + (a.staged ? ', staged ' + fmt(a.staged) : '') + '.' }, [
      info('Version', null, ver),
      info('Installed As', null, a.install),
      info('Running Since', null, fmt(a.started)),
      info('House Commands', a.commands ? 'Signed-in people control the house within their roles; every command is in the Audit Log.' : 'Read-only: nothing is sent to the house.', a.commands ? 'On' : 'Off'),
    ]));
    const up = can('performance') ? updates() : null;                     // Owners and Admins; others don't see the section
    if (up && up.data) {
      result(c, 'updates');
      c.appendChild(group({ header: 'Updates', footer: up.data.can_edit ? 'Mantel can’t install updates itself; it tells you when there is one and how to apply it.' : 'Only an Owner changes this.' }, updateRows(up.data)));
    }
    const links = (a.linked || []).map((l) => info(l.name, 'Protocol ' + l.protocol + (l.since ? ' · since ' + fmt(l.since) : ''), 'Linked'));
    c.appendChild(group({ header: 'Connected To' }, [
      info('Home Assistant', null, ha.connected ? (ha.version || 'Connected') : 'Not connected'),
      info('Music Assistant', null, !ma.configured ? 'Not set up' : (ma.version || 'Not connected')),
    ].concat(links.length ? links : [info('In Home Assistant', null, 'Nothing linked')])));
    // SECURE CONNECTION (secure.js): talking at the door needs HTTPS. This screen's own word, and for the managers the wall tablets that are not
    const read = tabletsRead(), here = secureHere(), loose = read && read.data ? read.data.tablets || [] : [];
    c.appendChild(group({ footer: 'Talking at the door needs HTTPS: a browser gives the microphone only to a secure page.' }, [
      nav('Secure Connection', 'about/secure', { icon: here === false || loose.length ? 'mdi:lock-open-variant' : 'mdi:lock', sub: rowSummary(loose), value: modeWords((a.access || {}).mode)[0] })]));
    if (can('performance')) c.appendChild(group({ footer: 'How the wall tablets’ pages and the server are doing: start times, memory, reconnects and fan-out.' }, [
      nav('Performance', 'about/performance', { icon: 'mdi:speedometer', sub: 'Each screen, and the server’s fan-out' })]));
    c.appendChild(group({ header: 'About the Project', footer: 'Mantel serves HK’s home screens from a server of its own beside Home Assistant. Wall tablets, phones and browsers sign in to Mantel, and every change to the house passes its roles and its audit log. Mantel Link is its side inside Home Assistant: the tablets’ and the house’s entities, and the actions automations call. It grew out of HK Frontend, which drew the same screens inside Home Assistant. Apple’s SF Pro and SF Symbols are supplied by each home (Your Files); Mantel ships none.' }, [
      button('Documentation', () => { window.open(mantelUrl(a.docs || '/docs'), '_blank', 'noopener'); }, { fk: 'mx:about-docs' }),
    ]));
  } };
}
