"""AirPlay Groups' status page, read for Mantel's Connections screen (hk_core.music.airplay_groups). The fictional house."""
from hk_core.music import airplay_groups as AG


def speaker(name, **kw):
    out = {"id": "ap" + name.lower().replace(" ", ""), "name": name, "online": True, "available": True, "state": "idle",
           "group": None, "asks_password": True, "password_stored": True, "locked_out": False, "needs_setup": None,
           "monitoring_off": True, "ip": "192.0.2.20"}
    out.update(kw)
    return out


def page(**kw):
    body = {"at": 1_800_000_000, "version": "0.2.15", "uptime": 600,
            "addon": {"active": True, "reason": "", "addon_version": "0.2.15", "cli_version": "os27fix9", "ma_version": "2.10.11",
                      "seen": 1_800_000_000.5},
            "speakers": [speaker("Den HomePod"), speaker("Porch HomePod"), speaker("Studio HomePod")],
            "groups": [], "alerts": {"active": [], "recent": []}}
    body.update(kw)
    return body


def test_a_healthy_page_reads_as_the_row_shows_it():
    got = AG.read(page())
    assert got == {"version": "0.2.15",
                   "addon": {"on": True, "version": "0.2.15", "reason": None, "cli_version": "os27fix9", "ma_version": "2.10.11"},
                   "speakers": 3, "online": 3, "locked_out": [], "needs_setup": [], "groups": 0, "alerts": []}
    assert AG.healthy(got) and AG.locked_out(got) == ""


def test_what_is_wrong_is_named():
    body = page(speakers=[speaker("Den HomePod", locked_out=True), speaker("Porch HomePod", online=False),
                          speaker("Studio HomePod", locked_out=True, needs_setup=True), "junk", {"name": None, "locked_out": True}],
                addon={"active": False, "reason": "Music Assistant isn't running", "addon_version": "0.2.15"},
                groups=[{"names": ["Den HomePod", "Porch HomePod"], "playing": True}],
                alerts={"active": [{"at": 1, "title": "Den HomePod is locked out", "active": True}, {"title": "Den HomePod is locked out"}, "x"],
                        "recent": []})
    got = AG.read(body)
    assert got["addon"]["on"] is False and got["addon"]["reason"] == "Music Assistant isn't running"
    assert got["speakers"] == 4 and got["online"] == 2 and got["groups"] == 1
    assert got["locked_out"] == ["A speaker", "Den HomePod", "Studio HomePod"] and got["needs_setup"] == ["Studio HomePod"]
    assert got["alerts"] == ["Den HomePod is locked out"]
    assert not AG.healthy(got)
    assert AG.locked_out(got) == "A speaker, Den HomePod and Studio HomePod"
    assert AG.locked_out({"locked_out": ["Den HomePod", "Studio HomePod"]}) == "Den HomePod and Studio HomePod"


def test_something_else_at_the_address_is_not_the_page():
    for body in (None, [], {}, {"homepods": []}, {"addon": {}, "speakers": {}}, {"addon": "on", "speakers": []}):
        assert AG.read(body) is None
    assert AG.read({"addon": {}, "speakers": []})["speakers"] == 0


def test_the_alert_waits_ten_minutes():
    assert not AG.alert_due(None, 10_000) and not AG.alert_due(1000, 1000 + AG.ALERT_AFTER - 1)
    assert AG.alert_due(1000, 1000 + AG.ALERT_AFTER)
