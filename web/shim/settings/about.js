// settings/about.js -- Mantel Settings, About: which Mantel this is and what it talks to.
import { mantelUrl } from '../base.js';
import { api, can, fmt, load } from './core.js';
import { button, failed, group, info, nav, pending } from './kit.js';
import { pPerformance } from './performance.js';

// ABOUT (about.py): which Mantel this is and what it talks to; for anyone signed in, nothing secret
export function pAbout(sub = []) {
  if (sub[0] === 'performance' && can('performance')) return pPerformance();     // About, Performance: Owners and Admins
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
    const links = (a.linked || []).map((l) => info(l.name, 'Protocol ' + l.protocol + (l.since ? ' · since ' + fmt(l.since) : ''), 'Linked'));
    c.appendChild(group({ header: 'Connected To' }, [
      info('Home Assistant', null, ha.connected ? (ha.version || 'Connected') : 'Not connected'),
      info('Music Assistant', null, !ma.configured ? 'Not set up' : (ma.version || 'Not connected')),
    ].concat(links.length ? links : [info('In Home Assistant', null, 'Nothing linked')])));
    if (can('performance')) c.appendChild(group({ footer: 'How the wall tablets’ pages and the server are doing: start times, memory, reconnects and fan-out.' }, [
      nav('Performance', 'about/performance', { icon: 'mdi:speedometer', sub: 'Each screen, and the server’s fan-out' })]));
    c.appendChild(group({ header: 'About the Project', footer: 'Mantel serves HK’s home screens from a server of its own beside Home Assistant. Wall tablets, phones and browsers sign in to Mantel, and every change to the house passes its roles and its audit log. Mantel Link is its side inside Home Assistant: the tablets’ and the house’s entities, and the actions automations call. It grew out of HK Frontend, which drew the same screens inside Home Assistant. Apple’s SF Pro and SF Symbols are supplied by each home (Your Files); Mantel ships none.' }, [
      button('Documentation', () => { window.open(mantelUrl(a.docs || '/docs'), '_blank', 'noopener'); }, { fk: 'mx:about-docs' }),
    ]));
  } };
}
