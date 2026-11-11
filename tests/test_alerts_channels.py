"""Phase 14's alert channels (docs/phase14/SYSTEM-ALERTS.md "The channels", "Tests"): each sender through an injected
transport (a fake SMTP class for email, a stubbed apprise for Apprise): the payload, mentions and HTML escaped, 429 and
retry, permanent and retryable refusals, the host checks at save and again at send, and no secret in any error."""
from __future__ import annotations

import asyncio
import json
import smtplib
import ssl
import sys
import types

import pytest

from mantel_server.alerts import center as C
from mantel_server.alerts.center import Center, ChannelError, Message
from mantel_server.alerts.channels import Invalid, apprise_, discord, notifiarr, telegram
from mantel_server.alerts.channels import email as mail
from mantel_server.alerts.store import Channels, Log, Settings
from mantel_server.storage.atrest import SecretBox
from mantel_server.storage.store import Store

HOOK = "https://discord.com/api/webhooks/123456789012345678/" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6"
TOKEN = "123456789:AAH-abcdefghijklmnopqrstuvwxyz0123456"
KEY = "ntf-0123456789abcdef-global"
CHANNEL_ID = 735481457153277994


def msg(title="Mantel · Home Assistant disconnected", body="Mantel can't reach it.\nMaple House · 3:05 pm",
        level="critical", link="https://m.example/connections", tag="system:ha.lost:") -> Message:
    return Message(title, body, level, link, tag)


def reply(status=200, obj=None, headers=None) -> tuple[int, dict, bytes]:
    return status, headers or {}, json.dumps(obj if obj is not None else {}).encode()


class Fake:
    """The injected transport: records every call, answers from a script (the last answer repeats; an exception in
    the script is raised, as the server's transport does for a network failure)."""

    def __init__(self, *answers):
        self.answers = list(answers) or [reply()]
        self.calls: list[tuple[str, str, dict, bytes]] = []

    async def __call__(self, method, url, headers, body):
        self.calls.append((method, url, headers, body))
        got = self.answers.pop(0) if len(self.answers) > 1 else self.answers[0]
        if isinstance(got, Exception):
            raise got
        return got

    @property
    def json(self) -> dict:
        return json.loads(self.calls[-1][3])


async def fails(coro) -> ChannelError:
    with pytest.raises(ChannelError) as got:
        await coro
    return got.value


# -- Discord ----------------------------------------------------------------------------------------------------------
async def test_discord_posts_an_embed_colored_by_level_and_pings_nobody():
    t = Fake(reply(200))
    atname = msg(title="Mantel · @everyone tablet is offline", level="warning")
    await discord.send(t, {}, {"url": HOOK}, atname)
    method, url, headers, _ = t.calls[0]
    assert (method, url) == ("POST", HOOK + "?wait=true") and headers["Content-Type"] == "application/json"
    p = t.json
    assert p["allowed_mentions"] == {"parse": []} and p["username"] == "Mantel"
    embed = p["embeds"][0]
    assert embed["title"] == "@everyone tablet is offline" and embed["color"] == discord.COLORS["warning"]
    assert embed["description"].startswith("Mantel can't reach it.") and embed["url"] == "https://m.example/connections"


def test_discord_checks_the_webhook_at_save():
    assert discord.clean({}, {"url": HOOK}, None) == ({}, {"url": HOOK, "main": HOOK})
    assert discord.clean({}, {}, {"url": HOOK})[1]["url"] == HOOK            # blank keeps the saved one
    for bad in ("http://discord.com/api/webhooks/123456789012345678/" + "A" * 30,
                "https://discord.com.evil.example/api/webhooks/123456789012345678/" + "A" * 30,
                "https://user:pw@discord.com/api/webhooks/123456789012345678/" + "A" * 30,
                "https://discord.com:8443/api/webhooks/123456789012345678/" + "A" * 30,
                HOOK + "?x=1", "https://discord.com/api/webhooks/1/short", "", "nonsense"):
        with pytest.raises(Invalid):
            discord.clean({}, {"url": bad}, None)


