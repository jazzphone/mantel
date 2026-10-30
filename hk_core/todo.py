"""TO-DO LISTS (2026-10-30; the Side Pane's To-do section, docs/phase11/HOMEVIEW-LOOK.md "Phase A2").

A to-do list's items are not in its entity's state (that is only how many are left), so HK reads them
through Home Assistant's `todo.get_items`, over the House port: Home Assistant's own call in HK Frontend
(HaHouse), the command gateway in Mantel (MantelHouse). The page asks again whenever the list's state
changes. Checking an item off is `todo.update_item` (status completed): a house command, sent by the page
through its action port as any other (in Mantel the gateway classifies it -- `control` on the list -- and
audits it before anything is sent; `check_off` is its shape, `complete` sends it from feature code).

What is decided here: which items a section is handed (the open ones, and the done ones only when the
section shows them; open first, each in the list's own order), how many at most, and what each carries.
"""
from __future__ import annotations

import re
from collections.abc import Mapping
from typing import Any

from .house import House

DOMAIN = "todo"
LIST_ID = re.compile(r"^todo\.[a-z0-9_]+$")
# the most items a list hands over: the pane shows six at most, and a list of
# hundreds should not cross the wire for that
LIMIT = 50
UID_MAX = 200
OPEN, DONE = "needs_action", "completed"


def valid_list(entity_id: Any) -> bool:
    return isinstance(entity_id, str) and bool(LIST_ID.match(entity_id))


def request(entity_id: str, completed: bool = False) -> tuple[str, str, dict[str, Any]]:
    """The read: `todo.get_items` for one list, the done items too when they are shown."""
    if not valid_list(entity_id):
        raise ValueError("not a to-do list")
    return DOMAIN, "get_items", {"entity_id": entity_id, "status": [OPEN, DONE] if completed else [OPEN]}


def items_of(answer: Mapping[str, Any] | None, entity_id: str, completed: bool = False,
             limit: int = LIMIT) -> list[dict[str, Any]]:
    """The list's items from `todo.get_items`' answer ({entity: {items: [...]}}), as the section draws them:
    {uid, summary, done, due}, the open ones first, each in the list's own order, at most `limit`. An item
    without a uid or a summary is left out (nothing to show, or nothing to check off)."""
    got = (answer or {}).get(entity_id) if isinstance(answer, Mapping) else None
    raw = got.get("items") if isinstance(got, Mapping) else None
    out_open: list[dict[str, Any]] = []
    out_done: list[dict[str, Any]] = []
    for it in raw if isinstance(raw, list) else []:
        if not isinstance(it, Mapping):
            continue
        uid, summary = it.get("uid"), it.get("summary")
        if not isinstance(uid, str) or not uid or len(uid) > UID_MAX or not isinstance(summary, str) or not summary.strip():
            continue
        done = it.get("status") == DONE
        if done and not completed:
            continue
        due = it.get("due")
        row = {"uid": uid, "summary": summary.strip(), "done": done, "due": due if isinstance(due, str) else None}
        (out_done if done else out_open).append(row)
    return (out_open + out_done)[:max(0, limit)]


async def items(house: House, entity_id: str, completed: bool = False, limit: int = LIMIT,
                context: Any = None) -> dict[str, Any]:
    """One list for the page: its name, how many are left (its state) and its items."""
    domain, service, data = request(entity_id, completed)
    answer = await house.service_response(domain, service, data, context=context)
    st = house.state(entity_id)
    try:
        left = int(st.state) if st is not None else None
    except (TypeError, ValueError):
        left = None
    return {"entity_id": entity_id, "name": st.name if st is not None else entity_id.split(".", 1)[1].replace("_", " "),
            "left": left, "items": items_of(answer, entity_id, completed, limit)}


def check_off(entity_id: str, uid: str) -> tuple[str, str, dict[str, Any]]:
    """Checking an item off: `todo.update_item`, status completed, on its list."""
    if not valid_list(entity_id) or not isinstance(uid, str) or not uid or len(uid) > UID_MAX:
        raise ValueError("not an item of a to-do list")
    return DOMAIN, "update_item", {"entity_id": entity_id, "item": uid, "status": DONE}


async def complete(house: House, entity_id: str, uid: str, context: Any = None) -> None:
    """Check an item off, through the house's own service call (a command: refused where commands are)."""
    domain, service, data = check_off(entity_id, uid)
    await house.call_service(domain, service, data, context=context)
