// shim/registry-sync.js -- the page's registries follow the house (Phase 6, registry_feed.py on the server).
//
// A page reads /api/registry once as it loads (hass.entities / devices / areas / floors). An area renamed in Home
// Assistant afterwards stayed as it was on every open screen until someone reloaded it. Now the server says which
// registry this page may see: its digest is /api/registry's ETag, every snapshot frame carries it (`registry`), and
// a change sends {type: 'registry', digest}. When the digest is not the one the page holds, the page reads
// /api/registry again (with its ETag: a 304 when nothing changed after all), hands the host the new registries
// (host.applyRegistry: a new hass, so HK redraws) and counts it (page-health.js registryRefreshed()).
//
// A RECONNECT (hub.js onReconnect): the new socket's subscription is answered by a snapshot, which carries the
// digest. Unchanged while the socket was down, nothing is read; changed, it is read once.
import { registryRefreshed } from './page-health.js';

// '"abc"', 'W/"abc"' (a proxy that compresses weakens the tag) -> 'abc'
export const digestOf = (tag) => (tag ? String(tag).trim().replace(/^W\//, '').replace(/^"|"$/g, '') : null);

// {registry, digest}: the registry (null on a 304) and the digest it is, from the ETag
export async function loadRegistry(url, digest = null) {
  const opts = digest ? { headers: { 'If-None-Match': '"' + digest + '"' }, cache: 'no-store' } : undefined;
  const r = await fetch(url, opts);
  if (r.status === 304) return { registry: null, digest };
  if (!r.ok) throw new Error(url + ' ' + r.status);
  return { registry: await r.json(), digest: digestOf(r.headers.get('ETag')) };
}

// Follow the server's word from now on. `digest`: the one loadRegistry returned for the registry the host holds.
export function followRegistry(hub, host, url, digest) {
  let held = digest || null;
  let busy = false;
  let next = null;                        // a digest heard while a read was under way
  const refresh = async (want) => {
    busy = true;
    try {
      const got = await loadRegistry(url, held);
      if (got.registry) {
        host.applyRegistry(got.registry);
        registryRefreshed();
      }
      held = got.digest || want;
    } catch (e) {
      console.warn('[mantel] registry', e && e.message);   // the next frame or snapshot tries again
    } finally {
      busy = false;
    }
    if (next && next !== held) { const w = next; next = null; refresh(w); }
    else next = null;
  };
  const heard = (d) => {
    if (!d || d === held) return;
    if (!held) { held = d; return; }      // loaded without an ETag (an old server, a proxy that drops it): from now on
    if (busy) { next = d; return; }
    refresh(d);
  };
  hub.onRegistry = heard;
  return { get digest() { return held; }, heard };
}