async def test_discord_refuses_a_tampered_saved_url_before_any_call():
    t = Fake()
    err = await fails(discord.send(t, {}, {"url": "https://evil.example/api/webhooks/123456789012345678/" + "A" * 30},
                                   msg()))
    assert err.permanent and t.calls == []


async def test_discord_429_carries_the_retry_after_and_other_refusals_are_sorted():
    err = await fails(discord.send(Fake(reply(429, {"retry_after": 2.5})), {}, {"url": HOOK}, msg()))
    assert err.retry_after == 2.5 and not err.permanent and "429" in err.message
    err = await fails(discord.send(Fake(reply(429, {}, {"Retry-After": "7"})), {}, {"url": HOOK}, msg()))
    assert err.retry_after == 7.0
    gone = await fails(discord.send(Fake(reply(404)), {}, {"url": HOOK}, msg()))
    assert gone.permanent and gone.message == "Discord said 404: the webhook was deleted"
    assert not (await fails(discord.send(Fake(reply(503)), {}, {"url": HOOK}, msg()))).permanent
    lost = await fails(discord.send(Fake(ChannelError("couldn't reach discord.com (ClientError)")), {},
                                    {"url": HOOK}, msg()))
    assert HOOK not in lost.message and not lost.permanent


# -- Telegram ---------------------------------------------------------------------------------------------------------
def test_telegram_checks_the_token_and_the_chat_at_save():
    cfg, secret = telegram.clean({"chat_id": "-1001234567890", "chat_name": " Family "}, {"token": TOKEN}, None)
    assert cfg == {"chat_id": -1001234567890, "chat_name": "Family"} and secret == {"token": TOKEN, "main": TOKEN}
    assert telegram.clean({"chat_id": 42}, {}, {"token": TOKEN})[1]["token"] == TOKEN
    assert telegram.clean({"chat_id": "@mantel_alerts"}, {"token": TOKEN}, None)[0]["chat_id"] == "@mantel_alerts"
    for bad in ("", "nonsense", "123:short", "12345678:" + "a" * 35 + "/../x", TOKEN + " x", "abc:" + "a" * 35):
        with pytest.raises(Invalid):
            telegram.clean({"chat_id": 1}, {"token": bad}, None)
    for bad in (None, "", 0, True, "abc", "@x", "1.5", "-", "@evil name"):
        with pytest.raises(Invalid):
            telegram.clean({"chat_id": bad}, {"token": TOKEN}, None)


async def test_telegram_sends_escaped_html_to_the_bot_api_only():
    t = Fake(reply(200, {"ok": True}))
    await telegram.send(t, {"chat_id": -100123}, {"token": TOKEN}, msg(title="Mantel · <b>x tablet is offline",
                                                                       body="It & the <i>other</i> one."))
    method, url, headers, _ = t.calls[0]
    assert (method, url) == ("POST", f"https://api.telegram.org/bot{TOKEN}/sendMessage")
    p = t.json
    assert p["chat_id"] == -100123 and p["parse_mode"] == "HTML" and p["disable_web_page_preview"] is True
    assert p["text"] == ("<b>&lt;b&gt;x tablet is offline</b>\nIt &amp; the &lt;i&gt;other&lt;/i&gt; one.\n"
                         "https://m.example/connections")


async def test_telegram_cuts_a_long_body_to_its_limit_without_cutting_a_tag():
    t = Fake(reply(200, {"ok": True}))
    await telegram.send(t, {"chat_id": 1}, {"token": TOKEN}, msg(body="<&>" * 3000))
    text = t.json["text"]
    assert len(text) <= telegram.LIMIT and text.startswith("<b>Home Assistant disconnected</b>\n")
    assert text.count("<b>") == 1 and "<&" not in text and text.endswith("https://m.example/connections")


async def test_telegram_refuses_a_tampered_token_or_chat_before_any_call():
    t = Fake()
    for bad in ("123456789:AAH/../../evil.example", "evil.example#" + TOKEN, "x", None):
        err = await fails(telegram.send(t, {"chat_id": 1}, {"token": bad}, msg()))
        assert err.permanent
    assert (await fails(telegram.send(t, {"chat_id": "nope"}, {"token": TOKEN}, msg()))).permanent
    assert t.calls == []


