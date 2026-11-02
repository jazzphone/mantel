"""Mantel Settings, Cameras (web/shim/settings/cameras.js over camera_setup.py's /api/cameras/rtsp): the direct cameras
listed, Add Camera, a camera's page with Test and Notify For, and under the Home Assistant App the words that cameras come
from Home Assistant, with a link and no add button. Drawn in node with the recording kit stub of the other pages' tests,
and driven: the boxes are filled as a person would, Test and Save pressed, and what the page SENT is what is checked
(a blank box on a saved camera is left out so the server keeps it; nothing secret is ever read back)."""
from __future__ import annotations

import json
import shutil
import subprocess

import pytest
from js_modules import copy_shim

SCRIPT = r"""
import { readFileSync } from 'node:fs';
globalThis.window = globalThis;
globalThis.document = { querySelector: () => null, cookie: '' };
const text = (v) => (v == null ? v : typeof v === 'object' ? (v._text !== undefined ? v._text : JSON.stringify(v)) : v);
const hrefs = (n) => (n && typeof n === 'object' ? [].concat(n.attrs && n.attrs.href ? [n.attrs.href] : [], ...(n.kids || []).map(hrefs)) : []);
const row = (kind) => (o) => ({ ...o, kind, sub: text(o.sub) });
window.hkSettingsKit = {
  group: (o, rows) => ({ kind: 'group', header: o.header || null, footer: text(o.footer), links: hrefs(o.footer), rows: rows.filter(Boolean) }),
  info: row('info'), nav: row('nav'), button: row('button'), toggle: row('toggle'), text: row('text'), select: row('select'),
  check: row('check'), confirm: async () => true,
  h: (tag, attrs, kids) => {
    const k = (Array.isArray(kids) ? kids : kids == null ? [] : [kids]).filter((x) => x != null);
    return { tag, attrs: attrs || {}, kids: k, _text: (attrs && attrs.text) || k.map((x) => (typeof x === 'object' ? x._text : String(x))).join('') };
  },
};
const scenario = JSON.parse(readFileSync(process.argv[3], 'utf8'));
const calls = [];
let live = {};
globalThis.fetch = async (u, init) => {
  const key = ((init && init.method) || 'GET') + ' ' + String(u).split('?')[0];
  calls.push({ key, url: String(u), body: init && init.body ? JSON.parse(init.body) : null });
  if (!(key in live)) throw new Error('unexpected ' + key);
  const r = live[key];
  return { ok: (r.status || 200) < 400, status: r.status || 200, json: async () => r.body };
};
const m = await import(process.argv[2]);
const tick = () => new Promise((r) => setTimeout(r, 0));
const panel = { render() {}, status() {}, go() {}, shadowRoot: null };
globalThis.location = { origin: 'http://mantel.test', hash: '', search: '', pathname: '/settings' };
async function draw(route) {
  let kids = [], page = null;
  for (let i = 0; i < 4; i++) {
    const c = { kids: [], appendChild(k) { this.kids.push(k); return k; } };
    page = m.host.page(['mantel', ...route], panel);
    page.body(c);
    kids = c.kids;
    await tick(); await tick();
  }
  return { title: page.title, back: page.back || null, groups: kids };
}
const rows = (p) => p.groups.flatMap((g) => g.rows || []);
const find = (p, label) => rows(p).find((r) => r.label === label);
const flashes = (p) => p.groups.filter((g) => g.kind !== 'group').map((g) => g._text);
const out = {};
for (const [name, sc] of Object.entries(scenario)) {
  m._reset(sc.me);
  live = sc.live; calls.length = 0; globalThis.location.hash = '';
  const first = await draw(sc.route);
  const res = { page: first, calls: [] };
  for (const step of sc.steps || []) {
    let p = await draw(sc.route);
    if (step.set) {
      for (const [label, v] of Object.entries(step.set)) { const r = find(p, label); r.onCommit ? r.onCommit(v) : r.onChange(v); }
    }
    if (step.press) {
      const r = find(p, step.press);
      calls.length = 0;
      await r.onClick();
      await tick(); await tick();
      res[step.press] = { calls: calls.slice(), hash: globalThis.location.hash };
    }
    if (step.shot) res[step.shot] = await draw(step.route || sc.route);
  }
  out[name] = res;
}
const { bodyOf, testSays } = await import(process.argv[4]);
out._body = {
  new: bodyOf({ name: ' Driveway ', area_id: 'porch', address: ' rtsp://h/s ', low_address: '', username: 'u', password: 'p', sensors: { motion: 'binary_sensor.m', person: '', doorbell: '' } }, null, true),
  saved_blank: bodyOf({ name: 'Driveway', area_id: '', address: '', low_address: '', username: '', password: '', sensors: { motion: '', person: '', doorbell: '' } }, { slug: 'driveway' }, true),
  saved_changed: bodyOf({ name: 'D', address: 'rtsp://h/new', low_address: '', drop_low: true, password: 'new', clear_login: true, sensors: {} }, { slug: 'driveway' }, false),
  no_ha: bodyOf({ name: 'D', address: 'rtsp://h/s', sensors: { motion: 'binary_sensor.m' } }, null, false),
};
out._says = [testSays({ video: 'H264', audio: 'PCMA', low: true }), testSays({ video: 'H264', audio: null, low: false })];
process.stdout.write(JSON.stringify(out));
"""

