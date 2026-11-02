// The Mantel push relay: a Cloudflare Worker holding the APNs key so that no house has to
// (docs/phase10/APPLE-APPS.md §13, decision M10-2 revised 2026-10-19).
//
//   POST /v1/register  (the phone)  {token, env, house_key, platform?} -> {handle}   platform: "ios" (default) | "mac"
//       token: the APNs device token (hex); env: "sandbox" | "production"; house_key: the house's identity key
//       (P-256, x963, base64url) as the app pinned it. The handle works for that house only.
//   POST /v1/send      (a house, signed) {handle, payload, priority?, collapse_id?, push_type?}
//       payload: the APNs JSON, already sealed to the phone's own key by the house (the relay never sees the words).
//       collapse_id: opaque, a keyed hash of the notification's tag made by the house (apns.collapse_id), passed to
//       Apple as apns-collapse-id so a newer notification replaces an older one; the tag itself never comes here.
//   POST /v1/forget    (a house, signed) {handle}
//   GET  /v1/health
//
// A house signs each request with its identity key: ES256 over
//   "mantel-relay-v1\n" + METHOD + "\n" + path + "\n" + time + "\n" + nonce + "\n" + base64url(sha256(body))
// in X-Mantel-Signature, with X-Mantel-House (its key's fingerprint), X-Mantel-Time (unix seconds, ±300) and
// X-Mantel-Nonce (used once). The relay checks it against the key the handle was registered for.
// Limits: 120 sends a minute per house, 30 per handle, 20 registrations a minute per address; payload ≤ 4 KB.
// Secrets: APNS_KEY (the .p8 PEM). Vars: APNS_KEY_ID, APNS_TEAM_ID, APNS_TOPIC, APNS_TOPIC_MAC. D1: DB (schema.sql).

const SKEW = 300;
const LIMITS = { house: 120, handle: 30, register: 20 };
const APNS = { sandbox: 'https://api.sandbox.push.apple.com', production: 'https://api.push.apple.com' };
const GONE = new Set(['BadDeviceToken', 'Unregistered', 'DeviceTokenNotForTopic']);
const enc = new TextEncoder();

// -- encodings -------------------------------------------------------------------------------------
export function b64u(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function unb64u(text) {
  if (typeof text !== 'string' || !/^[A-Za-z0-9_-]*$/.test(text)) throw new Error('bad base64url');
  const s = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}
async function sha256(data) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', typeof data === 'string' ? enc.encode(data) : data));
}
const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