async def test_telegram_429_403_400_and_5xx():
    err = await fails(telegram.send(Fake(reply(429, {"ok": False, "parameters": {"retry_after": 11}})),
                                    {"chat_id": 1}, {"token": TOKEN}, msg()))
    assert err.retry_after == 11.0 and not err.permanent
    err = await fails(telegram.send(Fake(reply(403, {"ok": False})), {"chat_id": 1}, {"token": TOKEN}, msg()))
    assert err.permanent and err.message == "Telegram said 403: the bot was removed from the chat or blocked"
    err = await fails(telegram.send(Fake(reply(400, {"ok": False, "description": "Bad Request: chat not found"})),
                                    {"chat_id": 1}, {"token": TOKEN}, msg()))
    assert err.permanent and "chat wasn't found" in err.message
    assert (await fails(telegram.send(Fake(reply(401)), {"chat_id": 1}, {"token": TOKEN}, msg()))).message.startswith(
        "Telegram said 401: the bot token is wrong")
    assert not (await fails(telegram.send(Fake(reply(502)), {"chat_id": 1}, {"token": TOKEN}, msg()))).permanent


async def test_telegram_never_puts_the_token_in_an_error():
    cases = [reply(400, {"ok": False, "description": f"Bad Request: bad {TOKEN} here"}), reply(401), reply(404),
             reply(500, {"description": TOKEN}), (200, {}, b"not json at all"),
             ChannelError("couldn't reach api.telegram.org (ClientError)")]
    for answer in cases:
        t = Fake(answer)
        try:
            await telegram.send(t, {"chat_id": 1}, {"token": TOKEN}, msg())
        except ChannelError as exc:
            assert TOKEN not in exc.message and TOKEN not in str(exc) and "api.telegram.org/bot" not in exc.message
    with pytest.raises(ChannelError) as got:
        await telegram.find_chats(Fake(reply(401, {"ok": False, "description": f"Unauthorized {TOKEN}"})), TOKEN)
    assert TOKEN not in got.value.message


def update(uid, **kw):
    return {"update_id": uid, **kw}


async def test_find_chats_lists_the_distinct_chats_newest_first():
    t = Fake(reply(200, {"ok": True, "result": [
        update(1, message={"chat": {"id": 11, "type": "private", "first_name": "Ana", "last_name": "Lee"}}),
        update(2, message={"chat": {"id": -100, "type": "group", "title": "Family"}}),
        update(3, message={"chat": {"id": 11, "type": "private", "first_name": "Ana"}}),
        update(4, channel_post={"chat": {"id": -1009, "type": "channel", "title": "Alerts"}}),
        update(5, my_chat_member={"chat": {"id": 22, "type": "private", "username": "sam"}}),
        update(6, edited_message={"chat": {"id": 33, "type": "private"}}),
        {"update_id": 7, "poll": {}}, "junk"]}))
    chats = await telegram.find_chats(t, f"  {TOKEN} ")
    assert chats == [{"id": 33, "name": "33", "type": "private"}, {"id": 22, "name": "@sam", "type": "private"},
                     {"id": -1009, "name": "Alerts", "type": "channel"},
                     {"id": 11, "name": "Ana", "type": "private"}, {"id": -100, "name": "Family", "type": "group"}]
    method, url, _, _ = t.calls[0]
    assert method == "GET" and url.startswith(f"https://api.telegram.org/bot{TOKEN}/getUpdates?")


async def test_find_chats_words_for_an_empty_list_a_bad_token_and_a_webhook():
    assert await telegram.find_chats(Fake(reply(200, {"ok": True, "result": []})), TOKEN) == []
    t = Fake()
    for bad in ("", "nonsense", None, 5, "1:" + "a" * 35):
        with pytest.raises(Invalid):
            await telegram.find_chats(t, bad)
    assert t.calls == []
    err = await fails(telegram.find_chats(Fake(reply(409, {"ok": False})), TOKEN))
    assert "webhook" in err.message
    err = await fails(telegram.find_chats(Fake(reply(401, {"ok": False})), TOKEN))
    assert err.permanent and TOKEN not in err.message
    err = await fails(telegram.find_chats(Fake(ChannelError("couldn't reach api.telegram.org (ClientError)")), TOKEN))
    assert TOKEN not in err.message