OWNER = {"user": {"id": "u1", "name": "Fictional Owner", "username": "owner", "role": "owner", "kind": "mantel", "totp": False, "passkeys": 0},
         "door": "lan", "csrf": "x", "now": 0, "at_tablet": False, "sections": ["me", "cameras", "connections", "people"], "roles": [],
         "device_roles": [], "actions": [], "resource_kinds": [], "features": [], "service_scopes": [], "connect_port": None,
         "ha_set_up": True}
ADULT = {**OWNER, "user": {**OWNER["user"], "role": "adult"}, "sections": ["me"]}
HOST = "192.0.2.31"


def cam(slug, name, **over):
    return {"slug": slug, "entity_id": f"camera.mantel_{slug}", "name": name, "source": "rtsp", "area_id": "porch", "area_name": "Porch",
            "state": "ok", "conflict": None, "sessions": 0, "low": False, "editable": True, "address": f"rtsp://{HOST}:554",
            "low_address": None, "has_login": True, "sensors": {}, **over}


def state(**over):
    return {"ok": True, "mode": "direct", "can_edit": True, "needs_fresh": False, "door": "lan", "ha": {"set_up": True, "connected": True},
            "ha_docs": "https://www.home-assistant.io/integrations/generic/", "areas": [{"id": "porch", "name": "Porch"}, {"id": "kitchen", "name": "Kitchen"}],
            "cameras": [cam("driveway", "Driveway", sensors={"person": {"entity_id": "binary_sensor.driveway_person", "name": "Driveway Person", "missing": False}}),
                        cam("front", "Front Door", source="protect", editable=False, address=None, has_login=False)], "error": None, **over}


SENSORS = {"ok": True, "ha": {"set_up": True, "connected": True}, "suggested": {"motion": "binary_sensor.driveway_motion", "person": None, "doorbell": None},
           "sensors": [{"entity_id": "binary_sensor.driveway_motion", "name": "Driveway Motion", "kind": "motion", "area": "Porch", "linked_to": None},
                       {"entity_id": "binary_sensor.driveway_person", "name": "Driveway Person", "kind": "person", "area": None, "linked_to": None},
                       {"entity_id": "binary_sensor.hall_motion", "name": "Hall Motion", "kind": "motion", "area": None, "linked_to": "Hall"}]}
STILL = "data:image/jpeg;base64,/9j/AAAA"


