// Tests for the push relay (worker.js), run by tests/test_push_relay.py: node:sqlite stands in for D1, a fake fetch for
// Apple. Fictional keys only; nothing leaves this machine.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import worker, { b64u, unb64u, houseKey, resetProviderToken } from '../worker.js';

const here = fileURLToPath(new URL('..', import.meta.url));
const enc = new TextEncoder();

function d1() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(here + 'schema.sql', 'utf8'));
  return {
    raw: db,
    prepare(sql) {
      const stmt = db.prepare(sql);
      let args = [];
      const api = {
        bind(...a) { args = a; return api; },
        async first() { return stmt.get(...args) ?? null; },
        async run() { stmt.run(...args); return { success: true }; },
        async all() { return { results: stmt.all(...args) }; },
      };
      return api;
    },
  };
}

async function ecKey() {
  return crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
}
async function x963(pub) { return b64u(await crypto.subtle.exportKey('raw', pub)); }
async function pem(priv) {
  const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', priv));
  return '-----BEGIN PRIVATE KEY-----\n' + Buffer.from(der).toString('base64') + '\n-----END PRIVATE KEY-----\n';
}

let now = 2_000_000_000;
const sent = [];
let apple = { status: 200, body: '' };
const appleKey = await ecKey();
const env = {
  DB: d1(), APNS_KEY: await pem(appleKey.privateKey), APNS_KEY_ID: 'KEYID12345', APNS_TEAM_ID: 'TEAM123456',
  APNS_TOPIC: 'com.example.mantel.ios', __now: () => now,
  __fetch: async (url, init) => { sent.push({ url, init }); return new Response(apple.body, { status: apple.status }); },
};
const call = (path, body, headers = {}, method = 'POST') => worker.fetch(new Request('https://relay.example' + path, {
  method, headers: { 'Content-Type': 'application/json', ...headers }, body: method === 'POST' ? JSON.stringify(body) : undefined }), env);

async function signedCall(house, path, body, { time = now, nonce = b64u(crypto.getRandomValues(new Uint8Array(16))), key } = {}) {
  const text = JSON.stringify(body);
  const digest = b64u(await crypto.subtle.digest('SHA-256', enc.encode(text)));
  const msg = `mantel-relay-v1\nPOST\n${path}\n${time}\n${nonce}\n${digest}`;
  const sig = b64u(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, (key || house.keys).privateKey, enc.encode(msg)));
  return worker.fetch(new Request('https://relay.example' + path, { method: 'POST', body: text, headers: {
    'Content-Type': 'application/json', 'X-Mantel-House': house.fp, 'X-Mantel-Time': String(time), 'X-Mantel-Nonce': nonce,
    'X-Mantel-Signature': sig } }), env);
}

async function makeHouse() {
  const keys = await ecKey();
  const key = await x963(keys.publicKey);
  return { keys, key, fp: (await houseKey(key)).fp };
}

const TOKEN = 'ab'.repeat(32);
const COLLAPSE = 'q3YVb0Zr8m1xJk2Lw9PcTn4HsD7eUa6G';   // the house's keyed hash of a tag (apns.collapse_id): never the tag
const payload = { aps: { alert: { title: 'Mantel', body: 'New notification' }, 'mutable-content': 1 }, m: { v: '1', epk: 'x', box: 'y' } };
let ok = 0;
const test = async (name, fn) => { await fn(); ok++; console.log('ok -', name); };

const house = await makeHouse();
const other = await makeHouse();

await test('health', async () => {
  const r = await call('/v1/health', null, {}, 'GET');
  assert.equal(r.status, 200);
});

let handle;
await test('a phone registers for one house and gets a handle', async () => {
  const r = await call('/v1/register', { token: TOKEN, env: 'sandbox', house_key: house.key });
  assert.equal(r.status, 201);
  const got = await r.json();
  assert.equal(got.house, house.fp);
  handle = got.handle;
  const rows = env.DB.raw.prepare('SELECT * FROM handles').all();
  assert.equal(rows.length, 1);
  assert.ok(!JSON.stringify(rows).includes(handle));          // only its hash is kept
  for (const bad of [{ token: 'nothex', env: 'sandbox', house_key: house.key }, { token: TOKEN, env: 'prod', house_key: house.key },
                     { token: TOKEN, env: 'sandbox', house_key: 'AAAA' }]) {
    assert.equal((await call('/v1/register', bad)).status, 400);
  }
});

