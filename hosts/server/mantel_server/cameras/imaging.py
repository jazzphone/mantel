"""IMAGE WORK IN ITS OWN PROCESS (docs/phase4/PHOTOS.md, "Where the work runs").

Decoding and re-encoding a picture (Mantel Photos' ``process``, Your Files' ``reencode_photo``), looking for faces
(an upload's, and the face backfill's ``look``) and cutting out a photo's subject (Time Behind: an upload's, and the
cut-out backfill's ``cut_look``) run here, in ONE worker process, ONE job at a time:

* **One worker.** A ``ProcessPoolExecutor(max_workers=1)`` with the ``spawn`` start method (a fresh interpreter that
  imports only image_work.py, faces.py and Pillow -- never the server, its sockets or its database). It is started on
  the first picture and stopped after ``IDLE`` seconds (5 minutes) without one; ONNX Runtime is loaded there only,
  so the server process never carries it.
* **One at a time.** ``run`` waits for the image slot (a semaphore per event loop) before it sends a job, and the
  slot is given back when the JOB ends: a cancelled caller can't stop a decode that is under way, so it goes on
  counting until the worker has finished. A pile of uploads, an import and the face backfill queue (MED-2).
* **Plain data.** Bytes or a path go in; encoded bytes, sizes and face boxes come out. The server writes every file,
  row and audit line itself, with what comes back.
* **When the worker dies** mid-job (out of memory, a decoder crash), that job fails with ``WorkerLost`` (the callers
  answer "couldn't be read"); it is never tried again in the server itself, where the same picture could take the
  server down. The next job starts a new worker.
* **When no worker can run** (a locked-down container: no ``/dev/shm`` for the pool's semaphores, no new processes),
  or after a second death, the work runs in a thread of the server as before -- baseline JPEG, so the event loop
  keeps running (MED-1) -- said once in the log.
"""
from __future__ import annotations

import asyncio
import contextlib
import logging
import multiprocessing
import threading
import time
import weakref
from concurrent.futures import Future, ProcessPoolExecutor
from concurrent.futures.process import BrokenProcessPool
from pathlib import Path
from typing import Callable

from . import cutout as cutter
from . import faces as face_finder
from . import image_work

log = logging.getLogger("mantel.imaging")

IMAGE_JOBS = 1          # pictures decoded at once: one full decode is 0.3-0.7 GB
IDLE = 300.0            # seconds without a picture before the worker stops
PROCESSES = True        # False: always the thread (the tests that replace image_work's functions in this process)
BREAKS_MAX = 2          # workers lost (or that would not start) before the work goes to a thread for good


class WorkerLost(RuntimeError):
    """The worker process died while it had this job (or as it started)."""


# the pool's first step in each worker: (function, args); args None = the server's log level
_initializer: tuple[Callable, tuple | None] = (image_work.start_worker, None)

_lock = threading.Lock()
_pool: ProcessPoolExecutor | None = None
_pid: int | None = None             # the running worker's process id
_busy = 0                           # jobs sent and not finished
_last = 0.0                         # when the last one finished (monotonic)
_timer: threading.Timer | None = None
_breaks = 0
_fallback = False
_faces: bool | None = None          # what the worker said about the face detector; None: not asked yet
_cutouts: bool | None = None        # ...and about the cut-out model
_slots: "weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, asyncio.Semaphore]" = weakref.WeakKeyDictionary()


def image_slot() -> asyncio.Semaphore:
    """The semaphore every picture job waits on. One per event loop, so a test's fresh loop never meets a semaphore
    another loop has waited on."""
    loop = asyncio.get_running_loop()
    slot = _slots.get(loop)
    if slot is None:
        slot = _slots[loop] = asyncio.Semaphore(IMAGE_JOBS)
    return slot


def _threads() -> bool:
    return not PROCESSES or _fallback


