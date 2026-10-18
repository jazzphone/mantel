"""The HK publish scan (hosts/ha/custom_components/hk_frontend/tools/publish/publish.py)
refuses private addresses, with ONE exception: 172.30.32.0/23, Home Assistant
Supervisor's internal "hassio" network (decision 24), which linked mode names."""
import importlib.util
import pathlib

import pytest

PATH = (pathlib.Path(__file__).resolve().parents[1]
        / "hosts/ha/custom_components/hk_frontend/tools/publish/publish.py")


@pytest.fixture(scope="module")
def scan_text():
    spec = importlib.util.spec_from_file_location("hk_publish_scan", PATH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return lambda line: mod.scan_texts([("page", line)])


@pytest.mark.parametrize("addr", ["172.30.32.5", "172.30.33.1", "172.30.33.255", "172.30.32.0/23"])
def test_hassio_network_passes(scan_text, addr):
    assert scan_text(f"http://{addr}:8099") == []


@pytest.mark.parametrize("addr", ["172.30.34.1", "172.30.31.1", "172.30.0.1", "172.30.320.1", "172.16.0.1",
                                  "172.31.255.1", "172.20.1.1", "192.168.1.5", "10.0.0.1"])
def test_other_private_ranges_still_rejected(scan_text, addr):
    assert scan_text(f"http://{addr}:8099"), addr