await test('the house sends through the relay; Apple gets the payload with the team token', async () => {
  const r = await signedCall(house, '/v1/send', { handle, payload, collapse_id: COLLAPSE });
  assert.equal(r.status, 200, await r.clone().text());
  const { url, init } = sent.at(-1);
  assert.equal(url, `https://api.sandbox.push.apple.com/3/device/${TOKEN}`);
  assert.equal(init.headers['apns-topic'], 'com.example.mantel.ios');
  assert.equal(init.headers['apns-collapse-id'], COLLAPSE);             // opaque, passed on as it came
  assert.deepEqual(JSON.parse(init.body), payload);
  const [h, c, s] = init.headers.authorization.slice(7).split('.');
  assert.deepEqual(JSON.parse(Buffer.from(unb64u(h)).toString()), { alg: 'ES256', kid: 'KEYID12345' });
  assert.equal(JSON.parse(Buffer.from(unb64u(c)).toString()).iss, 'TEAM123456');
  assert.ok(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, appleKey.publicKey, unb64u(s), enc.encode(`${h}.${c}`)));
});

await test('another house cannot use the handle, even signing correctly with its own key', async () => {
  const r = await signedCall(other, '/v1/send', { handle, payload });
  assert.equal(r.status, 404);
  const forged = await signedCall({ ...house, keys: other.keys }, '/v1/send', { handle, payload });
  assert.equal(forged.status, 401);                              // claims to be the house, signed with another key
});

await test('a request is good once and only now', async () => {
  const nonce = 'fixed-nonce-0123456789';
  assert.equal((await signedCall(house, '/v1/send', { handle, payload }, { nonce })).status, 200);
  assert.equal((await signedCall(house, '/v1/send', { handle, payload }, { nonce })).status, 401);
  assert.equal((await signedCall(house, '/v1/send', { handle, payload }, { time: now - 400 })).status, 401);
  // a changed body breaks the signature
  const text = JSON.stringify({ handle, payload });
  const r = await worker.fetch(new Request('https://relay.example/v1/send', { method: 'POST', body: text.replace('Mantel', 'Evil'),
    headers: { 'X-Mantel-House': house.fp, 'X-Mantel-Time': String(now), 'X-Mantel-Nonce': 'another-nonce-012345',
               'X-Mantel-Signature': b64u(new Uint8Array(64)) } }), env);
  assert.equal(r.status, 401);
});

await test('rate limits per handle', async () => {
  now += 120;
  let last;
  for (let i = 0; i < 31; i++) last = await signedCall(house, '/v1/send', { handle, payload });
  assert.equal(last.status, 429);
});

await test('a handle Apple says is gone is dropped', async () => {
  now += 120;
  apple = { status: 410, body: JSON.stringify({ reason: 'Unregistered' }) };
  const r = await signedCall(house, '/v1/send', { handle, payload });
  assert.equal(r.status, 410);
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM handles').get().n, 0);
  apple = { status: 200, body: '' };
});

await test('re-registering replaces; the house can forget a handle', async () => {
  const a = await (await call('/v1/register', { token: TOKEN, env: 'production', house_key: house.key })).json();
  const b = await (await call('/v1/register', { token: TOKEN, env: 'production', house_key: house.key })).json();
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM handles').get().n, 1);
  assert.equal((await signedCall(house, '/v1/send', { handle: a.handle, payload })).status, 404);
  assert.equal((await signedCall(house, '/v1/send', { handle: b.handle, payload })).status, 200);
  assert.equal(sent.at(-1).url.startsWith('https://api.push.apple.com/'), true);
  assert.equal((await signedCall(house, '/v1/forget', { handle: b.handle })).status, 200);
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM handles').get().n, 0);
});

await test('the relay keeps nothing of a notification: no payload, no collapse id', async () => {
  now += 120;
  const reg = await (await call('/v1/register', { token: TOKEN, env: 'sandbox', house_key: house.key })).json();
  assert.equal((await signedCall(house, '/v1/send', { handle: reg.handle, payload, collapse_id: COLLAPSE })).status, 200);
  const stored = JSON.stringify(['handles', 'nonces', 'counts'].map((t) => env.DB.raw.prepare(`SELECT * FROM ${t}`).all()));
  assert.ok(!stored.includes(COLLAPSE) && !stored.includes('New notification') && !stored.includes('"box"'));
  // the house's Stop Sending to… forgets the handle: nothing more reaches that phone
  assert.equal((await signedCall(house, '/v1/forget', { handle: reg.handle })).status, 200);
  assert.equal((await signedCall(house, '/v1/send', { handle: reg.handle, payload })).status, 404);
  assert.equal((await signedCall(house, '/v1/forget', { handle: reg.handle })).status, 404);
});

resetProviderToken();
console.log(`${ok} relay tests passed`);