# -- Notifiarr --------------------------------------------------------------------------------------------------------
def test_notifiarr_checks_the_key_and_the_channel_id_at_save():
    cfg, secret = notifiarr.clean({"channel": str(CHANNEL_ID)}, {"api_key": KEY}, None)
    assert cfg == {"channel": CHANNEL_ID} and secret == {"api_key": KEY, "main": KEY}
    assert notifiarr.clean({"channel": CHANNEL_ID}, {}, {"api_key": KEY})[1]["api_key"] == KEY
    for bad in ("", "short", "has space in it 12345", "x" * 200, "key/with/slash"):
        with pytest.raises(Invalid):
            notifiarr.clean({"channel": CHANNEL_ID}, {"api_key": bad}, None)
    for bad in (None, "", "123", "#general", "12abc", True, -5, 1.5):
        with pytest.raises(Invalid):
            notifiarr.clean({"channel": bad}, {"api_key": KEY}, None)


async def test_notifiarr_posts_the_passthrough_payload_to_notifiarr_only():
    t = Fake(reply(200, {"result": "success"}))
    await notifiarr.send(t, {"channel": CHANNEL_ID}, {"api_key": KEY}, msg())
    method, url, headers, _ = t.calls[0]
    assert (method, url) == ("POST", "https://notifiarr.com/api/v1/notification/apprise")
    assert headers["X-api-Key"] == KEY and headers["Content-Type"] == "application/json" and KEY not in url
    p = t.json
    assert p["notification"] == {"update": False, "name": "Mantel", "event": "system:ha.lost:"}
    d = p["discord"]
    assert d["ids"] == {"channel": CHANNEL_ID} and d["color"] == "E5484D" and d["ping"] == {"pingUser": 0, "pingRole": 0}
    assert d["text"]["title"] == "Home Assistant disconnected" and d["text"]["content"] == ""
    assert d["text"]["description"].endswith("https://m.example/connections") and d["text"]["footer"] == "Mantel"
    assert p["type"] == "failure" and p["source"] == "Mantel"


async def test_notifiarr_words_and_no_key_in_any_error():
    err = await fails(notifiarr.send(Fake(reply(401)), {"channel": CHANNEL_ID}, {"api_key": KEY}, msg()))
    assert err.permanent and err.message == "Notifiarr said 401: use the global API key, not an integration key"
    err = await fails(notifiarr.send(Fake(reply(429, {}, {"Retry-After": "9"})), {"channel": CHANNEL_ID},
                                     {"api_key": KEY}, msg()))
    assert err.retry_after == 9.0 and not err.permanent
    assert not (await fails(notifiarr.send(Fake(reply(500)), {"channel": CHANNEL_ID}, {"api_key": KEY},
                                           msg()))).permanent
    err = await fails(notifiarr.send(Fake(reply(200, {"result": "error", "reason": f"bad {KEY}"})),
                                     {"channel": CHANNEL_ID}, {"api_key": KEY}, msg()))
    assert KEY not in err.message and err.permanent
    for answer in (reply(401), reply(400), reply(403), reply(404), ChannelError("couldn't reach notifiarr.com (X)")):
        err = await fails(notifiarr.send(Fake(answer), {"channel": CHANNEL_ID}, {"api_key": KEY}, msg()))
        assert KEY not in err.message and KEY not in str(err)


async def test_notifiarr_refuses_a_tampered_key_or_channel_before_any_call():
    t = Fake()
    assert (await fails(notifiarr.send(t, {"channel": CHANNEL_ID}, {"api_key": "../evil.example"}, msg()))).permanent
    assert (await fails(notifiarr.send(t, {"channel": "nope"}, {"api_key": KEY}, msg()))).permanent
    assert (await fails(notifiarr.send(t, {"channel": CHANNEL_ID}, None, msg()))).permanent
    assert t.calls == []


# -- Email ------------------------------------------------------------------------------------------------------------
CFG = {"host": "smtp.example.com", "port": 587, "security": "starttls", "user": "me@example.com",
       "from": "me@example.com", "to": ["a@example.com", "b@example.com"]}


