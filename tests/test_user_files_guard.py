"""Guards for Your files and backups: nothing of Apple's, no uploaded data and no backup is ever tracked, and
the folders that hold them are git-ignored. The fixtures in test_user_files.py/test_backup.py are generated at
run time into tmp folders; this keeps it that way."""
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FONT_SUFFIXES = {".woff", ".woff2", ".ttf", ".otf", ".ttc"}


def _tracked():
    return subprocess.run(["git", "ls-files"], cwd=ROOT, capture_output=True, text=True, check=True).stdout.splitlines()


def test_no_font_glyph_upload_or_backup_file_is_tracked_in_tests_or_user_data_paths():
    bad = []
    for f in _tracked():
        p = Path(f)
        if p.parts[0] == "tests" and (p.suffix.lower() in FONT_SUFFIXES or "user-files" in p.parts
                                      or p.name.lower().startswith(("hk-glyphs", "sf-pro", "sf-symbols"))):
            bad.append(f)
        if "user-files" in p.parts or p.suffix == ".mbk" or p.name in ("backup.key", "at_rest.key"):
            bad.append(f)
    assert not bad, f"never track these: {bad}"


def test_user_data_and_backups_are_ignored():
    for rel in ("user-files/hk/fonts/SF-Pro.woff2", "data/user-files/hk/iconset/hk-glyphs.js",
                "data/user-files/photos/" + "a" * 32 + ".jpg", "nas/mantel-20261018-031500.mbk",
                "tests/fixtures/user-files/x.bin", "secrets/backup.key"):
        r = subprocess.run(["git", "check-ignore", "-q", rel], cwd=ROOT)
        assert r.returncode == 0, f"{rel} must be git-ignored"


def test_the_test_fixtures_do_not_embed_font_or_glyph_data():
    """The generated stand-ins are a few dozen bytes; nothing the size of a real font or glyph set is in the tests."""
    for name in ("test_user_files.py", "test_backup.py"):
        assert (ROOT / "tests" / name).stat().st_size < 60_000
