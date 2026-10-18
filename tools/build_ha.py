"""Build a new HA/HACS staging directory from Mantel. Never installs or publishes."""
from __future__ import annotations

import argparse
import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
COMPONENT = ROOT / "hosts/ha/custom_components/hk_frontend"


def publisher():
    path = COMPONENT / "tools/publish/publish.py"
    spec = importlib.util.spec_from_file_location("hk_publisher", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def plan() -> list[tuple[str, str]]:
    return publisher().plan()


def build(output: Path) -> int:
    module = publisher()
    pairs = plan()
    # Refuse private content before creating anything; never echo matching values.
    hits = module.scan(pairs) + module.scan_texts(module.wiki_pages())
    if hits:
        locations = [line.split(": ", 1)[0] for line in hits]
        raise ValueError("Private data scan failed at " + ", ".join(locations[:10]))
    destinations = [dest for _, dest in pairs]
    if len(destinations) != len(set(destinations)):
        raise ValueError("Build plan has duplicate destinations")
    output = Path(output).resolve()
    # Never wipe an existing directory, including an existing HA installation or Git checkout.
    output.mkdir(parents=True, exist_ok=False)
    module.build(str(output), pairs)
    return len(pairs)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path, help="new, nonexistent staging directory")
    args = parser.parse_args(argv)
    print(f"Built {build(args.output)} files in {args.output}")


if __name__ == "__main__":
    main()