def state() -> dict:
    """``mode``: ``process`` or ``thread``; ``pid``: the worker's, while one runs."""
    return {"mode": "thread" if _threads() else "process", "pid": None if _threads() else _pid}


def _new_pool() -> ProcessPoolExecutor:
    fn, args = _initializer
    if args is None:
        args = (logging.getLogger().getEffectiveLevel(),)
    return ProcessPoolExecutor(max_workers=1, mp_context=multiprocessing.get_context("spawn"),
                               initializer=fn, initargs=args)


def _fall_back(why: str) -> None:
    global _fallback
    with _lock:
        said, _fallback = _fallback, True
    if not said:
        log.warning("picture work runs in a thread from now on (%s): uploads still go one at a time, with "
                    "baseline JPEG", why)


def _drop(pool: ProcessPoolExecutor) -> None:
    global _pool, _pid
    with _lock:
        if _pool is pool:
            _pool, _pid = None, None
    with contextlib.suppress(Exception):
        pool.shutdown(wait=False, cancel_futures=True)


def _broke(pool: ProcessPoolExecutor, why: str) -> None:
    global _breaks
    _drop(pool)
    with _lock:
        _breaks += 1
        n = _breaks
    if n >= BREAKS_MAX:
        _fall_back(f"the image worker stopped {n} times; last: {why}")
    else:
        log.warning("the image worker stopped (%s); the next picture starts another", why)


async def _worker() -> ProcessPoolExecutor | None:
    """The running pool, started and answering; None: use a thread."""
    global _pool, _pid
    while True:
        with _lock:
            if _threads():
                return None
            if _pool is not None:
                return _pool
        try:
            pool = _new_pool()
            started = pool.submit(image_work.ready)
        except Exception as exc:  # noqa: BLE001 -- no semaphores, no processes: this machine can't run one
            _fall_back(f"no worker process can start here: {type(exc).__name__}: {exc}")
            return None
        try:
            pid = await asyncio.wrap_future(started)
        except BrokenProcessPool as exc:
            _broke(pool, f"a new worker died as it started: {exc}")
            continue
        except asyncio.CancelledError:
            _drop(pool)
            raise
        except Exception as exc:  # noqa: BLE001
            _drop(pool)
            _fall_back(f"a new worker failed as it started: {type(exc).__name__}: {exc}")
            return None
        with _lock:
            _pool, _pid = pool, pid
        log.debug("image worker %d started", pid)
        return pool


def _job_done(_f: Future | None = None) -> None:
    """A job ended (in the pool's own thread, or where it was cancelled): the idle clock starts again."""
    global _busy, _last, _timer
    with _lock:
        _busy -= 1
        _last = time.monotonic()
        if _timer is not None:
            _timer.cancel()
        _timer = threading.Timer(IDLE, _idle)
        _timer.daemon = True
        _timer.start()


def _idle() -> None:
    global _pool, _pid, _timer
    with _lock:
        if _busy or _pool is None or time.monotonic() - _last < IDLE * 0.9:
            return
        pool, pid, _pool, _pid, _timer = _pool, _pid, None, None, None
    log.debug("image worker %s stops: idle", pid)
    pool.shutdown(wait=False)


def _release(loop: asyncio.AbstractEventLoop, slot: asyncio.Semaphore) -> None:
    with contextlib.suppress(RuntimeError):              # the loop is gone: nothing is waiting any more
        loop.call_soon_threadsafe(slot.release)