// -- keys ------------------------------------------------------------------------------------------
/** The house's key from x963, and its fingerprint (SHA-256 of the SubjectPublicKeyInfo, base64url) as the app pins it. */
export async function houseKey(x963) {
  const raw = unb64u(x963);
  if (raw.length !== 65 || raw[0] !== 4) throw new Error('a P-256 public key is 65 bytes');
  const key = await crypto.subtle.importKey('raw', raw, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify']);
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', key));
  return { key, fp: b64u(await sha256(spki)) };
}

let apnsToken = null;   // [issuedAt, jwt]: Apple wants a new provider token at most hourly
async function providerToken(env, now) {
  if (apnsToken && now - apnsToken[0] < 50 * 60) return apnsToken[1];
  const pem = String(env.APNS_KEY || '').replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const head = b64u(enc.encode(JSON.stringify({ alg: 'ES256', kid: env.APNS_KEY_ID })));
  const claims = b64u(enc.encode(JSON.stringify({ iss: env.APNS_TEAM_ID, iat: now })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${head}.${claims}`));
  apnsToken = [now, `${head}.${claims}.${b64u(sig)}`];
  return apnsToken[1];
}
export function resetProviderToken() { apnsToken = null; }

// -- helpers ---------------------------------------------------------------------------------------
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const fail = (status, error, extra = {}) => json({ error, ...extra }, status);

async function bump(db, bucket, now, limit) {
  const row = await db.prepare('INSERT INTO counts (bucket, n, expires) VALUES (?1, 1, ?2) ' +
    'ON CONFLICT(bucket) DO UPDATE SET n = n + 1 RETURNING n').bind(bucket, now + 120).first();
  return (row && row.n) <= limit;
}

async function readJson(request, max = 8192) {
  const text = await request.text();
  if (text.length > max) return [null, text];
  try {
    const body = JSON.parse(text);
    return [body && typeof body === 'object' && !Array.isArray(body) ? body : null, text];
  } catch { return [null, text]; }
}

/** A house's signed request: the handle row it may act on, or a Response refusing it. */
async function signed(request, env, path, text, body, now) {
  const h = request.headers;
  const fp = h.get('X-Mantel-House') || '', time = Number(h.get('X-Mantel-Time')), nonce = h.get('X-Mantel-Nonce') || '';
  const sig = h.get('X-Mantel-Signature') || '';
  if (!fp || !Number.isFinite(time) || !/^[A-Za-z0-9_-]{16,64}$/.test(nonce) || !sig) return fail(401, 'unsigned');
  if (Math.abs(now - time) > SKEW) return fail(401, 'stale');
  if (typeof body.handle !== 'string' || body.handle.length > 64) return fail(400, 'bad_handle');
  const row = await env.DB.prepare('SELECT * FROM handles WHERE hash = ?1').bind(hex(await sha256(body.handle))).first();
  if (!row || row.house_fp !== fp) return fail(404, 'unknown_handle');           // one answer for "not yours" too
  const { key } = await houseKey(row.house_key);
  const msg = `mantel-relay-v1\n${request.method}\n${path}\n${time}\n${nonce}\n${b64u(await sha256(text))}`;
  let ok = false;
  try {
    ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, unb64u(sig), enc.encode(msg));
  } catch { ok = false; }
  if (!ok) return fail(401, 'bad_signature');
  const fresh = await env.DB.prepare('INSERT INTO nonces (nonce, expires) VALUES (?1, ?2) ON CONFLICT(nonce) DO NOTHING ' +
    'RETURNING nonce').bind(`${fp}:${nonce}`, now + 2 * SKEW).first();
  if (!fresh) return fail(401, 'replayed');
  return row;
}

// -- routes ----------------------------------------------------------------------------------------
async function register(request, env, now) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (!(await bump(env.DB, `reg:${ip}:${Math.floor(now / 60)}`, now, LIMITS.register))) return fail(429, 'slow_down');
  const [body] = await readJson(request);
  if (!body) return fail(400, 'bad_json');
  const { token, env: apnsEnv, house_key: houseX963 } = body;
  const platform = body.platform === 'mac' ? 'mac' : 'ios';     // the Mac menu bar app has its own topic
  if (typeof token !== 'string' || !/^[0-9a-f]{64,200}$/.test(token)) return fail(400, 'bad_token');
  if (!(apnsEnv in APNS)) return fail(400, 'bad_env');
  let fp;
  try { ({ fp } = await houseKey(houseX963)); } catch { return fail(400, 'bad_house_key'); }
  const handle = b64u(crypto.getRandomValues(new Uint8Array(32)));
  const dedupe = hex(await sha256(`${token}|${fp}`));
  await env.DB.prepare('DELETE FROM handles WHERE dedupe = ?1').bind(dedupe).run();
  await env.DB.prepare('INSERT INTO handles (hash, dedupe, token, env, house_fp, house_key, created, platform) ' +
                       'VALUES (?1,?2,?3,?4,?5,?6,?7,?8)')
    .bind(hex(await sha256(handle)), dedupe, token, apnsEnv, fp, houseX963, now, platform).run();
  return json({ handle, house: fp }, 201);
}

async function send(request, env, now) {
  const [body, text] = await readJson(request);
  if (!body) return fail(400, 'bad_json');
  const row = await signed(request, env, '/v1/send', text, body, now);
  if (row instanceof Response) return row;
  const minute = Math.floor(now / 60);
  if (!(await bump(env.DB, `house:${row.house_fp}:${minute}`, now, LIMITS.house))) return fail(429, 'slow_down');
  if (!(await bump(env.DB, `handle:${row.hash}:${minute}`, now, LIMITS.handle))) return fail(429, 'slow_down');
  const payload = body.payload;
  if (!payload || typeof payload !== 'object' || !payload.aps) return fail(400, 'bad_payload');
  const data = JSON.stringify(payload);
  if (data.length > 4096) return fail(413, 'too_large');
  const topic = row.platform === 'mac' ? env.APNS_TOPIC_MAC : env.APNS_TOPIC;
  if (!topic) return fail(503, 'platform_not_configured');
  const pushType = body.push_type === 'background' ? 'background' : 'alert';
  const headers = { authorization: `bearer ${await providerToken(env, now)}`, 'apns-topic': topic,
                    'apns-push-type': pushType, 'apns-priority': body.priority === 5 || pushType === 'background' ? '5' : '10',
                    'content-type': 'application/json' };
  if (typeof body.collapse_id === 'string' && body.collapse_id) headers['apns-collapse-id'] = body.collapse_id.slice(0, 64);
  const resp = await (env.__fetch || fetch)(`${APNS[row.env]}/3/device/${row.token}`, { method: 'POST', headers, body: data });
  if (resp.status === 200) {
    await env.DB.prepare('UPDATE handles SET last_sent = ?1 WHERE hash = ?2').bind(now, row.hash).run();
    return json({ ok: true });
  }
  let reason = null;
  try { reason = (await resp.json()).reason || null; } catch { reason = null; }
  if (resp.status === 410 || GONE.has(reason)) {
    await env.DB.prepare('DELETE FROM handles WHERE hash = ?1').bind(row.hash).run();
    return json({ ok: false, gone: true, reason }, 410);
  }
  return json({ ok: false, status: resp.status, reason }, 502);
}

async function forget(request, env, now) {
  const [body, text] = await readJson(request);
  if (!body) return fail(400, 'bad_json');
  const row = await signed(request, env, '/v1/forget', text, body, now);
  if (row instanceof Response) return row;
  await env.DB.prepare('DELETE FROM handles WHERE hash = ?1').bind(row.hash).run();
  return json({ ok: true });
}

export default {
  async fetch(request, env) {
    const now = env.__now ? env.__now() : Math.floor(Date.now() / 1000);
    const { pathname } = new URL(request.url);
    try {
      if (request.method === 'GET' && pathname === '/v1/health') return json({ ok: true, service: 'mantel-push' });
      if (request.method !== 'POST') return fail(405, 'method');
      if (Math.random() < 0.05) {                      // now and then: forget what has run out
        await env.DB.prepare('DELETE FROM nonces WHERE expires < ?1').bind(now).run();
        await env.DB.prepare('DELETE FROM counts WHERE expires < ?1').bind(now).run();
      }
      if (pathname === '/v1/register') return await register(request, env, now);
      if (pathname === '/v1/send') return await send(request, env, now);
      if (pathname === '/v1/forget') return await forget(request, env, now);
      return fail(404, 'not_found');
    } catch (e) {
      console.error('relay error', e && e.message);
      return fail(500, 'relay_error');
    }
  },
};
