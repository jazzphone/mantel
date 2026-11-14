"""What an uploaded APK is, read before any tablet is offered it (android.py): the package, its version and the key
that signed it.

Mantel doesn't check the signature itself -- Android does, and refuses an update signed by another key -- but it reads
which certificate signed the APK (APK Signature Scheme v2 or v3, the block before the zip's central directory) so a
file signed by another key, a debug build say, is refused here with a reason instead of failing on every tablet. The
package and version are in the compiled AndroidManifest.xml (Android's binary XML). Plain Python, no Android tools.
"""
from __future__ import annotations

import hashlib
import io
import struct
import zipfile
from dataclasses import dataclass

PACKAGE = "com.jazzphone.mantel.android"
SIG_MAGIC = b"APK Sig Block 42"
SIG_V2, SIG_V3 = 0x7109871A, 0xF05368C0
# android:versionCode and android:versionName, as the compiled manifest's resource map names them
VERSION_CODE_ID, VERSION_NAME_ID = 0x0101021B, 0x0101021C


class ApkError(ValueError):
    """Why a file isn't an APK Mantel can offer the tablets: `code` for the page, the sentence for a person."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class Apk:
    package: str
    version_code: int
    version_name: str
    signer: str                 # SHA-256 of the signing certificate (DER), hex


def inspect(data: bytes) -> Apk:
    """The APK in `data`, or ApkError saying what it is not."""
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            manifest = z.read("AndroidManifest.xml")
    except (zipfile.BadZipFile, KeyError, OSError, EOFError):
        raise ApkError("not_apk", "That file isn’t an Android app (APK).") from None
    try:
        package, code, name = manifest_of(manifest)
    except (struct.error, IndexError, ValueError, UnicodeDecodeError):
        raise ApkError("not_apk", "That file’s app manifest can’t be read.") from None
    if package != PACKAGE:
        raise ApkError("wrong_app", f"That’s another app ({package or 'no package'}), not Mantel for Android.")
    if code is None or code <= 0:
        raise ApkError("not_apk", "That app has no version number.")
    try:
        signer = signer_of(data)
    except (struct.error, IndexError, ValueError):
        signer = None
    if signer is None:
        raise ApkError("unsigned", "That app isn’t signed for an update (no APK signature v2 or v3).")
    return Apk(package, code, name or str(code), signer)


# ------------------------------------------------------------------------------------------- Android's binary XML
def _strings(buf: bytes, at: int) -> list[str]:
    _type, header, _size, count, _styles, flags, start, _ = struct.unpack_from("<HHIIIIII", buf, at)
    utf8 = bool(flags & 0x100)
    out = []
    for i in range(count):
        (off,) = struct.unpack_from("<I", buf, at + header + 4 * i)
        p = at + start + off
        if utf8:
            p += 2 if buf[p] & 0x80 else 1                 # the length in UTF-16 units, then in bytes
            n = buf[p]
            if n & 0x80:
                n, p = ((n & 0x7F) << 8) | buf[p + 1], p + 2
            else:
                p += 1
            out.append(buf[p:p + n].decode("utf-8", "replace"))
        else:
            (n,) = struct.unpack_from("<H", buf, p)
            if n & 0x8000:
                (lo,) = struct.unpack_from("<H", buf, p + 2)
                n, p = ((n & 0x7FFF) << 16) | lo, p + 4
            else:
                p += 2
            out.append(buf[p:p + 2 * n].decode("utf-16-le", "replace"))
    return out


def manifest_of(buf: bytes) -> tuple[str, int | None, str | None]:
    """The <manifest> element's package, android:versionCode and android:versionName."""
    if struct.unpack_from("<H", buf, 0)[0] != 0x0003:
        raise ValueError("not binary XML")
    strings: list[str] = []
    ids: list[int] = []
    at = struct.unpack_from("<H", buf, 2)[0]
    while at + 8 <= len(buf):
        kind, header, size = struct.unpack_from("<HHI", buf, at)
        if size < 8:
            raise ValueError("bad chunk")
        if kind == 0x0001:
            strings = _strings(buf, at)
        elif kind == 0x0180:
            ids = list(struct.unpack_from(f"<{(size - header) // 4}I", buf, at + header))
        elif kind == 0x0102:                                # the first element is <manifest>
            _ns, name, a_start, a_size, a_count = struct.unpack_from("<IIHHH", buf, at + header)
            if strings[name] != "manifest":
                raise ValueError("no <manifest>")
            package, code, version = "", None, None
            for i in range(a_count):
                p = at + header + a_start + i * a_size
                _ns, a_name, raw, _sz, _r, dtype, value = struct.unpack_from("<IIIHBBI", buf, p)
                rid = ids[a_name] if a_name < len(ids) else 0
                label = strings[a_name] if a_name < len(strings) else ""
                text = strings[raw] if raw != 0xFFFFFFFF else (strings[value] if dtype == 0x03 else None)
                if label == "package":
                    package = text or ""
                elif rid == VERSION_CODE_ID or label == "versionCode":
                    code = value if dtype in (0x10, 0x11) else (int(text) if text and text.isdigit() else None)
                elif rid == VERSION_NAME_ID or label == "versionName":
                    version = text
            return package, code, version
        at += size
    raise ValueError("no <manifest>")


# ------------------------------------------------------------------------------------ the APK's signing block
def _seq(buf: bytes, p: int, end: int):
    """The length-prefixed items in buf[p:end] (u32 length, then the item), as (start, end) pairs."""
    while p + 4 <= end:
        (n,) = struct.unpack_from("<I", buf, p)
        if p + 4 + n > end:
            raise ValueError("bad length")
        yield p + 4, p + 4 + n
        p += 4 + n


def _first(buf: bytes, p: int, end: int) -> tuple[int, int]:
    """The one length-prefixed item at p (u32 length, then the item)."""
    (n,) = struct.unpack_from("<I", buf, p)
    if p + 4 + n > end:
        raise ValueError("bad length")
    return p + 4, p + 4 + n


def signer_of(buf: bytes) -> str | None:
    """SHA-256 (hex) of the first signer's certificate in the v3 or v2 signing block, or None without one."""
    eocd = buf.rfind(b"PK\x05\x06", max(0, len(buf) - 65557))
    if eocd < 0:
        return None
    (cd,) = struct.unpack_from("<I", buf, eocd + 16)
    if cd < 32 or buf[cd - 16:cd] != SIG_MAGIC:
        return None
    (size,) = struct.unpack_from("<Q", buf, cd - 24)
    start = cd - size - 8
    if start < 0 or struct.unpack_from("<Q", buf, start)[0] != size:
        return None
    blocks: dict[int, tuple[int, int]] = {}
    p = start + 8
    while p + 12 <= cd - 24:
        (n,) = struct.unpack_from("<Q", buf, p)
        (bid,) = struct.unpack_from("<I", buf, p + 8)
        blocks[bid] = (p + 12, p + 8 + n)
        p += 8 + n
    for bid in (SIG_V3, SIG_V2):
        if bid not in blocks:
            continue
        s, e = blocks[bid]
        signers = _first(buf, s, e)
        for s1, e1 in _seq(buf, *signers, ):
            signed = _first(buf, s1, e1)
            digests = _first(buf, *signed)
            certs = _first(buf, digests[1], signed[1])
            for c0, c1 in _seq(buf, *certs):
                return hashlib.sha256(buf[c0:c1]).hexdigest()
    return None