class FakeSMTP:
    """smtplib.SMTP / SMTP_SSL as the sender uses them; ``fail`` maps a method to the exception it raises."""
    made: list["FakeSMTP"] = []
    fail: dict = {}

    def __init__(self, host, port, local_hostname=None, timeout=None, context=None):
        self.args = (host, port, local_hostname, timeout, context)
        self.calls: list[tuple] = []
        self.sent = None
        if "connect" in self.fail:
            raise self.fail["connect"]
        FakeSMTP.made.append(self)

    def _do(self, name, *a, **kw):
        self.calls.append((name, a, kw))
        if name in self.fail:
            raise self.fail[name]

    def ehlo(self):
        self._do("ehlo")

    def starttls(self, context=None):
        self._do("starttls", context=context)

    def login(self, user, password):
        self._do("login", user, password)

    def send_message(self, message, from_addr=None, to_addrs=None):
        self._do("send_message", from_addr=from_addr, to_addrs=to_addrs)
        self.sent = message

    def quit(self):
        self._do("quit")


class FakeSSL(FakeSMTP):
    pass


@pytest.fixture
def smtp(monkeypatch):
    FakeSMTP.made, FakeSMTP.fail = [], {}
    monkeypatch.setattr(mail, "SMTP_FACTORY", FakeSMTP)
    monkeypatch.setattr(mail, "SMTP_SSL_FACTORY", FakeSSL)
    return FakeSMTP


def names(s: FakeSMTP) -> list[str]:
    return [c[0] for c in s.calls]


def test_email_checks_every_setting_at_save():
    cfg, secret = mail.clean(CFG, {"password": "app-pass"}, None)
    assert cfg == {**CFG, "to": ["a@example.com", "b@example.com"]} and secret == {"password": "app-pass",
                                                                                   "host": CFG["host"], "user": CFG["user"]}
    assert mail.clean(CFG, {}, {"password": "kept", "host": CFG["host"], "user": CFG["user"]})[1]["password"] == "kept"
    assert mail.clean({**CFG, "user": ""}, {}, None)[1] == {}                          # no login, no password
    assert mail.clean({**CFG, "port": "465", "security": ""}, {"password": "x"}, None)[0]["security"] == "tls"
    assert mail.clean({**CFG, "from": "Mantel <alerts@example.com>", "to": "a@example.com, b@example.com"},
                      {"password": "x"}, None)[0]["to"] == ["a@example.com", "b@example.com"]
    bad = [{"host": ""}, {"host": "bad host"}, {"port": 80}, {"port": True}, {"security": "ssl"}, {"from": "nope"},
           {"to": []}, {"to": ["a@example.com"] * 11}, {"to": ["nope"]}, {"to": "x"}, {"to": [5]}]
    for change in bad:
        with pytest.raises(Invalid):
            mail.clean({**CFG, **change}, {"password": "x"}, None)
    with pytest.raises(Invalid):
        mail.clean(CFG, {}, None)                                                  # a user needs a password


@pytest.mark.parametrize("host", ["192.168.1.5", "10.0.0.2", "172.16.0.1", "172.31.255.1", "127.0.0.1", "169.254.1.1",
                                  "nas.local", "mail.lan", "mail.home.arpa", "localhost"])
def test_email_none_is_allowed_on_a_lan_host(host):
    cfg, _ = mail.clean({**CFG, "host": host, "security": "none", "port": 25, "user": ""}, {}, None)
    assert cfg["security"] == "none"


@pytest.mark.parametrize("host", ["smtp.example.com", "8.8.8.8", "172.32.0.1", "192.169.0.1", "11.0.0.1",
                                  "evil.local.example.com", "locallan", "2001:db8::1", "fd12::1"])
def test_email_none_is_refused_off_the_lan(host):
    with pytest.raises(Invalid) as got:
        mail.clean({**CFG, "host": host, "security": "none", "port": 25}, {"password": "x"}, None)
    assert got.value.code in ("insecure_host", "invalid_host")


