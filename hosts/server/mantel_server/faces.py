"""WHERE THE FACES ARE: Mantel Photos' focus points (docs/phase4/PHOTOS.md, "Keep in View").

The screensavers crop a photo to fill a screen or a mosaic cell. Cropping around the middle cuts heads off, so
Mantel finds where a photo's faces are, once, and the screensavers keep them in view. Only *where* faces are is
found -- boxes, never who anyone is -- on this server, and nothing leaves the house.

* **Detector.** YuNet (``models/face_detection_yunet_2023mar.onnx``, MIT, OpenCV Zoo), run by ONNX Runtime on the
  CPU, one thread, so it never starves the server. The model's SHA-256 is checked before it is loaded. The model has
  a fixed 640x640 input: a picture is scaled to 640 px on its long side and padded. Its raw outputs are decoded here
  (``decode``) and duplicate boxes removed (``nms``), as OpenCV's ``FaceDetectorYN`` does.
* **What is kept** (``keep``). Faces scoring 0.7 or more; then faces smaller than a quarter of the largest are
  dropped (people in the background), and at most 12 are kept, largest first. Stored as fractions of the upright
  picture: ``[x, y, w, h, score]``.
* **Where it runs.** In the image worker process (imaging.py, image_work.py), never in the server's: on upload
  (``process``, on the screen-sized copy it has just made) and in the backfill (photos.FaceBackfill, through
  ``imaging.look``) for photos stored before. The worker keeps one ``Detector`` for its life (it stops after 5 idle
  minutes); ONNX Runtime is imported there only (about 140 MB installed, some tens of MB of memory). In the thread
  fallback, a ``Detector`` per photo, in the server's process.
* **Without it.** ``available()`` is False when ONNX Runtime or numpy can't be imported on this platform (logged
  once). Uploads work as before; photos stay "not checked", and the screens use their own focus.
"""
from __future__ import annotations

import hashlib
import logging
import time
from pathlib import Path
from typing import Any

log = logging.getLogger("mantel.faces")

MODEL = Path(__file__).with_name("models") / "face_detection_yunet_2023mar.onnx"
MODEL_SHA256 = "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4"
NAME = "yunet-2023mar"
SIZE = 640                  # the model's input, square
STRIDES = (8, 16, 32)
SCORE_MIN = 0.7
NMS_IOU = 0.3
FACES_MAX = 12
SMALL = 0.25                # a face under a quarter of the largest's area is dropped

_runtime: Any = None        # None: not tried yet; False: unavailable; else (onnxruntime, numpy)


def _load_runtime():
    global _runtime
    if _runtime is None:
        try:
            import numpy
            import onnxruntime
            _runtime = (onnxruntime, numpy)
        except Exception as exc:  # noqa: BLE001 -- ImportError, or a wheel that won't load on this CPU
            log.warning("faces aren't found on this platform (%s: %s); the screens' own focus is used",
                        type(exc).__name__, exc)
            _runtime = False
    return _runtime


def available() -> bool:
    """ONNX Runtime and numpy can be imported here (tried once, remembered)."""
    return bool(_load_runtime())


def installed() -> bool:
    """ONNX Runtime and numpy are installed here, found WITHOUT importing them: the server's answer until the image
    worker (imaging.py), where they are imported, has said whether they load."""
    if _runtime is not None:
        return bool(_runtime)
    from importlib.util import find_spec
    try:
        return all(find_spec(m) is not None for m in ("numpy", "onnxruntime"))
    except (ImportError, ValueError):
        return False


def model_ok(path: Path = MODEL) -> bool:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest() == MODEL_SHA256
    except OSError:
        return False


# -- decoding YuNet's outputs (pure numpy, tested on synthetic tensors) ---------------------------------------
def decode(outs: dict, np, size: int = SIZE, score_min: float = SCORE_MIN):
    """YuNet 2023mar's twelve outputs -> (boxes Nx4 as x, y, w, h in input pixels, scores N)."""
    boxes, scores = [], []
    for s in STRIDES:
        cols = size // s
        cls = np.clip(np.asarray(outs[f"cls_{s}"], dtype=np.float32).reshape(-1), 0, 1)
        obj = np.clip(np.asarray(outs[f"obj_{s}"], dtype=np.float32).reshape(-1), 0, 1)
        bb = np.asarray(outs[f"bbox_{s}"], dtype=np.float32).reshape(-1, 4)
        score = np.sqrt(cls * obj)
        idx = np.nonzero(score >= score_min)[0]
        if not idx.size:
            continue
        r, c = np.divmod(idx, cols)
        cx = (c + bb[idx, 0]) * s
        cy = (r + bb[idx, 1]) * s
        w = np.exp(np.clip(bb[idx, 2], -10, 10)) * s
        h = np.exp(np.clip(bb[idx, 3], -10, 10)) * s
        boxes.append(np.stack([cx - w / 2, cy - h / 2, w, h], axis=1))
        scores.append(score[idx])
    if not boxes:
        return np.zeros((0, 4), np.float32), np.zeros((0,), np.float32)
    return np.concatenate(boxes), np.concatenate(scores)


