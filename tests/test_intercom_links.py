"""One-time links (intercom/links.py): the token, expiry, who may fetch, how many times, HEAD, kill."""
import hashlib
import logging
from types import SimpleNamespace

import pytest

from mantel_server.intercom import links as lk
from mantel_server.intercom.links import Links
from mantel_server.intercom.spool import Spool

PEER = "10.0.0.5"
OTHER = "10.0.0.6"


class Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


@pytest.fixture
def clock():
    return Clock()


@pytest.fixture
def links(clock):
    return Links(cfg=SimpleNamespace(lan_networks=("10.0.0.0/8",)), clock=clock)


def spool(clock, seconds=1.0, finished=False):
    s = Spool(24000, 30, clock=clock)
    s.append(bytes(int(48000 * seconds)))
    if finished:
        s.finish()
    return s


def message(links, clock):
    return links.mint(spool(clock, finished=True), mode="message", finite=True, limit_s=30)


def live(links, clock):
    return links.mint(spool(clock), mode="live", finite=False, limit_s=60)


def test_token_is_43_url_safe_characters_and_never_repeats(links, clock):
    tokens = {live(links, clock)[0] for _ in range(50)}
    assert len(tokens) == 50
    for t in tokens:
        assert len(t) == 43 and all(c.isalnum() or c in "-_" for c in t)
    assert len(links) == 50


def test_only_the_hash_is_kept(links, clock):
    token, link = live(links, clock)
    assert token not in links._links
    assert hashlib.sha256(token.encode()).hexdigest() in links._links
    assert token not in repr(vars(links)) and token not in repr(vars(link))


def test_unknown_and_malformed_tokens_get_nothing(links, clock):
    live(links, clock)
    for bad in ("", "x", "A" * 43, "A" * 1000, None):
        assert links.claim(bad, PEER, "GET") is None


def test_first_get_claims_the_second_same_peer_get_works_the_third_does_not(links, clock):
    token, link = message(links, clock)
    assert links.claim(token, PEER, "GET") is link
    assert (link.peer, link.gets, link.claimed_at) == (PEER, 1, clock.t)
    assert links.claim(token, PEER, "GET") is link
    assert link.gets == 2
    assert links.claim(token, PEER, "GET") is None
    assert link.gets == 2


def test_another_peer_after_the_claim_gets_nothing_and_the_claimer_keeps_its_retry(links, clock):
    token, link = message(links, clock)
    assert links.claim(token, PEER, "GET") is link
    assert links.claim(token, OTHER, "GET") is None
    assert links.claim(token, OTHER, "HEAD") is None
    assert links.claim(token, PEER, "GET") is link


def test_head_never_claims(links, clock):
    token, link = message(links, clock)
    for _ in range(5):
        assert links.claim(token, PEER, "HEAD") is link
    assert (link.peer, link.gets, link.claimed_at) == (None, 0, None)
    assert links.claim(token, OTHER, "GET") is link               # still unclaimed: anyone allowed may claim it
    assert links.claim(token, OTHER, "HEAD") is link              # HEAD from the claimer is fine
    assert link.gets == 1


def test_other_methods_get_nothing(links, clock):
    token, link = message(links, clock)
    for m in ("POST", "PUT", "DELETE", "OPTIONS", "get"):
        assert links.claim(token, PEER, m) is None
    assert link.peer is None


def test_public_and_non_ip_peers_get_nothing(links, clock):
    token, link = message(links, clock)
    for peer in ("203.0.113.9", "8.8.8.8", "2001:db8::1", "", None, "not-an-ip", "172.17.0.1"):
        assert links.claim(token, peer, "GET") is None
        assert links.claim(token, peer, "HEAD") is None
    assert link.peer is None and link.gets == 0


def test_the_default_networks_apply_without_a_cfg(clock):
    plain = Links(clock=clock)
    token, link = message(plain, clock)
    assert plain.claim(token, "203.0.113.9", "GET") is None
    assert plain.claim(token, "192.168.1.20", "GET") is link


def test_the_peer_must_be_the_one_ma_resolves_to(clock):
    expected = ["10.0.0.5"]
    links = Links(cfg=SimpleNamespace(lan_networks=("10.0.0.0/8",)), clock=clock, expected_peer=lambda: expected[0])
    token, link = message(links, clock)
    assert links.claim(token, OTHER, "GET") is None
    assert links.claim(token, "::ffff:10.0.0.5", "GET") is link   # IPv4-mapped is the same address
    expected[0] = None                                            # no IP to compare with: any home address may
    token2, link2 = message(links, clock)
    assert links.claim(token2, OTHER, "GET") is link2