def test_email_refuses_a_line_break_in_any_field():
    for field, value in (("host", "smtp.example.com\r\nBcc: x"), ("user", "me\nx"), ("from", "a@example.com\r\nBcc: x"),
                         ("to", ["a@example.com\nBcc: x@example.com"]), ("security", "tls\n"),
                         ("to", ["a@example.com", "b@example.com\r"])):
        with pytest.raises(Invalid):
            mail.clean({**CFG, field: value}, {"password": "x"}, None)
    with pytest.raises(Invalid):
        mail.clean(CFG, {"password": "pw\r\nQUIT"}, None)


async def test_email_starttls_verifies_the_certificate_logs_in_and_sends_plain_text(smtp):
    await mail.send(Fake(), CFG, {"password": "app-pass", "host": CFG["host"], "user": CFG["user"]}, msg(title="Mantel · A\nBcc: x@example.com tablet"))
    [s] = smtp.made
    assert s.args[:2] == ("smtp.example.com", 587) and s.args[3] == 20.0
    assert names(s) == ["ehlo", "starttls", "ehlo", "login", "send_message", "quit"]
    ctx = s.calls[1][2]["context"]
    assert ctx.verify_mode == ssl.CERT_REQUIRED and ctx.check_hostname is True
    assert s.calls[3][1] == ("me@example.com", "app-pass")
    assert s.calls[4][2] == {"from_addr": "me@example.com", "to_addrs": ["a@example.com", "b@example.com"]}
    m = s.sent
    assert m["Subject"] == "Mantel · A Bcc: x@example.com tablet" and "\n" not in m["Subject"]
    assert m["Bcc"] is None and m["To"] == "a@example.com, b@example.com" and "me@example.com" in m["From"]
    assert m.get_content_type() == "text/plain"
    assert m.get_content().rstrip().endswith("https://m.example/connections") and "Maple House" in m.get_content()


async def test_email_tls_uses_the_ssl_class_and_none_on_the_lan_skips_tls_and_login(smtp):
    await mail.send(Fake(), {**CFG, "port": 465, "security": "tls"}, {"password": "p", "host": CFG["host"], "user": CFG["user"]}, msg())
    [s] = smtp.made
    assert isinstance(s, FakeSSL) and names(s) == ["login", "send_message", "quit"]
    assert s.args[4].verify_mode == ssl.CERT_REQUIRED
    smtp.made.clear()
    lan = {**CFG, "host": "nas.local", "port": 25, "security": "none", "user": ""}
    await mail.send(Fake(), lan, {}, msg())
    assert names(smtp.made[0]) == ["send_message", "quit"]


async def test_email_refuses_tampered_saved_settings_before_connecting(smtp):
    for cfg in ({**CFG, "security": "none"}, {**CFG, "host": "x\r\ny"}, {**CFG, "to": ["a@example.com\nBcc: z@e.com"]},
                {**CFG, "port": 22}, {}):
        assert (await fails(mail.send(Fake(), cfg, {"password": "p", "host": CFG["host"], "user": CFG["user"]}, msg()))).permanent
    assert (await fails(mail.send(Fake(), CFG, {}, msg()))).permanent                     # the password is gone
    assert (await fails(mail.send(Fake(), CFG, {"password": "p\nq", "host": CFG["host"], "user": CFG["user"]}, msg()))).permanent
    assert smtp.made == []


@pytest.mark.parametrize("fail,words,permanent", [
    ({"login": smtplib.SMTPAuthenticationError(535, b"5.7.8 Username and Password not accepted pw-secret")},
     "app password", True),
    ({"connect": ConnectionRefusedError("refused pw-secret")}, "refused the connection", False),
    ({"connect": TimeoutError("pw-secret")}, "didn't answer in time", False),
    ({"connect": OSError("pw-secret")}, "couldn't reach the mail server (OSError)", False),
    ({"starttls": ssl.SSLCertVerificationError(1, "[SSL: CERTIFICATE_VERIFY_FAILED] pw-secret")},
     "certificate couldn't be verified", True),
    ({"starttls": ssl.SSLError("pw-secret")}, "TLS handshake failed", False),
    ({"starttls": smtplib.SMTPNotSupportedError("STARTTLS extension not supported pw-secret")}, "doesn't offer", True),
    ({"send_message": smtplib.SMTPRecipientsRefused({"a@example.com": (550, b"pw-secret")})}, "To address", True),
    ({"send_message": smtplib.SMTPSenderRefused(553, b"pw-secret", "me@example.com")}, "From address", True),
    ({"send_message": smtplib.SMTPDataError(451, b"try later pw-secret")}, "said 451", False),
    ({"send_message": smtplib.SMTPDataError(554, b"rejected pw-secret")}, "said 554", True),
    ({"connect": smtplib.SMTPServerDisconnected("pw-secret")}, "closed the connection", False),
])
async def test_email_failures_are_words_and_never_hold_the_password(smtp, fail, words, permanent):
    smtp.fail = dict(fail)
    err = await fails(mail.send(Fake(), CFG, {"password": "pw-secret", "host": CFG["host"], "user": CFG["user"]}, msg()))
    assert words in err.message and err.permanent is permanent
    assert "pw-secret" not in err.message and "pw-secret" not in str(err)