@pytest.fixture(scope="module")
def got(tmp_path_factory):
    if shutil.which("node") is None:
        pytest.skip("node not installed")
    d = tmp_path_factory.mktemp("mantel-settings-cameras")
    copy_shim(d)
    (d / "script.mjs").write_text(SCRIPT)
    api = "/api/cameras/rtsp"
    scenario = {
        "list": {"me": OWNER, "route": ["cameras"], "live": {"GET " + api: {"body": state()}}},
        "list_nothing_yet_without_ha": {"me": OWNER, "route": ["cameras"], "live": {"GET " + api: {"body": state(cameras=[], ha={"set_up": False, "connected": False}, needs_fresh=True)}}},
        "ha_app": {"me": OWNER, "route": ["cameras"], "live": {"GET " + api: {"body": state(mode="ha_app", cameras=[], areas=[])}}},
        "no_go2rtc": {"me": OWNER, "route": ["cameras"], "live": {"GET " + api: {"body": state(mode="no_go2rtc", cameras=[], areas=[])}}},
        "ha_app_add": {"me": OWNER, "route": ["cameras", "add"], "live": {"GET " + api: {"body": state(mode="ha_app", cameras=[], areas=[])}}},
        "adult": {"me": ADULT, "route": ["cameras"], "live": {}},
        # a new camera: the boxes filled as a person would, Test, then Add Camera
        "add": {"me": OWNER, "route": ["cameras", "add"], "live": {
            "GET " + api: {"body": state(cameras=[])}, "GET " + api + "/sensors": {"body": SENSORS},
            "POST " + api + "/test": {"body": {"ok": True, "result": {"ok": True, "video": "H264", "audio": "PCMA", "low": False, "still": STILL}}},
            "POST " + api: {"status": 201, "body": {"ok": True, "camera": cam("driveway", "Driveway")}}},
            "steps": [{"set": {"Name": "Driveway", "RTSP Address": f"rtsp://{HOST}:554/stream1", "User Name": "viewer", "Password": "Fictional-Pw"}},
                      {"press": "Use Suggested Sensors"}, {"press": "Test", "shot": "after_test"}, {"press": "Add Camera"}]},
        "test_fails": {"me": OWNER, "route": ["cameras", "add"], "live": {
            "GET " + api: {"body": state(cameras=[])}, "GET " + api + "/sensors": {"body": SENSORS},
            "POST " + api + "/test": {"status": 422, "body": {"error": "auth", "message": "The camera refused the user name or password."}}},
            "steps": [{"set": {"RTSP Address": f"rtsp://{HOST}:554/x"}}, {"press": "Test", "shot": "after_test"}]},
        # a saved camera: its boxes say Saved, nothing is read back; a change leaves the blank ones out; Delete
        "saved": {"me": OWNER, "route": ["cameras", "driveway"], "live": {
            "GET " + api: {"body": state()}, "GET " + api + "/sensors": {"body": SENSORS},
            "PUT " + api + "/driveway": {"body": {"ok": True, "camera": cam("driveway", "Driveway Cam")}},
            "DELETE " + api + "/driveway": {"body": {"ok": True, "removed": "driveway"}}},
            "steps": [{"set": {"Name": "Driveway Cam"}}, {"press": "Save"}, {"press": "Delete Camera…"}]},
        "saved_without_ha": {"me": OWNER, "route": ["cameras", "driveway"], "live": {
            "GET " + api: {"body": state(ha={"set_up": False, "connected": False})}}},
        "gone": {"me": OWNER, "route": ["cameras", "nope"], "live": {"GET " + api: {"body": state()}}},
        "protect_one": {"me": OWNER, "route": ["cameras", "front"], "live": {"GET " + api: {"body": state()}}},
    }
    (d / "scenario.json").write_text(json.dumps(scenario))
    run = subprocess.run(["node", str(d / "script.mjs"), str(d / "mantel-settings.mjs"), str(d / "scenario.json"), str(d / "settings/cameras.mjs")],
                         capture_output=True, text=True, timeout=60)
    assert run.returncode == 0, run.stderr
    return json.loads(run.stdout)


def rows(p):
    return [r for g in p["groups"] if isinstance(g, dict) and g.get("kind") == "group" for r in g["rows"]]


def group(p, header):
    return next(g for g in p["groups"] if isinstance(g, dict) and g.get("header") == header)


def labels(p):
    return [r["label"] for r in rows(p)]


