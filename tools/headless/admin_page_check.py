"""Offline check of the admin page (/admin) in an isolated headless Chrome, on a fictional house.

Run: ~/.venvs/mantel/bin/python tools/headless/admin_page_check.py [--shots DIR]
No Home Assistant, no real database, no fonts or fixtures from the house: the server runs on a temp folder
with fictional Owner/Adult accounts and every request the browser makes must stay on that server (any
other host is blocked and counted). Signs in as the Owner on a phone-sized screen and drives the page like a
person: renders every section; sets and changes "my PIN" (the change goes through the "confirm it is you"
step-up with a TOTP code); sets up an authenticator app; revokes another session; creates a person, changes
their role, disables them; revokes a wall tablet; adds and removes a grant and sets a person's rooms; creates a
service account (the credential is shown once) and revokes it; filters and pages the audit; enrols the browser
as a wall tablet and revokes that tablet. Then signs in as the Adult and checks that only "Me" exists (and that
the APIs behind the hidden sections refuse). No horizontal scroll, no CSP violation, no browser exception.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "hosts/server"))
sys.path.insert(0, str(ROOT / "tests"))
import aiohttp  # noqa: E402
from aiohttp.test_utils import TestServer  # noqa: E402
from argon2 import PasswordHasher  # noqa: E402
from cdp import Browser  # noqa: E402
from mantel_server import admin_page  # noqa: E402
from mantel_server.accounts import totp  # noqa: E402
from mantel_server.config import Config  # noqa: E402
from mantel_server.server import build_app  # noqa: E402
from mantel_server.store import Store  # noqa: E402
from test_connections import FakeHa  # noqa: E402

PASSWORD = "fictional password for the kid"      # fictional; at least 12 characters
SECTIONS = ["Me", "Connections", "People", "Devices", "Your files", "Roles & grants", "Service accounts", "Audit"]
HA_TOKEN = "fictional-admin-check-ha-token"     # the fake Home Assistant's; typed into the page, never shown again


def seed_of(secret: str) -> bytes:
    import base64
    return base64.b32decode(secret.replace(" ", "") + "=" * (-len(secret.replace(" ", "")) % 8))


async def until(pred, what: str, timeout: float = 15.0):
    end = time.time() + timeout
    while time.time() < end:
        got = pred()
        if asyncio.iscoroutine(got):
            got = await got
        if got:
            return got
        await asyncio.sleep(0.1)
    raise AssertionError("timed out waiting for " + what)


class Page:
    """Small helpers over the CDP browser: selectors in, clicks and typing out."""
    def __init__(self, browser: Browser, shots: Path):
        self.b, self.shots = browser, shots

    @staticmethod
    def q(sel: str) -> str:
        return f"document.querySelector({json.dumps(sel)})"

    async def wait(self, expr: str, what: str, timeout: float = 15.0):
        if not await self.b.wait(expr, timeout):
            try:
                seen = await self.b.eval("[document.querySelector('#status').textContent, document.querySelector('#dlg').outerHTML.slice(0, 300)]")
            except RuntimeError:
                seen = None
            raise AssertionError(f"timed out waiting for {what}; console: {json.dumps(self.b.console[-8:])}; page: {json.dumps(seen)}")

    async def js(self, expr: str):
        return await self.b.eval(expr)

    async def click(self, sel: str):
        await self.wait('!!' + self.q(sel), sel)
        await self.js(f"{self.q(sel)}.click(); true")

    async def fill(self, sel: str, value: str):
        await self.wait('!!' + self.q(sel), sel)
        await self.js(f"{self.q(sel)}.value = {json.dumps(value)}; true")

    async def choose(self, sel: str, value: str):
        await self.wait('!!' + self.q(sel), sel)
        await self.js(f"(() => {{ const e = {self.q(sel)}; e.value = {json.dumps(value)}; "
                      f"e.dispatchEvent(new Event('change', {{bubbles: true}})); return true; }})()")

    async def submit(self, sel: str):
        await self.wait('!!' + self.q(sel), sel)
        await self.js(f"{self.q(sel)}.requestSubmit(); true")

    async def confirm(self):
        await self.click("#dlg[open] [data-act=confirm]")
        await self.wait("!document.querySelector('#dlg[open]')", "the dialog to close")

    async def status(self) -> str:
        return await self.js("document.querySelector('#status').textContent")

    async def go(self, section: str):
        await self.js(f"location.hash = {json.dumps(section)}; true")
        await self.wait("!!" + self.q(f"#section-{section}"), f"section {section}")

    async def items(self, panel: str, text: str | None = None) -> int:
        t = json.dumps(text or "")
        return await self.js(f"[...document.querySelectorAll('#{panel} .item')].filter(e => e.textContent.includes({t})).length")

    async def act_in_item(self, panel: str, text: str, act: str):
        """Click `[data-act=act]` inside the first item of `panel` whose text contains `text`."""
        t, a = json.dumps(text), json.dumps(act)
        found = f"[...document.querySelectorAll('#{panel} .item')].find(e => e.textContent.includes({t}))"
        await self.wait(f"!!({found} && {found}.querySelector('[data-act={act}]'))", f"{act} in '{text}'")
        await self.js(f"{found}.querySelector('[data-act={act}]').click(); true")

    async def no_overflow(self, what: str):
        wide = await self.js("document.documentElement.scrollWidth - window.innerWidth")
        assert wide <= 1, f"{what}: the page scrolls sideways by {wide}px"

    async def shot(self, name: str, full: bool = True):
        path = self.shots / f"{name}.png"
        await self.b.screenshot(str(path), full=full)
        return str(path)


async def check(shots: Path) -> dict:
    out: dict = {"shots": []}
    with tempfile.TemporaryDirectory(prefix="mantel-admin-page-") as folder:
        base = Path(folder)
        cfg = Config(data_dir=base / "data", secrets_dir=base / "secrets", fixtures=base / "fixtures",
                     hk_files=base / "user-files", default_screen="dashboard-proof", ha_url="",
                     token_file=base / "no-ha-token", ma_token_file=base / "no-ma-token")
        store = Store(cfg.data_dir / "proof.db")
        app = build_app(cfg, "", store=store, connect_ha=False)     # first run: Home Assistant not set up yet
        app["accounts"].hasher = PasswordHasher(time_cost=1, memory_cost=8, parallelism=1)
        admin_page.register(app, app["hub"])
        acc, sessions, audit = app["accounts"], app["sessions"], app["audit"]
        app["hub"].registry.load([{"area_id": "kitchen", "name": "Kitchen"}, {"area_id": "loft", "name": "Loft"}], [], [])
        owner = await acc.create_user("owner-fic", "Fictional Owner", "owner", PASSWORD)
        adult = await acc.create_user("adult-fic", "Fictional Adult", "adult", PASSWORD)
        store.link("fictional-ha-user", "adult", "Fictional HA Person")
        other = sessions.create(owner, "lan", "password", user_agent="Mozilla/5.0 (iPhone) Safari/605.1", source_ip="192.0.2.7")
        mine = sessions.create(owner, "lan", "password", user_agent="Mozilla/5.0 (Macintosh; Mac OS X) Chrome/130")
        adult_session = sessions.create(adult, "lan", "password")
        tablet_id, _, _ = app["devices"].enroll("Loft tablet", "wall_tablet", "Loft", owner, "192.0.2.50")
        for i in range(30):                                  # enough rows for two pages of 25
            audit.record(principal=None, kind="service", action="light.turn_on", targets=[f"light.fictional_{i}"],
                         decision="allowed", reason="granted", result="ok", actor=adult, actor_name="Fictional Adult")
        for i in range(3):
            audit.record(principal=None, kind="service", action="lock.unlock", targets=["lock.fictional_door"],
                         decision="denied", reason="explicit_deny", actor="child-id", actor_name="Fictional Child")

        fake_ha = FakeHa([HA_TOKEN])              # a fictional Home Assistant on loopback, for Connections
        ha_url = await fake_ha.start()
        async with TestServer(app) as server:
            origin = str(server.make_url("")).rstrip("/")

            # signed out: sent to /login, nothing else served
            async with aiohttp.ClientSession() as http:
                r = await http.get(origin + "/admin", allow_redirects=False)
                assert r.status == 302 and r.headers["Location"] == "/login?next=/admin", r.status
                assert (await http.get(origin + "/admin/admin.js", allow_redirects=False)).status == 401
            out["signed_out"] = "302 /login"

            # ---------------------------------------------------------------- the Owner, on a phone
            async with Browser(width=390, height=844, port=9347) as browser:
                await browser.restrict_origin(origin)
                p = Page(browser, shots)
                await browser.open(origin + "/admin", mine.access)
                await p.wait("window.__adminReady === true", "the page to start")
                out["nav"] = await p.js("[...document.querySelectorAll('#nav button')].map(b => b.textContent)")
                assert out["nav"] == SECTIONS, out["nav"]
                out["who"] = await p.js("document.querySelector('#who').textContent")
                assert out["who"] == "Fictional Owner · Owner · home network", out

                # ---- Connections: first run lands here while Home Assistant is not set up
                await p.wait("!!document.querySelector('#section-connections #p-conn-ha')", "Connections on first run")
                assert "not set up" in await p.js("document.querySelector('#p-conn-ha').textContent")
                await p.fill("#p-conn-ha [name=ha-url]", ha_url)
                await p.fill("#p-conn-ha [name=ha-token]", "wrong-token")
                await p.click("#p-conn-ha [data-act=ha-token-test]")
                await p.wait("document.querySelector('#conn-result-ha').textContent.includes('did not accept the token')", "a plain refusal")
                await p.fill("#p-conn-ha [name=ha-token]", HA_TOKEN)
                await p.click("#p-conn-ha [data-act=ha-token-test]")
                await p.wait("document.querySelector('#conn-result-ha').textContent.includes('It works')", "the test result")
                out["connections_test"] = await p.js("document.querySelector('#conn-result-ha').textContent")
                assert "mantel-server" in out["connections_test"] and "2 entities" in out["connections_test"], out
                await p.click("#p-conn-ha [data-act=ha-token-save]")
                await p.wait("document.querySelector('#p-conn-ha') && document.querySelector('#p-conn-ha').textContent.includes('Connected as mantel-server')", "the saved connection")
                assert (cfg.connections_dir / "ha.connection").is_file()
                body = await p.js("document.body.textContent + [...document.querySelectorAll('input')].map(i => i.value).join(' ')")
                assert HA_TOKEN not in body                                   # never shown again, not left in an input
                await p.no_overflow("Connections")
                out["shots"].append(await p.shot("admin-connections"))
                # Connect to Home Assistant (OAuth): HA's own page is another origin (blocked here), so the hop
                # back is made by hand; the page then shows the pending connection and saves it
                start = await p.js(f"""fetch('/api/connections/ha/oauth/start', {{method: 'POST', credentials: 'same-origin',
                    headers: {{'Content-Type': 'application/json', 'X-CSRF-Token': {json.dumps(mine.csrf)}}},
                    body: JSON.stringify({{url: {json.dumps(ha_url)}}})}}).then(r => r.json())""")
                from urllib.parse import parse_qs, urlparse
                state = parse_qs(urlparse(start["authorize_url"]).query)["state"][0]
                fake_ha.codes["fictional-code"] = ("fictional-access", "fictional-refresh")
                async with aiohttp.ClientSession() as http:
                    r = await http.get(f"{origin}/auth/connection/callback", params={"state": state, "code": "fictional-code"})
                    assert r.status == 200 and f"connection={start['pending']}" in await r.text()
                await browser.open(origin + f"/admin?connection={start['pending']}#connections", mine.access)
                await p.wait("!!document.querySelector('#p-conn-pending [data-act=ha-oauth-save]')", "the pending sign-in")
                assert "mantel-server" in await p.js("document.querySelector('#p-conn-pending').textContent")
                out["shots"].append(await p.shot("admin-connections-oauth", full=False))
                await p.click("#p-conn-pending [data-act=ha-oauth-save]")
                await p.wait("!document.querySelector('#p-conn-pending') && document.querySelector('#p-conn-ha').textContent.includes('Home Assistant sign-in')", "the OAuth connection saved")
                assert fake_ha.llat_names and "fictional-refresh" in fake_ha.revoked
                assert await p.js("location.search") == ""
                out["connections"] = {"tested": True, "saved_token": True, "saved_oauth": True}
                await p.go("me")

                # ---- Me
                await p.wait("document.querySelectorAll('#p-sessions .item').length === 2", "two sessions")
                out["sessions"] = await p.js("[...document.querySelectorAll('#p-sessions .item')].map(e => e.textContent)")
                assert any("this browser" in s and "Chrome on Mac" in s for s in out["sessions"]), out["sessions"]
                assert any("Safari on iPhone" in s and "192.0.2.7" in s for s in out["sessions"]), out["sessions"]
                await p.no_overflow("Me")
                out["shots"].append(await p.shot("admin-me"))
                await p.act_in_item("p-sessions", "iPhone", "revoke-session")           # revoke the other session
                await p.confirm()
                await until(lambda: sessions.get(other.session_id) is None, "the other session to be revoked")
                await p.wait("document.querySelectorAll('#p-sessions .item').length === 1", "one session left")
                assert sessions.get(mine.session_id) is not None
                out["session_revoked"] = True

                await p.fill("#p-pin [name=pin]", "2580")                                  # set my PIN
                await p.fill("#p-pin [name=pin2]", "2580")
                await p.submit("#p-pin form")
                await until(lambda: app["pins"].status(owner)["pin"], "the PIN to be saved")
                await p.wait("!!document.querySelector('#p-pin [data-act=remove-pin]')", "the PIN panel to show it is set")
                assert "PIN set." in await p.status()
                await p.fill("#p-pin [name=pin]", "13")                                    # a bad one never leaves the page
                await p.fill("#p-pin [name=pin2]", "13")
                await p.submit("#p-pin form")
                assert "4 to 8 digits" in await p.status()
                out["pin_set"] = True

                await p.click("#p-totp [data-act=enroll-totp]")                            # an authenticator app
                await p.wait("!!document.querySelector('#totp-secret')", "the TOTP secret")
                secret = await p.js("document.querySelector('#totp-secret').textContent")
                seed = seed_of(secret)
                await p.fill("#p-totp [name=totp-code]", totp(seed, time.time() - 30))
                await p.submit("#p-totp form")
                await until(lambda: acc.has_totp(owner), "TOTP to be confirmed")
                await p.wait("!!document.querySelector('#p-totp [data-act=remove-totp]')", "the TOTP panel to show it is on")
                out["totp_on"] = True

                # the change of PIN now needs a fresh factor: age my session, then the page asks and retries
                store.db.execute("UPDATE sessions SET fresh_factor_at = fresh_factor_at - 1000 WHERE id = ?", (mine.session_id,))
                store.db.commit()
                await p.fill("#p-pin [name=pin]", "8642")
                await p.fill("#p-pin [name=pin2]", "8642")
                await p.submit("#p-pin form")
                await p.wait("!!document.querySelector('#dlg[open] [name=totp]')", "the confirm-it-is-you dialog")
                out["stepup_title"] = await p.js("document.querySelector('#dlg h2').textContent")
                assert out["stepup_title"] == "Confirm it is you"
                assert (await app["pins"].verify_user(owner, "2580", ip=None))[0] == "ok"      # not changed yet
                out["shots"].append(await p.shot("admin-stepup", full=False))
                await p.fill("#dlg [name=totp]", totp(seed, time.time()))
                await p.submit("#dlg form")
                await p.wait("document.querySelector('#status').textContent === 'PIN changed.'", "the PIN to change after the step-up")
                assert (await app["pins"].verify_user(owner, "8642", ip=None))[0] == "ok"
                out["pin_changed_after_stepup"] = True

                await p.click("#p-passkeys [data-act=add-passkey]")                         # 127.0.0.1 cannot be a passkey RP
                await p.wait("document.querySelector('#status').textContent !== ''", "a passkey answer")
                out["passkey_on_ip"] = await p.status()
                assert "passkey" in out["passkey_on_ip"].lower(), out["passkey_on_ip"]

                # ---- People
                await p.go("people")
                await p.wait("document.querySelectorAll('#p-users .item').length === 3", "three people (owner, adult, HA)")
                await p.fill("#create-user [name=username]", "kid-fic")
                await p.fill("#create-user [name=fullname]", "Fictional Kid")
                await p.choose("#create-user [name=role]", "child")
                await p.fill("#create-user [name=password]", PASSWORD)
                await p.submit("#create-user")
                kid = await until(lambda: (acc.find_username("kid-fic") or {"id": None})["id"], "the new account")
                assert acc.get_user(kid)["role"] == "child" and acc.get_user(kid)["kind"] == "hk"
                await p.wait("[...document.querySelectorAll('#p-users .item')].some(e => e.textContent.includes('Fictional Kid'))", "the kid in the list")
                await p.choose(f"#p-users select[data-user='{kid}']", "guest")
                await until(lambda: acc.get_user(kid)["role"] == "guest", "the role change")
                await p.act_in_item("p-users", "Fictional Kid", "toggle-user")
                await p.confirm()
                await until(lambda: acc.get_user(kid)["disabled"], "the account to be disabled")
                await p.wait("[...document.querySelectorAll('#p-users .item.off')].some(e => e.textContent.includes('disabled'))", "disabled shown")
                ha_text = await p.js("document.querySelector('#p-halinks').textContent")
                assert "fictional-ha-user" in ha_text and "mantel-server link --ha-user-id" in ha_text, ha_text
                out["people"] = {"created": True, "role_changed": "guest", "disabled": True, "ha_link_shown": True}
                await p.no_overflow("People")
                out["shots"].append(await p.shot("admin-people"))

                # ---- Roles & grants
                await p.go("roles")
                await p.wait("document.querySelectorAll('#p-roles details[data-role]').length === 7", "seven roles")
                role_text = await p.js("document.querySelector('#p-roles details[data-role=owner]').textContent")
                assert "Owner" in role_text
                await p.js("document.querySelector('#add-grant-box').open = true; true")
                await p.choose("#grant-form [name=target_kind]", "roles")
                await p.choose("#grant-form [name=target_value]", "guest")
                await p.choose("#grant-form [name=resource_kind]", "area")
                await p.fill("#grant-form [name=resource]", "kitchen")
                await p.js("""document.querySelectorAll('#grant-form input[name=actions]').forEach(
                              i => { i.checked = ['view', 'control'].includes(i.value); }); true""")
                await p.fill("#grant-form [name=start]", "21:00")
                await p.fill("#grant-form [name=end]", "06:00")
                await p.submit("#grant-form")
                grant = await until(lambda: next(iter(app["rbac"].grants()), None), "the grant to be stored")
                assert (grant.effect, sorted(grant.actions), grant.resource, sorted(grant.roles)) == ("allow", ["control", "view"], "kitchen", ["guest"])
                assert grant.schedule and (grant.schedule.start, grant.schedule.end) == ("21:00", "06:00")
                await p.wait("document.querySelectorAll('#p-grants > ul > li').length === 1", "the grant in the list")
                gtext = await p.js("document.querySelector('#p-grants .item').textContent")
                assert "Allow view, control on area kitchen" in gtext and "21:00 to 06:00" in gtext, gtext
                await p.act_in_item("p-grants", "kitchen", "remove-grant")
                await p.confirm()
                await until(lambda: not app["rbac"].grants(), "the grant to be removed")
                await p.choose("#p-scopes [name=scope_kind]", "user")
                await p.choose("#p-scopes [name=scope_subject]", adult)
                await p.wait(f"!!document.querySelector('#scope-areas form[data-subject=\"{adult}\"] input[value=kitchen]')", "the rooms")
                await p.js("document.querySelector('#scope-areas input[value=kitchen]').checked = true; true")
                await p.submit("#scope-areas form")
                await until(lambda: app["rbac"].scopes("user", adult) == {"kitchen"}, "the rooms to be saved")
                out["roles"] = {"grant_added_and_removed": True, "rooms_saved": ["kitchen"]}
                await p.no_overflow("Roles")
                out["shots"].append(await p.shot("admin-roles"))

                # ---- Service accounts
                await p.go("service")
                await p.fill("#create-service [name=service-name]", "fictional-ha")
                await p.submit("#create-service")
                await p.wait("!!document.querySelector('#service-token')", "the credential")
                token = await p.js("document.querySelector('#service-token').textContent")
                assert token.startswith("msvc_"), token
                accounts = app["service_accounts"].list()
                assert [a["name"] for a in accounts] == ["fictional-ha"] and accounts[0]["scopes"] == ["linked"]
                assert token not in "\n".join(store.db.iterdump())             # only its hash is stored
                await p.no_overflow("Service accounts")
                out["shots"].append(await p.shot("admin-service"))
                await p.click("[data-act=dismiss-token]")
                await p.wait("!document.querySelector('#service-token')", "the credential to go")
                await p.go("me")
                await p.go("service")                                          # shown once: not again
                await p.wait("document.querySelectorAll('#p-service .item').length === 1", "the account")
                assert token not in await p.js("document.body.textContent")
                await p.act_in_item("p-service", "fictional-ha", "revoke-service")
                await p.confirm()
                await until(lambda: app["service_accounts"].list()[0]["revoked"] is not None, "the account to be revoked")
                out["service"] = {"credential_shown_once": True, "revoked": True}

                # ---- Audit
                await p.go("audit")
                await p.wait("document.querySelectorAll('#audit-table tbody tr').length === 25", "page one of the audit")
                first_ids = await p.js("[...document.querySelectorAll('#audit-table tbody tr')].map(r => +r.dataset.id)")
                assert first_ids == sorted(first_ids, reverse=True)
                await p.js("document.querySelector('[data-act=audit-older]').click(); true")
                await p.wait("!!document.querySelector('#audit-pager').textContent.includes('Page 2')", "page two")
                second_ids = await p.js("[...document.querySelectorAll('#audit-table tbody tr')].map(r => +r.dataset.id)")
                assert second_ids and max(second_ids) < min(first_ids)
                await p.js("document.querySelector('[data-act=audit-newer]').click(); true")
                await p.wait("!!document.querySelector('#audit-pager').textContent.includes('Page 1')", "back to page one")
                await p.choose("#audit-filters [name=decision]", "denied")
                await p.submit("#audit-filters")
                await p.wait("document.querySelectorAll('#audit-table tbody tr').length === 3", "only the denied rows")
                assert await p.js("[...document.querySelectorAll('#audit-table tbody tr')].every(r => r.classList.contains('denied'))")
                await p.choose("#audit-filters [name=decision]", "")
                await p.choose("#audit-filters [name=actor]", adult)
                await p.submit("#audit-filters")
                await p.wait("document.querySelectorAll('#audit-table tbody tr').length === 25", "the Adult's rows")
                await p.js("document.querySelector('#audit-filters [name=since]').value = '2999-01-01T00:00'; true")
                await p.submit("#audit-filters")
                await p.wait("!!document.querySelector('#audit-table').textContent.includes('No entries match')", "an empty result")
                await p.js("document.querySelector('#audit-filters [data-act=audit-clear]').click(); true")
                await p.wait("document.querySelectorAll('#audit-table tbody tr').length === 25", "cleared filters")
                text = await p.js("document.querySelector('#audit-table').textContent")
                assert "rbac.grant.add" in text and "Fictional Owner (Owner)" in text, text[:400]      # ids shown as names
                out["audit"] = {"pages": 2, "denied_filter": 3, "actor_filter": 25, "empty_range": True}
                await p.no_overflow("Audit")
                out["shots"].append(await p.shot("admin-audit", full=False))

                # ---- Devices: revoke the Loft tablet, then make this browser a tablet
                await p.go("devices")
                await p.wait("document.querySelectorAll('#p-devices .item').length === 1", "the Loft tablet")
                await p.act_in_item("p-devices", "Loft tablet", "revoke-device")
                await p.confirm()
                await until(lambda: app["devices"].get(tablet_id)["revoked"] is not None, "the tablet to be revoked")
                await p.wait("!document.querySelector('#p-devices [data-act=revoke-device]')", "nothing left to revoke")
                await p.no_overflow("Devices")
                out["shots"].append(await p.shot("admin-devices"))
                await p.fill("#p-enroll [name=device-name]", "Kitchen tablet")
                await p.fill("#p-enroll [name=device-room]", "Kitchen")
                await p.submit("#p-enroll form")
                await p.confirm()
                await p.wait("!!document.querySelector('#p-enrolled')", "the enrolled message")
                devices = [d for d in app["devices"].list() if not d["revoked"]]
                assert [(d["name"], d["room"], d["role"]) for d in devices] == [("Kitchen tablet", "Kitchen", "wall_tablet")], devices
                assert sessions.get(mine.session_id) is None                          # the Owner was signed out here
                out["enrolled"] = devices[0]["name"]

                # ---- revoke that tablet from the Owner's page again (a fresh Owner session on this browser)
                again = sessions.create(owner, "lan", "password")
                await browser.send("Network.deleteCookies", name="mantel_device", domain="127.0.0.1")
                await browser.open(origin + "/admin?again=1#devices", again.access)
                await p.wait("window.__adminReady === true && !!document.querySelector('#section-devices')", "the Devices section again")
                await p.act_in_item("p-devices", "Kitchen tablet", "revoke-device")
                await p.confirm()
                await until(lambda: not [d for d in app["devices"].list() if not d["revoked"]], "the new tablet to be revoked")
                out["tablet_revoked"] = True

                # ---- one desktop-width look
                await browser.send("Emulation.setDeviceMetricsOverride", width=1100, height=900, deviceScaleFactor=1, mobile=False)
                await p.go("people")
                await p.wait("document.querySelectorAll('#p-users .item').length >= 3", "people on desktop")
                out["shots"].append(await p.shot("admin-people-desktop"))
                await p.go("audit")
                await p.wait("document.querySelectorAll('#audit-table tbody tr').length > 0", "audit on desktop")
                out["shots"].append(await p.shot("admin-audit-desktop", full=False))

                out["owner_console_problems"] = [c for c in browser.console if c.startswith("EXCEPTION") or "Content Security" in c
                                                 or "Refused to" in c]
                out["owner_blocked_requests"] = list(browser.blocked_requests)
                assert not out["owner_console_problems"], out["owner_console_problems"]
                assert not out["owner_blocked_requests"], out["owner_blocked_requests"]

            # ---------------------------------------------------------------- the Adult sees only Me
            async with Browser(width=390, height=844, port=9348) as browser:
                await browser.restrict_origin(origin)
                p = Page(browser, shots)
                await browser.open(origin + "/admin#people", adult_session.access)             # asks for People: gets Me
                await p.wait("window.__adminReady === true", "the page to start (Adult)")
                out["adult_nav"] = await p.js("[...document.querySelectorAll('#nav button')].map(b => b.textContent)")
                assert out["adult_nav"] == ["Me"], out["adult_nav"]
                out["adult_section"] = await p.js("document.querySelector('#app > div').dataset.section")
                assert out["adult_section"] == "me"
                await p.wait("document.querySelectorAll('#p-sessions .item').length === 1", "the Adult's session")
                assert await p.js("!document.querySelector('#section-people, #section-devices, #section-roles, #section-service, #section-audit')")
                out["adult_api"] = await p.js("""Promise.all(['/api/users', '/api/devices', '/api/rbac/grants', '/api/service-accounts', '/api/audit']
                  .map((u) => fetch(u, {credentials: 'same-origin'}).then((r) => r.status)))""")
                assert out["adult_api"] == [403] * 5, out["adult_api"]
                await p.fill("#p-pin [name=pin]", "9317")
                await p.fill("#p-pin [name=pin2]", "9317")
                await p.submit("#p-pin form")
                await until(lambda: app["pins"].status(adult)["pin"], "the Adult's PIN")
                await p.no_overflow("Adult Me")
                out["shots"].append(await p.shot("admin-me-adult"))
                out["adult_console_problems"] = [c for c in browser.console if c.startswith("EXCEPTION") or "Content Security" in c]
                assert not out["adult_console_problems"], out["adult_console_problems"]
        await fake_ha.close()
        store.db.close()
    return out


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--shots", help="folder for the screenshots (default: a new temp folder)")
    args = ap.parse_args()
    folder = Path(args.shots) if args.shots else Path(tempfile.mkdtemp(prefix="mantel-admin-shots-"))
    folder.mkdir(parents=True, exist_ok=True)
    print(json.dumps(asyncio.run(check(folder)), indent=1))
