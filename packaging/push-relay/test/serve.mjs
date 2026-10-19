// Serve worker.js on 127.0.0.1 for tests/test_push_relay.py: node:sqlite for D1, a fake Apple that records what it got
// (GET /__sent). Usage: node serve.mjs <port>. Fictional keys only.
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import worker from '../worker.js';

const here = fileURLToPath(new URL('..', import.meta.url));
const db = new DatabaseSync(':memory:');
db.exec(readFileSync(here + 'schema.sql', 'utf8'));
const D1 = { prepare(sql) { const s = db.prepare(sql); let a = []; const api = { bind(...x) { a = x; return api; },
  async first() { return s.get(...a) ?? null; }, async run() { s.run(...a); return {}; }, async all() { return { results: s.all(...a) }; } }; return api; } };
const key = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
const der = Buffer.from(await crypto.subtle.exportKey('pkcs8', key.privateKey)).toString('base64');
const sent = [];
const env = { DB: D1, APNS_KEY: `-----BEGIN PRIVATE KEY-----\n${der}\n-----END PRIVATE KEY-----`, APNS_KEY_ID: 'KEYID12345',
              APNS_TEAM_ID: 'TEAM123456', APNS_TOPIC: 'com.example.mantel.ios',
              __fetch: async (url, init) => { sent.push({ url, body: JSON.parse(init.body) }); return new Response('', { status: 200 }); } };
http.createServer(async (req, res) => {
  if (req.url === '/__sent') { res.end(JSON.stringify(sent)); return; }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const r = await worker.fetch(new Request('http://127.0.0.1' + req.url, { method: req.method, headers: req.headers,
    body: req.method === 'POST' ? Buffer.concat(chunks) : undefined }), env);
  res.writeHead(r.status, { 'Content-Type': 'application/json' });
  res.end(await r.text());
}).listen(Number(process.argv[2]), '127.0.0.1', () => console.log('ready'));
