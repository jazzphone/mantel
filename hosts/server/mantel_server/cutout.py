"""TIME BEHIND: Mantel Photos' cut-outs (docs/phase4/PHOTOS.md, "Time Behind"; docs/phase11/HOMEVIEW-LOOK.md, Phase I,
decision 14).

The screensaver's Photo, Time Behind draws the time BEHIND the person or thing in a photo: the photo, then the time,
then the photo's subject cut out and laid over the time again. The cut-out is a mask of the subject, made once per
photo here -- never on a tablet -- and kept beside the photo. Only what is the subject and what isn't is found, never
who or what it is, and nothing leaves the house.

* **The model.** U²-Net's small form (``models/u2netp.onnx``, Apache-2.0, about 4.6 MB, as the rembg project
  publishes it), a salient-object model, run by ONNX Runtime on the CPU with one thread, so it never starves the
  server. Vendored on 2026-10-30, the owner's OK; its SHA-256 is checked before it is loaded (``MODEL_SHA256``).
  Without the file, or with another file in its place, ``available()`` is False and the feature is simply
  unavailable, as faces are without a detector (photos stay "not checked", the screens show the time in front, Setup
  Check says so).
* **Only where it works** (``judge``). A cut-out is good on a clear subject (a portrait, a pet, a plant on a plain
  wall) and bad on a group spread across the frame, a busy scene or a landscape with no subject. So each photo is
  checked once and marked usable only when the subject covers 8-60 % of the frame and the mask is sure of itself
  (few half-sure pixels). WHERE THE TIME GOES IS NOT DECIDED HERE (2026-10-30, the owner: "the time needs to be at the
  same spot on the screen... upper center"): the time is always upper centre, and each screen decides, with the
  photo as it draws it, whether the subject covers 5-35 % of the time there (hk-saver.js) -- then the subject is laid
  over it; else the time is in front. Photos judged by the old rules (`cutout_by` u2netp: the time placed behind
  the head, a mask kept only where that worked) are checked again by the backfill.
* **What is kept.** For a usable photo: the mask as a PNG the size of the screen copy (white, the mask in its 8-bit
  alpha, so a browser masks with it as it is); for every photo checked, the mask's confidence, the rules it was
  judged by (``BY``) and when. photos.py stores them.
* **Where it runs.** In the image worker process (imaging.py, image_work.py), never the server's: on upload, right
  after the faces, on the screen-sized copy; and in the backfill (photos.CutoutBackfill) for photos stored before.
"""
from __future__ import annotations

import hashlib
import io
import logging
import time
from pathlib import Path

from . import faces as face_finder

log = logging.getLogger("mantel.cutout")

# THE MODEL: U²-Net small, as the rembg project publishes it (Apache-2.0; models/u2netp_LICENSE), fetched from
# MODEL_URL and vendored at MODEL on 2026-10-30 (4,574,861 bytes).
MODEL = Path(__file__).with_name("models") / "u2netp.onnx"
MODEL_URL = "https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx"
MODEL_SHA256 = "309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8"
NAME = "u2netp"
# the rules a photo was judged by, kept as `cutout_by`: "u2netp" placed the time behind the head (2026-10-30 to
# 0.1.92); "u2netp/2", the time upper centre, decided by each screen
BY = NAME + "/2"
SIZE = 320                  # the model's input, square
MEAN, STD = (0.485, 0.456, 0.406), (0.229, 0.224, 0.225)

# WHEN A CUT-OUT IS USED (the plan's numbers; to tune on the house's photos)
COVER = (0.08, 0.60)        # the subject's share of the frame
SURE = 0.75                 # confidence: the share of the subject and its fringe that is sure (not half-sure)
HALF = (0.2, 0.8)           # a pixel between these is half-sure
GRID = 96                   # the judging grid's long side, px

_checked: dict[str, tuple] = {}     # a model file's (mtime, size, expected sum) -> its answer: hashed once


def model_ok(path: Path = MODEL) -> bool:
    """The model is there and is the expected file (always False while MODEL_SHA256 is unset)."""
    if not MODEL_SHA256:
        return False
    try:
        st = path.stat()
    except OSError:
        return False
    key = (st.st_mtime, st.st_size, MODEL_SHA256)
    got = _checked.get(str(path))
    if got is None or got[0] != key:
        try:
            ok = hashlib.sha256(path.read_bytes()).hexdigest() == MODEL_SHA256
        except OSError:
            ok = False
        got = _checked[str(path)] = (key, ok)
    return got[1]


def why_not() -> str | None:
    """Why cut-outs can't be made here, in words, or None when they can."""
    if not MODEL.is_file():
        return f"the cut-out model ({MODEL.name}) isn’t installed"
    if not MODEL_SHA256:
        return f"{MODEL.name}’s checksum isn’t set"
    if not model_ok():
        return f"{MODEL.name} isn’t the expected file"
    if not face_finder.installed():          # (found without importing it: the server never loads ONNX Runtime)
        return "ONNX Runtime can’t run on this platform"
    return None


def available() -> bool:
    """Cut-outs can be made here: the model is the expected file, and ONNX Runtime and numpy load."""
    return model_ok() and face_finder.available()


def installed() -> bool:
    """The same, found WITHOUT importing ONNX Runtime: the server's answer until the image worker has said."""
    return model_ok() and face_finder.installed()


