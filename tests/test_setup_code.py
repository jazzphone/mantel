"""The first Owner's one-time setup code in the log (Docker, LXC, a plain server): issued at start and again
whenever the last one expired, only while no Owner exists, never in the HA App's Ingress mode (there the HA
administrator becomes the Owner). The code is in the log alone: not the audit, not the database in clear,
not a page. Fictional users, temp databases, a fake clock."""
import re
import sqlite3

from aiohttp.test_utils import TestClient, TestServer
from argon2 import PasswordHasher

from conftest import PASSWORD
from mantel_server import __main__ as entry
from mantel_server.identity.accounts import BOOTSTRAP_TTL, SETUP_LOGGER, announce_setup_code
from mantel_server.server import tick_once

CODE = re.compile(r"^\s{4}(\S{20,})$", re.M)
BODY = {"username": "avery", "name": "Fictional Owner", "password": PASSWORD}


def codes(records) -> list[str]:
    return [m.group(1) for r in records if r.name == SETUP_LOGGER for m in CODE.finditer(r.getMessage())]


def everything_stored(data_dir) -> str:
    out = []
    for path in sorted(data_dir.rglob("*.db")):
        db = sqlite3.connect(path)
        try:
            out += list(db.iterdump())
        finally:
            db.close()
    return "\n".join(out)


async def redeem(mantel, code):
    return (await mantel.post("/api/bootstrap", {**BODY, "token": code}, csrf=False)).status


async def test_start_logs_a_code_that_creates_the_first_owner(caplog, mantel):
    started = codes(caplog.get_records("setup"))
    assert len(started) == 1                                      # once, at start
    code = started[0]
    banner = next(r.getMessage() for r in caplog.get_records("setup") if r.name == SETUP_LOGGER)
    assert "no Owner yet" in banner and "/login" in banner and "mantel bootstrap" in banner
    # in the log alone: the database (the audit too) holds its hash only, and no page shows it
    assert code not in everything_stored(mantel.app["cfg"].data_dir)
    for path in ("/login", "/api/bootstrap"):
        assert code not in await (await mantel.get(path)).text()
    assert await redeem(mantel, code) == 200
    assert codes(caplog.records) == []                            # nothing else was logged with it


async def test_no_code_once_an_owner_exists(caplog, mantel):
    await mantel.user("sam", "owner")
    caplog.clear()
    assert announce_setup_code(mantel.app, startup=True) is None
    mantel.now[0] += BOOTSTRAP_TTL + 1                            # even after the start's code expired
    await tick_once(mantel.app, mantel.app["hub"])
    assert codes(caplog.records) == []
    assert mantel.store.db.execute("SELECT COUNT(*) FROM bootstrap_tokens").fetchone()[0] <= 1


async def test_the_owners_creation_ends_the_codes(caplog, mantel):
    code = codes(caplog.get_records("setup"))[0]
    assert await redeem(mantel, code) == 200
    mantel.now[0] += BOOTSTRAP_TTL + 1
    await tick_once(mantel.app, mantel.app["hub"])
    assert codes(caplog.records) == []
    assert mantel.store.db.execute("SELECT COUNT(*) FROM bootstrap_tokens").fetchone()[0] == 0


async def test_an_expired_code_is_replaced_by_a_new_logged_one(caplog, mantel):
    first = codes(caplog.get_records("setup"))[0]
    await tick_once(mantel.app, mantel.app["hub"])                # still valid: nothing new
    assert codes(caplog.records) == []
    mantel.now[0] += BOOTSTRAP_TTL + 1
    await tick_once(mantel.app, mantel.app["hub"])
    [second] = codes(caplog.records)
    assert second != first
    await tick_once(mantel.app, mantel.app["hub"])                # logged once, not every tick
    assert codes(caplog.records) == [second]
    assert await redeem(mantel, first) == 401
    assert await redeem(mantel, second) == 200


async def test_a_new_code_replaces_the_last_one(caplog, mantel):
    first = codes(caplog.get_records("setup"))[0]
    second = announce_setup_code(mantel.app, startup=True)        # e.g. the next start
    assert second and second != first and codes(caplog.records) == [second]
    assert await redeem(mantel, first) == 401
    assert await redeem(mantel, second) == 200


async def test_mantel_bootstrap_replaces_the_logged_code_and_the_tick_leaves_it(caplog, capsys, mantel):
    logged = codes(caplog.get_records("setup"))[0]
    mantel.store.db.commit()
    assert entry.main(["bootstrap", "--data-dir", str(mantel.app["cfg"].data_dir)]) == 0
    printed = CODE.search(capsys.readouterr().out).group(1)
    assert printed != logged
    await tick_once(mantel.app, mantel.app["hub"])                # a valid code exists: no new one logged
    assert codes(caplog.records) == []
    assert await redeem(mantel, logged) == 401
    assert await redeem(mantel, printed) == 200


async def _started(tmp_path, **cfg_args):
    """A whole app started and stopped with this Config; returns its data folder and its tick's result."""
    from mantel_server.config import Config
    from mantel_server.server import build_app
    from mantel_server.storage.store import Store

    cfg = Config(data_dir=tmp_path / "data", secrets_dir=tmp_path / "secrets", port=0, **cfg_args)
    store = Store(cfg.data_dir / "mantel.db")
    now = [1_000_000.0]
    app = build_app(cfg, "unused-fictional-token", store=store, connect_ha=False, clock=lambda: now[0])
    app["accounts"].hasher = PasswordHasher(time_cost=1, memory_cost=8, parallelism=1)
    try:
        async with TestClient(TestServer(app)):
            again = announce_setup_code(app, startup=True)
            now[0] += BOOTSTRAP_TTL + 1
            await tick_once(app, app["hub"])
    finally:
        store.db.close()
    db = sqlite3.connect(cfg.data_dir / "mantel.db")
    try:
        stored = db.execute("SELECT COUNT(*) FROM bootstrap_tokens").fetchone()[0]
    finally:
        db.close()
    return again, stored


async def test_never_in_the_ha_apps_ingress_mode(tmp_path, caplog):
    again, stored = await _started(tmp_path, ingress=True)             # the HA App: its administrator becomes the Owner
    assert again is None and stored == 0
    assert codes(caplog.records) == []
    assert not any(r.name == SETUP_LOGGER for r in caplog.records)


async def test_a_docker_install_with_mantel_connect_still_logs_one(tmp_path, caplog):
    """--connect implies ingress-style identity for the paired App's requests, but the install is Docker or the
    LXC: its first Owner still signs up at /login with a code from the log."""
    again, stored = await _started(tmp_path, connect=True, ingress=True, ingress_peers=())
    assert again and stored == 1
    assert len(codes(caplog.records)) == 3                               # start, the second issue, after expiry