async def test_email_a_failed_quit_does_not_fail_a_sent_message(smtp):
    smtp.fail = {"quit": smtplib.SMTPServerDisconnected("gone")}
    await mail.send(Fake(), CFG, {"password": "p", "host": CFG["host"], "user": CFG["user"]}, msg())
    assert smtp.made[0].sent is not None


# -- Apprise ----------------------------------------------------------------------------------------------------------
class StubApprise(types.ModuleType):
    """A stand-in for the apprise module: records what was added and sent; ``result`` is notify's answer."""

    def __init__(self, result=True, accept=lambda url: True, boom=None):
        super().__init__("apprise")
        stub = self
        stub.result, stub.boom, stub.sent, stub.urls = result, boom, [], []

        class Apprise:
            def __init__(self):
                self.urls = []

            def add(self, url):
                if not accept(url):
                    return False
                self.urls.append(url)
                stub.urls.append(url)
                return True

            def __len__(self):
                return len(self.urls)

            def notify(self, title="", body="", notify_type="info", **kw):
                if stub.boom:
                    raise stub.boom
                stub.sent.append({"title": title, "body": body, "notify_type": notify_type, "urls": list(self.urls)})
                return stub.result

        stub.Apprise = Apprise


def stub(monkeypatch, **kw) -> StubApprise:
    mod = StubApprise(**kw)
    monkeypatch.setitem(sys.modules, "apprise", mod)
    return mod


async def test_apprise_sends_one_message_to_every_url_with_the_level_as_its_type(monkeypatch):
    s = stub(monkeypatch)
    urls = ["ntfy://mantel-alerts", "pover://user@token"]
    for level, kind in (("critical", "failure"), ("warning", "warning"), ("info", "info")):
        await apprise_.send(Fake(), {}, {"urls": urls}, msg(level=level))
        assert s.sent[-1]["notify_type"] == kind
    assert s.sent[-1]["urls"] == urls and s.sent[-1]["title"] == "Home Assistant disconnected"
    assert s.sent[-1]["body"].endswith("https://m.example/connections")


async def test_apprise_failure_is_words_and_never_the_urls(monkeypatch):
    url = "ntfy://user:s3cret-token@ntfy.example.com/alerts"
    stub(monkeypatch, result=False)
    err = await fails(apprise_.send(Fake(), {}, {"urls": [url]}, msg()))
    assert err.message == "Apprise couldn't send to one or more of its URLs"
    stub(monkeypatch, boom=RuntimeError(f"POST {url} failed"))
    err = await fails(apprise_.send(Fake(), {}, {"urls": [url]}, msg()))
    assert err.message == "Apprise failed (RuntimeError)" and "s3cret-token" not in err.message + str(err)
    assert (await fails(apprise_.send(Fake(), {}, {"urls": []}, msg()))).permanent
    assert (await fails(apprise_.send(Fake(), {}, {}, msg()))).permanent


async def test_apprise_not_installed_is_said_plainly_and_is_not_available(monkeypatch):
    monkeypatch.setitem(sys.modules, "apprise", None)                    # `import apprise` raises ImportError
    assert apprise_.available() is False
    err = await fails(apprise_.send(Fake(), {}, {"urls": ["ntfy://x"]}, msg()))
    assert err.permanent and "isn't installed" in err.message
    assert apprise_.OWNER_ADVANCED is True and apprise_.KIND == "apprise"