# -- judging a mask (pure numpy; tested on synthetic masks) ------------------------------------------------------
def judge(mask, np, faces: list | None = None) -> dict:
    """A mask (2-D, 0..1, on the judging grid) -> ``{ok, why, cover, conf, overlap, box}``: a clear subject, sure of
    itself; ``why`` says what failed: ``size`` or ``unsure``. ``overlap`` and ``box`` stay None: where the time goes is
    each screen's (upper centre; hk-saver.js decides behind or in front). ``faces`` is no longer read."""
    m = np.clip(np.asarray(mask, dtype=np.float32), 0, 1)
    gh, gw = m.shape
    sub = m >= 0.5
    n = int(sub.sum())
    cover = n / float(gh * gw)
    half = int(((m > HALF[0]) & (m < HALF[1])).sum())
    conf = 1.0 - half / float(max(1, n + half))
    out = {"ok": False, "why": None, "cover": round(cover, 4), "conf": round(conf, 4), "overlap": None, "box": None}
    if not COVER[0] <= cover <= COVER[1]:
        out["why"] = "size"
        return out
    if conf < SURE:
        out["why"] = "unsure"
        return out
    out["ok"] = True
    return out


def grid_of(alpha_img, np):
    """The full-size mask (a PIL 'L' picture) -> the judging grid (GRID px on its long side), 0..1."""
    from PIL import Image
    w, h = alpha_img.size
    k = GRID / max(w, h)
    small = alpha_img.resize((max(1, round(w * k)), max(1, round(h * k))), Image.BILINEAR)
    return np.asarray(small, dtype=np.float32) / 255.0


def mask_png(alpha_img) -> bytes:
    """The stored mask: white, the mask in its 8-bit alpha, so a browser masks with it as it is (an older WebKit has
    no luminance mask)."""
    from PIL import Image
    la = Image.merge("LA", (Image.new("L", alpha_img.size, 255), alpha_img))
    buf = io.BytesIO()
    la.save(buf, "PNG", optimize=True)
    return buf.getvalue()


def result(alpha_img, np, faces: list | None = None) -> dict:
    """A mask the size of the photo -> what is stored: judge's answer, ``by`` and, for a usable one, ``mask`` (PNG)."""
    got = judge(grid_of(alpha_img, np), np, faces)
    got["by"] = BY
    got["mask"] = mask_png(alpha_img) if got["ok"] else None
    return got


class Cutter:
    """One batch's model: ``with Cutter() as c: c.mask(img)``. Raises RuntimeError when it can't load."""

    def __init__(self, model: Path = MODEL) -> None:
        self.model = model
        self.session = None

    def __enter__(self) -> "Cutter":
        rt = face_finder._load_runtime()
        if not rt:
            raise RuntimeError("ONNX Runtime isn't available on this platform")
        ort, _ = rt
        if not model_ok(self.model):
            raise RuntimeError(f"{self.model.name} is missing or not the expected file")
        opts = ort.SessionOptions()
        opts.intra_op_num_threads = 1
        opts.inter_op_num_threads = 1
        opts.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
        opts.log_severity_level = 3
        self.session = ort.InferenceSession(str(self.model), opts, providers=["CPUExecutionProvider"])
        self.input = self.session.get_inputs()[0].name
        return self

    def __exit__(self, *exc) -> None:
        self.session = None

    def mask(self, img):
        """An upright PIL picture -> its subject's mask, a PIL 'L' picture of the same size (read as rembg reads
        U²-Net: the first output's first map, stretched to 0..255)."""
        from PIL import Image
        np = numpy()
        t0 = time.perf_counter()
        small = img.convert("RGB").resize((SIZE, SIZE), Image.LANCZOS)
        x = np.asarray(small, dtype=np.float32)
        x = x / max(float(x.max()), 1e-6)
        x = (x - np.array(MEAN, np.float32)) / np.array(STD, np.float32)
        x = x.transpose(2, 0, 1)[None].astype(np.float32)
        pred = np.asarray(self.session.run(None, {self.input: x})[0], dtype=np.float32).reshape(-1, SIZE, SIZE)[0]
        lo, hi = float(pred.min()), float(pred.max())
        pred = (pred - lo) / (hi - lo) if hi > lo else np.zeros_like(pred)
        out = Image.fromarray((pred * 255).clip(0, 255).astype(np.uint8), "L").resize(img.size, Image.BILINEAR)
        log.debug("cut-out: %dx%d in %.0f ms", img.width, img.height, (time.perf_counter() - t0) * 1000)
        return out


def numpy():
    """numpy, as the face detector's runtime loaded it (RuntimeError without it)."""
    rt = face_finder._load_runtime()
    if not rt:
        raise RuntimeError("numpy isn't available on this platform")
    return rt[1]


def find(img, faces: list | None = None) -> dict | None:
    """One picture's cut-out (``result``), or None when the model is unavailable or fails (never raises)."""
    if not available():
        return None
    try:
        with Cutter() as c:
            return result(c.mask(img), numpy(), faces)
    except Exception as exc:  # noqa: BLE001 -- a cut-out never fails an upload
        log.warning("couldn't make a cut-out: %s: %s", type(exc).__name__, exc)
        return None
