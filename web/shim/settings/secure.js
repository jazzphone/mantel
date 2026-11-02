// settings/secure.js -- Mantel Settings, About, Secure Connection (about.py, page-health.js): whether talking at the door can work.
//
// A browser gives the microphone only to a secure page: HTTPS with a certificate it trusts, or localhost. On plain HTTP
// the doorbell sheet's talk button is not drawn at all, and nothing says why. So this page says it: whether THIS screen
// is a secure context (the browser knows; the server cannot), how Mantel is reached (about.py's `access.mode`), which
// address this screen used against the public one, and, for the people who manage the house, each wall tablet whose
// page said it is not secure (GET /api/about/secure) with the fix. Anyone signed in may read it; the tablets' names
// and addresses are the managers'.
import { ago, api, can, load, ROUTE } from './core.js';
import { failed, group, info, nav, pending } from './kit.js';

export const FIX = 'Open Mantel by its https:// name, not its IP address, in Fully Kiosk’s Start URL.';
// Docker and the LXC start at the machine's address with Mantel's own certificate, so there is no name to open yet: that is Set Up
// Mantel's "Address and HTTPS" step (setup_guide.py), which says why and how, so this page points to it and says nothing more
export const FIX_AT_ADDRESS = 'Mantel has no name yet. Run mantel-setup on the machine Mantel runs on to give it one, then open Mantel by that name in Fully Kiosk’s Start URL (Set Up Mantel → Address and HTTPS).';

// the words for each of about.py's MODES
const MODES = {
  builtin_https: ['Built-In HTTPS', 'Mantel serves HTTPS itself, with its own certificate.'],
  proxy: ['Behind Your Own Proxy', 'A proxy in your home answers on the public address and passes requests to Mantel. Its certificate decides whether browsers trust the page.'],
  ha_sidebar: ['Home Assistant’s Sidebar', 'People reach Mantel through Home Assistant, whose own address and certificate decide whether the page is secure.'],
  http: ['Plain HTTP', 'Mantel is reached without HTTPS, so no browser will give a page the microphone. Put a proxy with a certificate in front of it, or let Mantel serve HTTPS itself.'],
};
export const modeWords = (mode) => MODES[mode] || MODES.http;

// whether THIS screen's page is a secure context (the browser's word); null where it does not say
export const secureHere = () => (typeof window.isSecureContext === 'boolean' ? window.isSecureContext : null);

// the address in use, against the public one: null when there is nothing to say about it
const IP = /^(?:\d{1,3}(?:\.\d{1,3}){3}|\[[0-9a-fA-F:.]+\])$/;
export function addressNote(origin, publicUrl) {
  let here, pub;
  try { here = new URL(origin); pub = publicUrl ? new URL(publicUrl) : null; } catch (e) { return null; }
  const wantsHttps = !!pub && pub.protocol === 'https:';
  const pubIsAddress = !!pub && IP.test(pub.hostname);       // Mantel's own address is the public one: an IP address is the right one to use
  if (wantsHttps && here.protocol !== 'https:') return 'This screen is on http, but Mantel’s public address is ' + pub.origin + '. Open that instead.';
  if (wantsHttps && !pubIsAddress && IP.test(here.hostname)) return 'This screen is on an IP address, which no certificate covers. Open ' + pub.origin + ' instead.';
  if (pub && here.origin !== pub.origin) return 'This is not Mantel’s public address (' + pub.origin + ').';
  return null;
}

// the read of the wall tablets that said they are not secure, {tablets: [{name, origin, last_seen}]}: null while it is on its way,
// {err} if it failed. Only a manager's; anyone else has none to read.
export const tabletsRead = () => (can('performance') ? load('about_secure', () => api('GET', '/api/about/secure')) : { data: { tablets: [] } });

// one line for the About row: this screen, then the tablets the manager can see
export function rowSummary(tablets) {
  const here = secureHere();
  const bits = [here === null ? 'This screen cannot say' : here ? 'This screen is secure' : 'This screen is not secure'];
  if (tablets && tablets.length) bits.push(tablets.length === 1 ? '1 wall tablet is not' : tablets.length + ' wall tablets are not');
  return bits.join(' · ');
}

// Mantel at its own address (about.py `access.at_address`): the managers read Set Up Mantel's own words for it, with a way into that step;
// everyone else is told where the fix is
function addressGroup() {
  if (!can('setup')) return group({ header: 'Address', footer: 'Mantel is at its address, with its own certificate. An Owner can give it a name with mantel-setup.' }, []);
  const read = load('setup', () => api('GET', '/api/setup'));
  const step = read && read.data && read.data.steps.find((x) => x.id === 'address');
  return group({ header: 'Address', footer: step && step.how_note }, [
    nav('Address and HTTPS', 'setup/step/address', { icon: 'mdi:lock', sub: step ? step.detail : null, value: 'mantel-setup' })]);
}

export function pSecure() {
  return { title: 'Secure Connection', back: ['About', '#/' + ROUTE + '/about'],
           scope: 'Talking at the door needs HTTPS: a browser gives the microphone only to a secure page.', body(c) {
    const got = load('about', () => api('GET', '/api/about'));
    if (!got) { pending(c); return; }
    if (got.err) { failed(c, got.err); return; }
    const a = got.data.access || {}, here = secureHere(), origin = window.location.origin, note = addressNote(origin, a.public_url);
    const [mode, modeSub] = modeWords(a.mode);
    const fix = a.at_address ? FIX_AT_ADDRESS : FIX;
    c.appendChild(group({ header: 'This Screen', footer: here === false ? fix : null }, [
      info('Secure Page', here === false ? 'The microphone is not available here, so the doorbell’s talk button is left out.' : null,
           here === null ? 'Unknown' : here ? 'Yes' : 'No', here === false ? 'warn' : ''),
      info('Address', note, origin),
    ]));
    c.appendChild(group({ header: 'Mantel' }, [
      info('Reached By', modeSub, mode),
      info('Public Address', a.public_url ? null : 'No public address was set.', a.public_url || 'None'),
    ]));
    if (a.at_address) c.appendChild(addressGroup());
    if (!can('performance')) return;
    const read = tabletsRead();
    if (!read) { pending(c); return; }
    if (read.err) { failed(c, read.err); return; }
    const tablets = read.data.tablets || [];
    c.appendChild(group({ header: 'Wall Tablets', footer: tablets.length ? fix : 'Every wall tablet that has reported in the last 24 hours is on a secure page.' },
      tablets.map((t) => info(t.name, (t.origin ? 'Opened ' + t.origin + ' · ' : '') + 'heard ' + ago(t.last_seen), 'Not Secure', 'warn'))));
  } };
}