def test_apprise_clean_keeps_the_urls_secret_and_the_first_is_main(monkeypatch):
    stub(monkeypatch)
    cfg, secret = apprise_.clean({}, {"urls": "ntfy://one\n  pover://two  \n\n"}, None)
    assert cfg == {} and secret == {"urls": ["ntfy://one", "pover://two"], "main": "ntfy://one"}
    assert apprise_.clean({}, {}, {"urls": ["ntfy://old"]})[1]["urls"] == ["ntfy://old"]
    for bad in ([], ["no scheme"], ["ntfy://" + "x" * 520], ["ntfy://a b"], ["ntfy://ok", "1://x"],
                ["ntfy://a\r\nb"], ["ntfy://x"] * 11, ["://x"]):
        with pytest.raises(Invalid):
            apprise_.clean({}, {"urls": bad}, None)
    stub(monkeypatch, accept=lambda url: url.startswith("ntfy://"))
    with pytest.raises(Invalid) as got:
        apprise_.clean({}, {"urls": ["ntfy://fine", "slack://tok-s3cret"]}, None)
    assert "URL 2" in got.value.message and "s3cret" not in got.value.message


def test_apprise_clean_with_the_real_library():
    pytest.importorskip("apprise")
    assert apprise_.clean({}, {"urls": ["ntfy://mantel-alerts"]}, None)[1]["main"] == "ntfy://mantel-alerts"
    for bad in ("bogus://x", "ntfy://a,ntfy://b"):                          # unknown scheme; one string, two services
        with pytest.raises(Invalid):
            apprise_.clean({}, {"urls": [bad]}, None)


# -- the whole center, with the Discord sender -------------------------------------------------------------------------
async def test_a_batch_of_three_goes_to_discord_as_one_embed(tmp_path):
    now = [1_000_000.0]
    store = Store(tmp_path / "m.db")
    try:
        clock = lambda: now[0]       # noqa: E731
        channels = Channels(store.db, SecretBox(key=bytes(32)), clock)
        t = Fake(reply(200))
        seen: list[Message] = []

        async def send(ch, message):
            seen.append(message)
            await discord.send(t, ch["config"], channels.secret(ch["id"]), message)

        center = Center(channels=channels, log_store=Log(store.db, clock), settings=Settings(store.db, clock),
                        send=send, clock=clock, house=lambda: "Maple House",
                        link=lambda page: f"https://m.example/{page}")
        cid = channels.add("discord", "Family", events=["backup.failed", "backup.stale", "protect.cert"],
                           min_level="info", quiet={}, config={}, secret={"url": HOOK, "main": HOOK})
        center.raise_("backup.failed", "", {"error": "The disk is full."})
        center.raise_("backup.stale", "", {"when": "Saturday"})
        center.raise_("protect.cert", "")
        now[0] += C.BATCH + 1
        await center.tick()
        await asyncio.gather(*center.tasks)
        assert len(t.calls) == 1 and len(seen) == 1
        assert seen[0].title == "Mantel · 3 alerts" and seen[0].level == "critical"
        embed = t.json["embeds"][0]
        assert embed["title"] == "3 alerts" and embed["color"] == discord.COLORS["critical"]
        assert embed["description"].count("•") == 3 and "Maple House" in embed["description"]
        assert t.json["allowed_mentions"] == {"parse": []} and channels.get(cid)["last_ok"] == now[0]
    finally:
        store.db.close()


async def test_a_saved_password_never_goes_to_another_server():
    _, secret = mail.clean(CFG, {"password": "app-pass"}, None)
    with pytest.raises(Invalid) as moved:
        mail.clean({**CFG, "host": "smtp.attacker.example"}, {}, secret)
    assert moved.value.code == "password_needed"
    assert mail.clean(CFG, {}, secret)[1]["password"] == "app-pass"         # same server: kept
    with pytest.raises(ChannelError):                                       # a row changed behind Mantel's back
        await mail.send(None, {**CFG, "host": "smtp.attacker.example"}, secret, msg())