def test_unclaimed_expiry_live_20s_message_30s(links, clock):
    t_live, _ = live(links, clock)
    t_msg, m = message(links, clock)
    clock.t += lk.UNCLAIMED_LIVE - 0.1
    assert links.claim(t_live, PEER, "HEAD") is not None
    clock.t += 0.2
    assert links.claim(t_live, PEER, "GET") is None
    assert links.claim(t_msg, PEER, "HEAD") is m                  # a Message still has 10 s
    clock.t += 10
    assert links.claim(t_msg, PEER, "GET") is None
    assert len(links) == 0                                        # expired links are forgotten


def test_a_claimed_link_ends_15s_after_the_spool_ends(links, clock):
    token, link = live(links, clock)
    assert links.claim(token, PEER, "GET") is link
    clock.t += 25                                                 # past the unclaimed window: claimed links go on
    assert links.claim(token, PEER, "HEAD") is link
    link.spool.finish()
    clock.t += lk.AFTER_END - 0.1
    assert links.claim(token, PEER, "GET") is link                # the one retry
    clock.t += 0.2
    assert links.claim(token, PEER, "HEAD") is None


def test_a_claimed_message_lives_15s_from_its_claim(links, clock):
    token, link = message(links, clock)
    clock.t += 25
    assert links.claim(token, PEER, "GET") is link
    clock.t += lk.AFTER_END - 0.1
    assert links.claim(token, PEER, "GET") is link
    assert links.claim(token, PEER, "GET") is None                # both GETs used
    clock.t += 0.2
    assert links.claim(token, PEER, "HEAD") is None               # and 15 s after the claim it is gone


def test_the_hard_end_is_the_limit_plus_30s(links, clock):
    token, link = live(links, clock)                              # limit 60
    assert links.claim(token, PEER, "GET") is link
    clock.t += 60 + lk.LIMIT_GRACE - 0.1
    assert not links.expired(link)                                # the spool never ended: only the hard end counts
    clock.t += 0.2
    assert links.expired(link) and links.claim(token, PEER, "GET") is None


def test_a_dropped_spool_ends_its_link(links, clock):
    token, link = live(links, clock)
    link.spool.drop()
    assert links.claim(token, PEER, "GET") is None


def test_kill_makes_a_link_404_and_forgets_it(links, clock):
    token, link = message(links, clock)
    links.kill(link)
    assert link.dead and len(links) == 0
    assert links.claim(token, PEER, "GET") is None
    assert links.claim(token, PEER, "HEAD") is None
    links.kill(link)                                              # twice is harmless


def test_kill_all_and_sweep(links, clock):
    made = [live(links, clock) for _ in range(3)]
    old = made[0][1]
    clock.t += 21
    fresh_token, fresh = live(links, clock)                       # minting sweeps the expired
    assert len(links) == 1 and old.dead
    clock.t += 1
    links.sweep()
    assert len(links) == 1
    links.kill_all()
    assert len(links) == 0 and fresh.dead
    assert links.claim(fresh_token, PEER, "GET") is None


async def test_a_kill_wakes_a_waiting_reader(links, clock):
    import asyncio
    token, link = live(links, clock)
    task = asyncio.create_task(_drain(link))
    await asyncio.sleep(0.02)
    links.kill(link)
    assert await asyncio.wait_for(task, 1) == bytes(48000)


async def _drain(link):
    return b"".join([c async for c in link.spool.read(halt=lambda: link.dead)])


def test_the_token_is_never_logged(links, clock, caplog):
    caplog.set_level(logging.DEBUG)
    token, link = message(links, clock)
    links.claim(token, PEER, "HEAD")
    links.claim(token, PEER, "GET")
    links.claim(token, OTHER, "GET")
    links.claim(token, "203.0.113.9", "GET")
    links.kill(link)
    links.claim(token, PEER, "GET")
    assert any("intercom link claimed by 10.0.0.5" in r.getMessage() for r in caplog.records)
    for r in caplog.records:
        assert token not in r.getMessage() and token not in str(r.args) and token not in r.pathname


def test_events_are_per_link(links, clock):
    _, a = live(links, clock)
    _, b = live(links, clock)
    a.fetch_started.set()
    assert not b.fetch_started.is_set() and not a.fetch_ended.is_set()
    assert a.ended_early is False and a.dead is False