async def run(fn: Callable, *args):
    """``fn(*args)`` in the image worker (or the thread fallback) once the image slot is free. ``fn`` must be a
    top-level function of a module the worker can import (image_work.py) and its arguments and answer plain data.
    WorkerLost when the worker died with it."""
    global _busy
    slot = image_slot()
    await slot.acquire()
    loop = asyncio.get_running_loop()
    ours = True                                          # the slot is given back here (not by a thread or the worker)
    try:
        while True:
            pool = await _worker()
            if pool is None:
                ours = False
                return await _in_thread(slot, loop, fn, args)
            with _lock:
                _busy += 1
            try:
                job = pool.submit(fn, *args)
            except BrokenProcessPool as exc:             # it died while idle: this job never started, so try again
                _job_done()
                _broke(pool, f"it died while idle: {exc}")
                continue
            except RuntimeError:                         # stopped as idle just now
                _job_done()
                _drop(pool)
                continue
            job.add_done_callback(_job_done)
            break
        try:
            return await asyncio.wrap_future(job)
        except BrokenProcessPool as exc:
            _broke(pool, f"it died during a job: {exc}")
            raise WorkerLost(str(exc)) from exc
        except asyncio.CancelledError:
            if not job.done():                           # the worker is still at it: it keeps the slot till it ends
                ours = False
                job.add_done_callback(lambda _f: _release(loop, slot))
            raise
    finally:
        if ours:
            slot.release()


async def _in_thread(slot: asyncio.Semaphore, loop: asyncio.AbstractEventLoop, fn: Callable, args: tuple):
    """The fallback: ``fn(*args)`` in a thread of this process. The slot is given back when the THREAD ends."""
    gate, state_ = threading.Lock(), {"started": False, "dropped": False}

    def job():
        with gate:
            if state_["dropped"]:                        # cancelled before the thread got to it
                return None
            state_["started"] = True
        try:
            return fn(*args)
        finally:
            _release(loop, slot)

    try:
        return await loop.run_in_executor(None, job)
    except BaseException:
        with gate:
            if not state_["started"]:
                state_["dropped"] = True
                slot.release()
        raise


# -- faces ------------------------------------------------------------------------------------------------------
def faces_available() -> bool:
    """Faces can be found here. The worker's answer once it has given one; before that, whether ONNX Runtime and numpy
    are installed (found without importing them: the server never loads ONNX Runtime). In the thread fallback,
    faces.available() itself."""
    if _threads():
        return face_finder.available()
    if _faces is not None:
        return _faces
    return face_finder.installed()


async def faces_ready() -> str | None:
    """Make the worker's face detector now: None when it is ready, else why it isn't."""
    global _faces
    available, why = await run(image_work.detector_ready)
    if not _threads():
        _faces = available
    return why


async def look(path: Path | str | None) -> list | None:
    """The face backfill's look at one stored file (image_work.look), in its turn with the uploads."""
    return await run(image_work.look, None if path is None else str(path))


# -- Time Behind's cut-outs (cutout.py) ---------------------------------------------------------------------------
def cutouts_available() -> bool:
    """Cut-outs can be made here: the worker's answer once it has given one; before that, whether the model is the
    expected file and ONNX Runtime is installed (the server never loads it). In the thread fallback,
    cutout.available() itself."""
    if _threads():
        return cutter.available()
    if _cutouts is not None:
        return _cutouts
    return cutter.installed()


async def cutouts_ready() -> str | None:
    """Load the worker's cut-out model now: None when it is ready, else why it isn't."""
    global _cutouts
    available, why = await run(image_work.cutter_ready)
    if not _threads():
        _cutouts = available
    return why


async def cut_look(path: Path | str | None, faces: list | None = None) -> dict | None:
    """The cut-out backfill's look at one stored file (image_work.cut_look), in its turn with the uploads."""
    return await run(image_work.cut_look, None if path is None else str(path), faces)


def reset() -> None:
    """Stop the worker and forget every fallback (the tests; a server's own start begins this way)."""
    global _pool, _pid, _busy, _timer, _breaks, _fallback, _faces, _cutouts
    with _lock:
        pool, timer = _pool, _timer
        _pool = _pid = _timer = _faces = _cutouts = None
        _busy = _breaks = 0
        _fallback = False
    if timer is not None:
        timer.cancel()
    if pool is not None:
        with contextlib.suppress(Exception):
            pool.shutdown(wait=True, cancel_futures=True)
