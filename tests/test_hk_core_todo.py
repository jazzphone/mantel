"""TO-DO LISTS for the Side Pane (hk_core/todo.py): the items read with `todo.get_items` over the House port,
and checking one off (`todo.update_item`), a house command classified and audited as every command is.

Fakes only: a house that answers from a dict, Mantel's House over a caller that records what it is handed,
and the gateway's own classification (nothing is sent anywhere). A FICTIONAL house."""
from __future__ import annotations

import pytest

from hk_core import todo as TD
from hk_core.house import State
from mantel_server.ha import gateway as G
from mantel_server.identity import rbac
from mantel_server.house import HouseCommandsDisabled, MantelHouse
from mantel_server.ha.registry import Registry
from mantel_server.ha.state import StateStore

ANSWER = {"todo.groceries": {"items": [
    {"uid": "1", "summary": "Milk", "status": "needs_action"},
    {"uid": "2", "summary": "Eggs", "status": "completed"},
    {"uid": "3", "summary": "  Coffee beans ", "status": "needs_action", "due": "2026-10-31"},
    {"uid": "", "summary": "no uid"},
    {"uid": "5", "summary": "   "},
    "not an item",
]}}


class FakeHouse:
    def __init__(self, answer=None, left="2"):
        self.answer, self.left, self.calls, self.asked = answer or {}, left, [], []

    def state(self, entity_id):
        return State(entity_id, self.left, {"friendly_name": "Groceries"}) if self.left is not None else None

    async def service_response(self, domain, service, data, *, context=None):
        self.asked.append((domain, service, data, context))
        return self.answer

    async def call_service(self, domain, service, data, *, context=None):
        self.calls.append((domain, service, data, context))


def test_the_read_asks_for_the_open_items_and_the_done_ones_only_when_shown():
    assert TD.request("todo.groceries") == ("todo", "get_items", {"entity_id": "todo.groceries", "status": ["needs_action"]})
    assert TD.request("todo.groceries", True)[2]["status"] == ["needs_action", "completed"]
    with pytest.raises(ValueError):
        TD.request("light.kitchen")


def test_items_are_the_open_ones_first_in_the_list_s_order():
    got = TD.items_of(ANSWER, "todo.groceries")
    assert [x["summary"] for x in got] == ["Milk", "Coffee beans"], "done ones left out; blanks and no uid too"
    assert got[1] == {"uid": "3", "summary": "Coffee beans", "done": False, "due": "2026-10-31"}
    shown = TD.items_of(ANSWER, "todo.groceries", completed=True)
    assert [(x["summary"], x["done"]) for x in shown] == [("Milk", False), ("Coffee beans", False), ("Eggs", True)]
    assert TD.items_of(ANSWER, "todo.groceries", limit=1) == got[:1]
    assert TD.items_of({}, "todo.groceries") == [] and TD.items_of(None, "todo.groceries") == []
    assert TD.items_of({"todo.groceries": {"items": "nope"}}, "todo.groceries") == []


async def test_a_list_for_the_page_its_name_count_and_items_through_the_port():
    h = FakeHouse(ANSWER)
    got = await TD.items(h, "todo.groceries", context="who")
    assert got["name"] == "Groceries" and got["left"] == 2 and len(got["items"]) == 2
    assert h.asked == [("todo", "get_items", {"entity_id": "todo.groceries", "status": ["needs_action"]}, "who")]
    h2 = FakeHouse(ANSWER, left="unknown")
    assert (await TD.items(h2, "todo.groceries"))["left"] is None


async def test_checking_one_off_is_update_item_status_completed():
    assert TD.check_off("todo.groceries", "1") == ("todo", "update_item",
                                                   {"entity_id": "todo.groceries", "item": "1", "status": "completed"})
    for bad in (("light.x", "1"), ("todo.groceries", ""), ("todo.groceries", "x" * 201), ("todo.groceries", 3)):
        with pytest.raises(ValueError):
            TD.check_off(*bad)
    h = FakeHouse()
    await TD.complete(h, "todo.groceries", "1", context="person")
    assert h.calls == [("todo", "update_item", {"entity_id": "todo.groceries", "item": "1", "status": "completed"}, "person")]


# ------------------------------------------------------------------------------------------------ Mantel's side
def mantel(caller=None):
    store = StateStore()
    store.replace_all({"a": {"todo.groceries": {"s": "2", "a": {"friendly_name": "Groceries"}, "lc": 1.0}}})
    return MantelHouse(store, Registry(), caller=caller)


async def test_mantel_reads_a_list_through_its_caller_the_gateway_with_the_answer_asked_for():
    seen = []

    async def caller(domain, service, data, context, response=False):
        seen.append((domain, service, data, context, response))
        return {"context": {"id": "x"}, "response": ANSWER}
    got = await TD.items(mantel(caller), "todo.groceries", context="principal")
    assert seen == [("todo", "get_items", {"entity_id": "todo.groceries", "status": ["needs_action"]}, "principal", True)]
    assert got["left"] == 2 and [x["uid"] for x in got["items"]] == ["1", "3"]


async def test_mantel_with_commands_off_reads_nothing():
    with pytest.raises(HouseCommandsDisabled):
        await TD.items(mantel(None), "todo.groceries")


def test_the_gateway_classifies_both_as_service_commands_on_the_list():
    """Rule 3: the check-off is a command like any other -- one check per list, RBAC `control` on it (not a
    sensitive kind), audited before anything is sent; the read asks for HA's answer."""
    domain, service, data = TD.check_off("todo.groceries", "1")
    cmd = G.service_command(domain, service, {k: v for k, v in data.items() if k != "entity_id"},
                            {"entity_id": data["entity_id"]})
    assert cmd.action == "todo.update_item" and cmd.targets == ["todo.groceries"]
    assert [(c.action, c.target) for c in cmd.checks] == [("todo.update_item", "todo.groceries")]
    assert cmd.frame["service_data"] == {"item": "1", "status": "completed"}
    domain, service, data = TD.request("todo.groceries")
    read = G.service_command(domain, service, data, None, True)
    assert read.frame["return_response"] is True and read.targets == ["todo.groceries"]

    class Ctx:
        def device_class_of(self, entity_id):
            return None
    got = rbac.classify("todo.update_item", "todo.groceries", Ctx())
    assert got.action == "control" and got.sensitive is None