def body_of(res, press, method):
    [call] = [c for c in res[press]["calls"] if c["key"].startswith(method)]
    return call["body"]


def test_the_cameras_page_lists_the_direct_cameras_and_offers_add_camera(got):
    p = got["list"]["page"]
    assert p["title"] == "Cameras"
    by = {r["label"]: r for r in rows(p)}
    assert by["Driveway"]["kind"] == "nav" and by["Driveway"]["href"] == "#/mantel/cameras/driveway"
    assert by["Driveway"]["sub"] == f"Porch · {HOST}:554" and by["Driveway"]["value"] == "On"
    # a Protect camera is listed, but changed on its own page
    assert by["Front Door"]["kind"] == "info" and by["Front Door"]["sub"] == "Porch · UniFi Protect"
    assert by["Add Camera"]["kind"] == "nav" and by["Add Camera"]["href"] == "#/mantel/cameras/add"
    assert group(p, "Direct Cameras")["footer"] is None
    # nothing yet, and no Home Assistant: the page says there is no motion source
    q = got["list_nothing_yet_without_ha"]["page"]
    foot = group(q, "Direct Cameras")["footer"]
    assert "No direct cameras yet." in foot and "Without Home Assistant there is no motion source" in foot and "confirm it is you first" in foot
    assert "Add Camera" in labels(q)


def test_under_the_ha_app_the_page_says_cameras_come_from_home_assistant_and_has_no_add(got):
    p = got["ha_app"]["page"]
    g = group(p, "Cameras")
    assert "come from Home Assistant" in g["footer"] and "Generic Camera" in g["footer"]
    assert g["links"] == ["https://www.home-assistant.io/integrations/generic/"]
    assert labels(p) == [] and "Add Camera" not in labels(p)
    # the address of Add Camera itself says the same, with nothing to fill in
    add = got["ha_app_add"]["page"]
    assert labels(add) == [] and "come from Home Assistant" in group(add, "Cameras")["footer"]
    # Docker or the LXC without go2rtc says what is missing
    foot = [g["footer"] for g in got["no_go2rtc"]["page"]["groups"]]
    assert any("without its video relay (go2rtc)" in f for f in foot) and "Add Camera" not in labels(got["no_go2rtc"]["page"])


def test_a_person_who_may_not_manage_cameras_gets_the_page_that_is_theirs(got):
    p = got["adult"]["page"]
    assert p["title"] != "Cameras" and "Add Camera" not in labels(p)


def test_add_camera_is_filled_tested_and_added_with_the_login_sent_once(got):
    res = got["add"]
    p = res["page"]
    assert p["title"] == "Add Camera" and p["back"] == ["Cameras", "#/mantel/cameras"]
    assert labels(p) == ["Name", "Area", "RTSP Address", "Sub-Stream (Optional)", "User Name", "Password", "Test", "Motion", "Person", "Doorbell",
                         "Use Suggested Sensors", "Add Camera"]
    by = {r["label"]: r for r in rows(p)}
    assert by["Password"]["type"] == "password" and by["RTSP Address"]["type"] == "url"
    assert [o[1] for o in by["Area"]["options"]] == ["None", "Porch", "Kitchen"]
    # a sensor already linked to another camera is not on offer; one with an area says it
    assert [o[1] for o in by["Motion"]["options"]] == ["None", "Driveway Motion (Porch)", "Driveway Person"]
    foot = group(p, "Notify For")["footer"]
    assert "Frigate" in foot and "doorbell pop-up" in foot and "Sensors whose names begin with the camera’s are suggested" in foot
    # Test sent what was typed, with no sensors, and showed the picture
    sent = body_of(res, "Test", "POST")
    assert sent == {"name": "Driveway", "area_id": None, "address": f"rtsp://{HOST}:554/stream1", "low_address": "", "username": "viewer",
                    "password": "Fictional-Pw"}, "Test sends the boxes and no sensors"
    shot = got["add"]["after_test"]
    flash = [g for g in shot["groups"] if isinstance(g, dict) and g.get("tag") == "p"]
    assert flash and flash[0]["_text"] == "It works: H264 video and PCMA audio."
    img = [g for g in shot["groups"] if isinstance(g, dict) and g.get("tag") == "div"][0]["kids"][0]
    assert img["attrs"]["src"] == "data:image/jpeg;base64,/9j/AAAA"
    # Add Camera sent the boxes and the suggested Motion sensor
    sent = body_of(res, "Add Camera", "POST")
    assert sent == {"name": "Driveway", "area_id": None, "address": f"rtsp://{HOST}:554/stream1", "low_address": "", "username": "viewer",
                    "password": "Fictional-Pw", "sensors": {"motion": "binary_sensor.driveway_motion", "person": None, "doorbell": None}}
    assert res["Add Camera"]["hash"] == "#/mantel/cameras/driveway", "then its own page"


