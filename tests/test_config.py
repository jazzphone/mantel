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
    from mantel_server import ha_client
    assert "call_service" not in inspect.getsource(ha_client)
