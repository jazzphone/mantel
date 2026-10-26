"""web/shim/ as ES modules node can load: web/ has no package.json saying so, and the files are .js, so each copy is
named .mjs and its relative imports follow. One copy of the whole tree (settings/ too), so a page script that is split
into files imports its pieces as the browser does."""
import re
from pathlib import Path

SHIM = Path(__file__).resolve().parents[1] / "web" / "shim"
IMPORT = re.compile(r"""((?:from|import)\s*)(['"])(\.{1,2}/[^'"]+)\.js\2""")


def copy_shim(dest: Path) -> Path:
    """Copy web/shim/ into `dest` as .mjs (imports rewritten); the path of mantel-settings.mjs there."""
    for src in sorted(SHIM.rglob("*.js")):
        out = dest / src.relative_to(SHIM).with_suffix(".mjs")
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(IMPORT.sub(r"\1\2\3.mjs\2", src.read_text(encoding="utf-8")), encoding="utf-8")
    return dest / "mantel-settings.mjs"


def settings_source() -> str:
    """The page script's text, the entry and web/shim/settings/*.js together (tests that look for a string in it)."""
    return "\n".join(p.read_text(encoding="utf-8") for p in [SHIM / "mantel-settings.js", *sorted((SHIM / "settings").glob("*.js"))])
