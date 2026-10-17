from __future__ import annotations


class Counter:
    def __init__(self) -> None:
        self.msgs = 0
        self.bytes = 0

    def add(self, nbytes: int) -> None:
        self.msgs += 1
        self.bytes += nbytes

    def as_dict(self) -> dict:
        return {"msgs": self.msgs, "bytes": self.bytes}