def test_a_test_that_fails_says_why_in_the_servers_words(got):
    shot = got["test_fails"]["after_test"]
    flash = [g for g in shot["groups"] if isinstance(g, dict) and g.get("tag") == "p"]
    assert flash[0]["_text"] == "The camera refused the user name or password." and flash[0]["attrs"]["role"] == "alert"
    assert not [g for g in shot["groups"] if isinstance(g, dict) and g.get("tag") == "div"], "no picture"


def test_a_saved_cameras_page_never_shows_its_login_and_a_change_leaves_blank_boxes_out(got):
    res = got["saved"]
    p = res["page"]
    assert p["title"] == "Camera"
    by = {r["label"]: r for r in rows(p)}
    assert by["Address"]["value"] == f"{HOST}:554" and by["Sign-In"]["value"] == "Saved" and by["Id"]["value"] == "camera.mantel_driveway"
    assert by["User Name"]["placeholder"] == "Saved" and by["Password"]["placeholder"] == "Saved" and by["RTSP Address"]["placeholder"] == f"Saved: rtsp://{HOST}:554"
    assert "Remove the Saved Sign-In" in by and by["Person"]["value"] == "binary_sensor.driveway_person"
    assert "Fictional-Pw" not in json.dumps(p) and "viewer" not in json.dumps(p)
    sent = body_of(res, "Save", "PUT")
    assert sent == {"name": "Driveway Cam", "area_id": "porch",
                    "sensors": {"motion": None, "person": "binary_sensor.driveway_person", "doorbell": None}}
    assert [c["key"] for c in res["Delete Camera…"]["calls"]] == ["DELETE " + "/api/cameras/rtsp/driveway"]
    assert res["Delete Camera…"]["hash"] == "#/mantel/cameras"


def test_without_home_assistant_the_page_says_there_is_no_motion_source(got):
    p = got["saved_without_ha"]["page"]
    notify = group(p, "Notify For")
    assert "Without Home Assistant there is no motion source" in notify["footer"]
    assert [(r["label"], r["kind"], r["value"]) for r in notify["rows"]] == [("Person", "info", "Driveway Person")], "what is linked stays shown, not editable"
    assert got["gone"]["page"]["groups"][-1]["footer"] == "That camera is no longer here."
    assert got["protect_one"]["page"]["groups"][-1]["footer"] == "That camera is no longer here.", "a Protect camera is changed on Protect's page"


def test_what_the_page_sends(got):
    b = got["_body"]
    assert b["new"] == {"name": "Driveway", "area_id": "porch", "address": "rtsp://h/s", "low_address": "", "username": "u", "password": "p",
                        "sensors": {"motion": "binary_sensor.m", "person": None, "doorbell": None}}
    assert b["saved_blank"] == {"name": "Driveway", "area_id": None, "sensors": {"motion": None, "person": None, "doorbell": None}}
    assert b["saved_changed"] == {"name": "D", "area_id": None, "address": "rtsp://h/new", "low_address": "", "password": "new", "clear_login": True,
                                  "sensors": {"motion": None, "person": None, "doorbell": None}}, "a saved camera always sends its sensors"
    assert "sensors" not in b["no_ha"], "without Home Assistant a new camera sends none"
    assert got["_says"] == ["It works: H264 video and PCMA audio, and the sub-stream.", "It works: H264 video."]