def nms(boxes, scores, np, iou: float = NMS_IOU) -> list[int]:
    """Greedy non-maximum suppression: the indices kept, best score first."""
    order = list(np.argsort(-scores, kind="stable"))
    x1, y1 = boxes[:, 0], boxes[:, 1]
    x2, y2 = x1 + boxes[:, 2], y1 + boxes[:, 3]
    area = np.maximum(boxes[:, 2], 0) * np.maximum(boxes[:, 3], 0)
    kept: list[int] = []
    while order:
        i = int(order.pop(0))
        kept.append(i)
        if not order:
            break
        rest = np.array(order)
        w = np.maximum(0, np.minimum(x2[i], x2[rest]) - np.maximum(x1[i], x1[rest]))
        h = np.maximum(0, np.minimum(y2[i], y2[rest]) - np.maximum(y1[i], y1[rest]))
        inter = w * h
        union = area[i] + area[rest] - inter
        over = np.where(union > 0, inter / np.where(union > 0, union, 1), 0)
        order = [int(j) for j, o in zip(rest, over) if o <= iou]
    return kept


def keep(faces: list) -> list:
    """Drop faces under a quarter of the largest's area; at most 12, largest first."""
    faces = [f for f in faces if f[2] > 0 and f[3] > 0]
    if not faces:
        return []
    faces = sorted(faces, key=lambda f: f[2] * f[3], reverse=True)
    big = faces[0][2] * faces[0][3]
    return [f for f in faces if f[2] * f[3] >= big * SMALL][:FACES_MAX]


class Detector:
    """One batch's detector: ``with Detector() as d: d.detect(img)``. Raises RuntimeError when it can't load."""

    def __init__(self, model: Path = MODEL) -> None:
        self.model = model
        self.session = None

    def __enter__(self) -> "Detector":
        rt = _load_runtime()
        if not rt:
            raise RuntimeError("the face detector isn't available on this platform")
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
        self.outputs = [o.name for o in self.session.get_outputs()]
        return self

    def __exit__(self, *exc) -> None:
        self.session = None

    def detect(self, img) -> list:
        """An upright PIL picture -> its kept faces ``[[x, y, w, h, score], ...]`` as fractions of the picture."""
        _, np = _runtime
        t0 = time.perf_counter()
        scale = SIZE / max(img.width, img.height)
        sw, sh = max(1, round(img.width * scale)), max(1, round(img.height * scale))
        small = img.convert("RGB").resize((sw, sh))
        x = np.zeros((1, 3, SIZE, SIZE), np.float32)
        x[0, :, :sh, :sw] = np.asarray(small, dtype=np.float32)[:, :, ::-1].transpose(2, 0, 1)   # BGR, as YuNet
        outs = dict(zip(self.outputs, self.session.run(self.outputs, {self.input: x})))
        boxes, scores = decode(outs, np)
        found = []
        for i in nms(boxes, scores, np):
            bx, by, bw, bh = (float(v) for v in boxes[i])
            x1, y1 = max(0.0, bx / sw), max(0.0, by / sh)
            x2, y2 = min(1.0, (bx + bw) / sw), min(1.0, (by + bh) / sh)
            if x2 > x1 and y2 > y1:
                found.append([round(x1, 4), round(y1, 4), round(x2 - x1, 4), round(y2 - y1, 4),
                              round(float(scores[i]), 3)])
        faces = keep(found)
        log.debug("faces: %d found, %d kept in %.0f ms", len(found), len(faces), (time.perf_counter() - t0) * 1000)
        return faces


def find(img) -> list | None:
    """One picture's kept faces, or None when the detector is unavailable or fails (never raises)."""
    if not available():
        return None
    try:
        with Detector() as d:
            return d.detect(img)
    except Exception as exc:  # noqa: BLE001 -- detection never fails an upload
        log.warning("couldn't look for faces: %s: %s", type(exc).__name__, exc)
        return None
