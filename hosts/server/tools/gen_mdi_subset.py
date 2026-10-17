"""Write web/mdi/ (the Material Design Icons HK actually names) from @mdi/js (Apache-2.0).

HK's `hk:` iconset falls back to MDI paths fetched from /static/mdi/iconMetadata.json plus chunk
files ({name: path}); Mantel serves a subset at the same URLs. The subset is every word in HK's
frontend, the captured settings and any extra text files that is an icon name, so a name HK or the
house's own settings uses is there.

    python hosts/server/tools/gen_mdi_subset.py /path/to/node_modules/@mdi/js [extra-text-file ...]
"""
import json
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
src = Path(sys.argv[1])
exports = dict(re.findall(r'export var (mdi\w+) = "([^"]+)"', (src / "mdi.js").read_text()))
texts = [p for d in ("frontend", "backend") for p in (ROOT / "spikes/hk-snapshot" / d).rglob("*") if p.suffix in (".js", ".py", ".json", ".css")]
texts += list((ROOT / "spikes/hk-snapshot/fixtures").glob("*.json")) + [Path(a) for a in sys.argv[2:]]
words: set[str] = set()
for p in texts:
    try:
        words |= set(re.findall(r"[a-z][a-z0-9]*(?:-[a-z0-9]+)*", p.read_text(errors="ignore")))
    except OSError:
        pass
icons = {}
for w in sorted(words):
    ident = "mdi" + "".join(part[:1].upper() + part[1:] for part in w.split("-"))
    if ident in exports:
        icons[w] = exports[ident]
out = ROOT / "web" / "mdi"
out.mkdir(parents=True, exist_ok=True)
(out / "icons.json").write_text(json.dumps(icons, separators=(",", ":"), sort_keys=True))
(out / "iconMetadata.json").write_text(json.dumps({"version": "7.4.47", "parts": [{"file": "icons"}]}))
shutil.copy(src / "LICENSE", out / "LICENSE")
print(f"{len(icons)} icons of {len(exports)} -> web/mdi ({(out / 'icons.json').stat().st_size:,} bytes)")
