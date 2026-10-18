"""hk_core.live_tv_guide: the XMLTV guide, parsed once for every host (the HA feature's own suite,
tests/py/test_feature_live_tv_guide.py, runs the same code through the HACS build)."""
from datetime import datetime, timedelta, timezone

from hk_core.live_tv_guide import network_of, now_next, parse_xmltv

# programmes around NOW (the parser keeps only what has not ended), so the test never ages out
START = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)


def _t(d):
    return d.strftime("%Y%m%d%H%M%S +0000")


XML = f"""<?xml version="1.0"?>
<tv>
  <channel id="c1"><display-name>4.1</display-name><display-name>NATIONAL BROADCASTING COMPANY</display-name></channel>
  <programme start="{_t(START)}" stop="{_t(START + timedelta(hours=1))}" channel="c1"><title>Noon News</title></programme>
  <programme start="{_t(START + timedelta(hours=1))}" stop="{_t(START + timedelta(hours=2))}" channel="c1"><title>Afternoon Show</title></programme>
</tv>""".encode()


def test_guide_is_keyed_by_channel_number_with_the_short_network_name():
    guide = parse_xmltv(XML)
    assert "4.1" in guide
    assert guide["4.1"]["network"] == "NBC"
    assert [p["title"] for p in guide["4.1"]["programmes"]] == ["Noon News", "Afternoon Show"]
    assert network_of(["4.1", "NATIONAL BROADCASTING COMPANY"]) == "NBC"


def test_now_and_next():
    progs = parse_xmltv(XML)["4.1"]["programmes"]
    cur, nxt = now_next(progs, START + timedelta(minutes=30))
    assert cur["title"] == "Noon News" and nxt["title"] == "Afternoon Show"
