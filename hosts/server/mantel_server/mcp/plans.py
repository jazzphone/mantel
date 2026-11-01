"""Plan, then apply (docs/phase12/MCP-SERVER.md "Changing things safely"), with no session to remember it in.

Every write tool runs dry first (``dry_run`` defaults to true): the change goes through every check a real one does
(dry_run.py) and the answer is what it would change, and a **plan**: a handle the server signs, naming the tool,
a digest of its exact arguments, the grant, the versions of every document it read, and an expiry (ten minutes).
Applying is the same call with ``dry_run: false`` and that ``plan``: anything different (other arguments, another
assistant, a document changed meanwhile, too late) is refused and nothing is written. The protocol keeps no
session (2026-07-28), so the handle is the whole state, and it is only good on this Mantel until it restarts.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import time
from typing import Any

PLAN_TTL = 600.0


def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def _unb64(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def digest(tool: str, args: dict) -> str:
    body = {k: v for k, v in args.items() if k not in ("dry_run", "plan")}
    return hashlib.sha256(json.dumps([tool, body], sort_keys=True, separators=(",", ":")).encode()).hexdigest()


class PlanError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


class Plans:
    def __init__(self, clock=time.time, secret: bytes | None = None) -> None:
        self.clock = clock
        self.secret = secret or secrets.token_bytes(32)

    def make(self, grant_id: str, tool: str, args: dict, versions: dict[str, int]) -> str:
        body = {"t": tool, "h": digest(tool, args), "g": grant_id, "v": versions, "e": round(self.clock() + PLAN_TTL)}
        raw = _b64(json.dumps(body, sort_keys=True, separators=(",", ":")).encode())
        return "plan_" + raw + "." + _b64(hmac.new(self.secret, raw.encode(), hashlib.sha256).digest())

    def check(self, token: Any, grant_id: str, tool: str, args: dict) -> dict[str, int]:
        """The versions the plan read, or PlanError."""
        if not isinstance(token, str) or not token.startswith("plan_") or "." not in token:
            raise PlanError("plan_required", "apply a change with the `plan` its dry run gave (dry_run: true first)")
        raw, _, sig = token[5:].partition(".")
        good = _b64(hmac.new(self.secret, raw.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(good, sig):
            raise PlanError("plan_invalid", "this plan is not one this Mantel made (or Mantel restarted): plan again")
        try:
            body = json.loads(_unb64(raw))
        except ValueError:
            raise PlanError("plan_invalid", "this plan cannot be read: plan again") from None
        if body.get("g") != grant_id or body.get("t") != tool:
            raise PlanError("plan_invalid", "this plan is for another tool or another assistant")
        if body.get("h") != digest(tool, args):
            raise PlanError("plan_mismatch", "the arguments differ from the ones planned: plan again with these")
        if float(body.get("e") or 0) < self.clock():
            raise PlanError("plan_expired", "this plan is more than ten minutes old: plan again")
        v = body.get("v")
        return {str(k): int(x) for k, x in v.items()} if isinstance(v, dict) else {}
