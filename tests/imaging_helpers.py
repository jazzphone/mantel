"""Jobs the imaging tests send to the image worker (test_imaging.py). They live in their own small module because a
spawned worker imports a job by its module and name: a test file's own functions would drag pytest and the whole
server into the worker."""
import os
import sys
import time
from pathlib import Path


def about() -> dict:
    """Where this ran, and what that process has imported."""
    return {"pid": os.getpid(),
            "modules": sorted(m for m in ("aiohttp", "onnxruntime", "mantel_server.server", "mantel_server.photos",
                                          "mantel_server.user_files", "pytest") if m in sys.modules)}


def hold(seconds: float) -> tuple[int, float, float]:
    """Busy for ``seconds``: (pid, started, ended) on the shared monotonic clock."""
    t0 = time.monotonic()
    time.sleep(seconds)
    return os.getpid(), t0, time.monotonic()


def crash_unless(parent: int, marker: str | None = None) -> int:
    """Kill the worker it runs in (as an out-of-memory kill would), never the test's own process. With ``marker``,
    only the first time (the marker file is made then)."""
    if os.getpid() != parent and (marker is None or not Path(marker).exists()):
        if marker is not None:
            Path(marker).touch()
        os._exit(9)
    return os.getpid()
