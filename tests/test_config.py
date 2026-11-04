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


def test_missing_token_starts_unconnected_and_points_at_the_connections_page(tmp_path, capsys, monkeypatch):
    """Connections page (connections.py): no token file is no longer fatal; the server starts with HA not
    connected (it never tries one without a credential) and says where to set it up. The App's own
    credential file is still required."""
    started = []
    monkeypatch.setattr(entry.web, "run_app", lambda app, **kw: started.append(app))
    rc = entry.main(["--token-file", str(tmp_path / "missing"), "--port", "0", "--ha-url", "",
                     "--data-dir", str(tmp_path / "data"), "--secrets-dir", str(tmp_path / "secrets")])
    assert rc == 0 and len(started) == 1
    assert started[0]["hub"].ha._token == "" and started[0]["connections"].current("ha") is None
    assert "settings#/mantel/connections" in capsys.readouterr().out
    rc = entry.main(["--token-file", str(tmp_path / "missing"), "--port", "0", "--ha-managed-by-app",
                     "--data-dir", str(tmp_path / "data"), "--secrets-dir", str(tmp_path / "secrets")])
    assert rc == 2 and "App credential" in capsys.readouterr().err


def test_ha_client_source_has_no_service_call_path():
    # P3.3: the state connection (HaClient and its check_outgoing) still has no service-call path at all;
    # the ONE command path, HaCommander, cannot even be constructed while commands are off (the default).
    from mantel_server import ha_client
    # Observing a call_service EVENT does not add a command path. The outgoing
    # type allowlist (enforced for every frame) still refuses service calls.
    assert "call_service" not in ha_client.ALLOWED_TYPES
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


def test_stream_port_is_off_by_default_and_a_plain_port_when_given():
    """The Intercom's listener for Music Assistant (phase 17): 0 = never started; the packaging passes 8767 (HA App 8101)."""
    assert config.Config().stream_port == 0
    assert config.parse_args([]).stream_port == 0
    assert config.parse_args(["--stream-port", "8767"]).stream_port == 8767
    assert config.parse_args(["--stream-port", "65535"]).stream_port == 65535


def test_stream_port_must_be_a_real_port_that_nothing_else_uses():
    app = ["--ingress", "--listen", "0.0.0.0", "--public-url", "https://mantel.example.com/", "--allow-host", "*"]
    for bad in (["--stream-port", "-1"], ["--stream-port", "65536"], ["--stream-port", "x"],
                ["--stream-port", "8765"],                                              # the default --port
                ["--port", "9000", "--stream-port", "9000"],
                app + ["--direct-port", "8100", "--stream-port", "8100"],
                ["--connect", "--stream-port", "8766"],                                 # Mantel Connect's listener
                ["--connect", "--connect-port", "9100", "--stream-port", "9100"]):
        with pytest.raises(SystemExit):
            config.parse_args(bad)
    # a port that is not in use (Connect off, so 8766 is free) is fine, alongside direct access and Connect
    assert config.parse_args(["--stream-port", "8766"]).stream_port == 8766
    assert config.parse_args(app + ["--direct-port", "8100", "--stream-port", "8101"]).stream_port == 8101
    assert config.parse_args(["--connect", "--stream-port", "8767"]).stream_port == 8767
