"""The Mantel page uses current shared source, keeps user overrides and serves no HA port."""
import json

import pytest
from aiohttp.test_utils import TestClient, TestServer

from mantel_server.identity.auth import SESSION_COOKIE
from mantel_server.config import Config, REPO
from mantel_server.server import build_app
from mantel_server.store import Store


@pytest.fixture
async def current(tmp_path):
    store = Store(tmp_path / "db")
    store.link("fictional-owner", "owner")
    cookie = store.create_session("fictional-owner", 60)
    cfg = Config(data_dir=tmp_path, hk_files=tmp_path / "user-files", fixtures=tmp_path / "fixtures")
    async with TestClient(TestServer(build_app(cfg, "unused", store=store, connect_ha=False))) as client:
        client.session.cookie_jar.update_cookies({SESSION_COOKIE: cookie})
        yield client, cfg
    store.db.close()


async def test_current_canonical_and_shared_modules_are_served(current):
    client, cfg = current
    assert cfg.hk_frontend == REPO / "web/hk"
    for url, source in json.loads((cfg.web / "shared-assets.json").read_text()).items():
        response = await client.get("/hk/" + url)
        assert response.status == 200
        assert await response.read() == (cfg.web / source).read_bytes()
        assert response.headers["Cache-Control"] == "no-cache"
    response = await client.get("/hk/cards/hk-base.js")
    assert await response.read() == (cfg.hk_frontend / "cards/hk-base.js").read_bytes()
    assert (await client.get("/hk/modules/hk-ha-client.js")).status == 404
    cards = await (await client.get("/api/hk-cards")).json()
    assert "hk-base.js" in cards["core"] and "hk-stat-card" in cards["lazy"]["hk-stat.js"]


async def test_user_override_still_wins(current):
    client, cfg = current
    path = cfg.hk_files / "modules/hk-client.js"
    path.parent.mkdir(parents=True)
    path.write_text("// user's override")
    assert await (await client.get("/hk/modules/hk-client.js")).text() == "// user's override"


async def test_manifest_cannot_escape_web_root(current, tmp_path):
    client, cfg = current
    outside = tmp_path / "outside.js"
    outside.write_text("not for serving")
    # Even a malformed trusted manifest cannot turn /hk into an arbitrary file reader.
    client.app["shared_assets"]["modules/escape.js"] = str(outside)
    assert (await client.get("/hk/modules/escape.js")).status == 404


async def test_assets_still_require_a_session(current):
    client, _ = current
    client.session.cookie_jar.clear()
    assert (await client.get("/hk/modules/hk-card-state.js")).status == 401


async def test_every_view_of_a_dashboard_is_the_view_host_page(current):
    client, cfg = current
    page = (cfg.web / "home.html").read_bytes()
    for path in ("/dashboard-proof/home", "/dashboard-proof/lights", "/dashboard-kitchen/room-kitchen", "/lovelace/home"):
        response = await client.get(path)
        assert response.status == 200, path
        assert await response.read() == page, path
    # the view host is shared code, served at the same /hk URL the HA build publishes it at
    response = await client.get("/hk/shell/hk-view-host.js")
    assert await response.read() == (cfg.hk_frontend / "shell/hk-view-host.js").read_bytes()
    # not a dashboard: no page (an API path, a path without a hyphen)
    assert (await client.get("/api/nothing")).status == 404
    assert (await client.get("/settings/general")).status == 404
