"""After a reconnect the page asks again for what it had open (web/shim/hub.js _resubscribe): the states
subscription and every read subscription, under their own ids. Without it a page lost its screens' feed
(black, pop-ups, notifications) and its settings feed at every Mantel restart until reloaded (the house,
2026-10-21). The real hub.js in node, with a stand-in WebSocket."""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent

HARNESS = r"""
const sockets = [];
globalThis.window = globalThis;
globalThis.document = { querySelector: () => null, addEventListener() {}, cookie: '' };
globalThis.addEventListener = () => {};
globalThis.location = { protocol: 'https:', host: 'mantel.example.com', pathname: '/dashboard-hall/0', search: '' };
globalThis.WebSocket = class {
  constructor(url) { this.url = url; this.sent = []; this.readyState = 1; sockets.push(this);
                     setTimeout(() => this.onopen && this.onopen(), 0); }
  send(t) { this.sent.push(JSON.parse(t)); }
  close() { this.readyState = 3; this.onclose && this.onclose(); }
};
const realSetTimeout = setTimeout;
globalThis.setTimeout = (fn, ms) => realSetTimeout(fn, ms > 100 ? 0 : ms);
const { Hub } = await import('./hub.mjs');
const hub = new Hub();
await hub.connect();
hub.subscribe(['light.kitchen'], [], false);
const got = [];
const unsub = await (async () => {
  const p = hub.readSubscribe({ type: 'hk_frontend/events/subscribe' }, (e) => got.push(e));
  const s = sockets[0], rs = s.sent.find((m) => m.type === 'read_subscribe');
  s.onmessage({ data: JSON.stringify({ type: 'read_result', id: rs.id, result: null }) });
  return p;
})();
const closed = hub.readSubscribe({ type: 'hk_frontend/settings/subscribe' }, () => {});
const s0 = sockets[0], ids = s0.sent.filter((m) => m.type === 'read_subscribe').map((m) => m.id);
s0.onmessage({ data: JSON.stringify({ type: 'read_result', id: ids[1], result: null }) });
(await closed)();                                   // one read closed before the drop: never asked again
sockets[0].close();                                 // the server restarted
await new Promise((r) => realSetTimeout(r, 20));
const s1 = sockets[1];
s1.onmessage({ data: JSON.stringify({ type: 'read_event', id: ids[0], event: { type: 'screen', tablet: 'hall', black: true } }) });
console.log(JSON.stringify({ sockets: sockets.length, resent: s1.sent, ids, got }));
process.exit(0);                                    // the hub's 45 s liveness timer would keep node running
"""


@pytest.fixture(scope="module")
def observed(tmp_path_factory):
    if shutil.which("node") is None:
        pytest.skip("node not installed")
    d = tmp_path_factory.mktemp("reconnect")
    shutil.copy(ROOT / "web/shim/base.js", d / "base.mjs")
    (d / "hub.mjs").write_text((ROOT / "web/shim/hub.js").read_text().replace("from './base.js'", "from './base.mjs'"))
    (d / "harness.mjs").write_text(HARNESS)
    out = subprocess.run(["node", str(d / "harness.mjs")], capture_output=True, text=True, timeout=30)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout.strip().splitlines()[-1])


def test_a_reconnect_asks_again_for_the_states_and_the_open_reads(observed):
    assert observed["sockets"] == 2
    sent = observed["resent"]
    assert {"type": "subscribe", "entity_ids": ["light.kitchen"], "areas": [], "all": False} in sent
    reads = [m for m in sent if m["type"] == "read_subscribe"]
    assert reads == [{"type": "read_subscribe", "id": observed["ids"][0], "msg": {"type": "hk_frontend/events/subscribe"}}], \
        "the events feed again, under its own id; the read closed before the drop is not asked again"


def test_the_feed_reaches_the_page_again_after_the_reconnect(observed):
    assert observed["got"] == [{"type": "screen", "tablet": "hall", "black": True}]
