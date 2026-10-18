import inspect

import pytest

from mantel_server import config, __main__ as entry


def test_listen_address_is_loopback_and_not_configurable():
    assert config.Config().host == "127.0.0.1"
    with pytest.raises(SystemExit):
        config.parse_args(["--host", "0.0.0.0"])


def test_override_parsing():
    cfg = config.parse_args(["--override", "sensor.*_distance=1", "--default-interval", "0.5"])
    assert cfg.overrides == [("sensor.*_distance", 1.0)] and cfg.default_interval == 0.5


def test_missing_token_stops_with_a_message(tmp_path, capsys):
    rc = entry.main(["--token-file", str(tmp_path / "missing"), "--port", "0"])
    assert rc == 2
    assert "not found" in capsys.readouterr().err


def test_ha_client_source_has_no_service_call_path():
    # P3.3: the state connection (HaClient and its check_outgoing) still has no service-call path at all;
    # the ONE command path, HaCommander, cannot even be constructed while commands are off (the default).
    from mantel_server import ha_client
    assert "call_service" not in inspect.getsource(ha_client.HaClient)
    assert "call_service" not in inspect.getsource(ha_client.check_outgoing)
    assert config.Config().commands_enabled is False and config.parse_args([]).commands_enabled is False
    assert ha_client.commander_for(config.Config(), "fictional", frozenset({"call_service"})) is None
    with pytest.raises(ha_client.CommandsDisabled):
        ha_client.HaCommander(config.Config(), "fictional", frozenset({"call_service"}))
    assert config.parse_args(["--commands-enabled"]).commands_enabled is True


# -- container mode (packaging): an explicit, guarded way past loopback ------------------------------------
def test_default_is_still_loopback_with_no_public_url():
    cfg = config.parse_args([])
    assert cfg.host == "127.0.0.1" and cfg.public_url == "" and cfg.allowed_hosts == ()
    assert cfg.client_id == "http://127.0.0.1:8765/" and cfg.redirect_uri == "http://127.0.0.1:8765/auth/callback"
    assert cfg.host_allowed("127.0.0.1") and cfg.host_allowed("localhost") and not cfg.host_allowed("mantel.example.com")


def test_listen_beyond_loopback_needs_an_https_public_url():
    for argv in (["--listen", "0.0.0.0"], ["--listen", "0.0.0.0", "--public-url", "http://mantel.example.com/"],
                 ["--listen", "0.0.0.0", "--public-url", "mantel.example.com"]):
        with pytest.raises(SystemExit):
            config.parse_args(argv)
    cfg = config.parse_args(["--listen", "0.0.0.0", "--public-url", "https://mantel.example.com/"])
    assert cfg.host == "0.0.0.0"


def test_public_url_and_allow_host_alone_are_refused():
    for argv in (["--public-url", "https://mantel.example.com/"], ["--allow-host", "x.example"]):
        with pytest.raises(SystemExit):
            config.parse_args(argv)


def test_container_mode_names_the_public_address_and_extra_hosts():
    cfg = config.parse_args(["--listen", "0.0.0.0", "--public-url", "https://Mantel.Example.com/",
                             "--allow-host", "192.0.2.10"])
    assert cfg.client_id == "https://Mantel.Example.com/" and cfg.redirect_uri == "https://Mantel.Example.com/auth/callback"
    assert cfg.host_allowed("mantel.example.com") and cfg.host_allowed("192.0.2.10") and cfg.host_allowed("127.0.0.1")
    assert not cfg.host_allowed("evil.example") and not cfg.host_allowed("mantel.example.com.evil.example")


def test_listening_on_loopback_explicitly_needs_nothing_else():
    assert config.parse_args(["--listen", "127.0.0.1"]).host == "127.0.0.1"


async def test_host_middleware_follows_the_configured_names():
    from aiohttp import web
    from aiohttp.test_utils import TestClient, TestServer
    from mantel_server.server import Hub, loopback_only

    async def ok(request):
        return web.Response(text="ok")

    cfg = config.parse_args(["--listen", "0.0.0.0", "--public-url", "https://mantel.example.com/"])
    app = web.Application(middlewares=[loopback_only])
    app["hub"] = Hub(cfg)
    app.router.add_get("/", ok)
    async with TestClient(TestServer(app)) as c:
        assert (await c.get("/", headers={"Host": "mantel.example.com"})).status == 200
        assert (await c.get("/", headers={"Host": "evil.example"})).status == 403
        assert (await c.get("/", headers={"Host": "mantel.example.com", "Origin": "https://evil.example"})).status == 403
        assert (await c.get("/", headers={"Host": "mantel.example.com", "Origin": "https://mantel.example.com"})).status == 200
