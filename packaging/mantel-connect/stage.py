"""Create a self-contained local HA App directory, without secrets or other repo data."""
import argparse
import shutil
from pathlib import Path


def stage(output: Path):
    source = Path(__file__).resolve().parent
    code = source.parents[1] / "hosts/server/mantel_connect"
    # Never merge into an existing app or overwrite user files.
    output.mkdir(parents=True, exist_ok=False)
    for name in ("config.yaml", "Dockerfile", "README.md"):
        shutil.copyfile(source / name, output / name)
    shutil.copytree(code, output / "mantel_connect", ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))


def stage_receiver(output: Path):
    source = Path(__file__).resolve().parent
    code = source.parents[1] / "hosts/server"
    output.mkdir(parents=True, exist_ok=False)
    (output / "mantel_server").mkdir()
    for name in ("__init__.py", "config.py", "store.py", "db.py", "guards.py", "sessions.py", "connect_proof.py"):
        shutil.copyfile(code / "mantel_server" / name, output / "mantel_server" / name)
    shutil.copytree(code / "mantel_server/migrations", output / "mantel_server/migrations",
                    ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    (output / "mantel_connect").mkdir()
    for name in ("__init__.py", "channel.py"):
        shutil.copyfile(code / "mantel_connect" / name, output / "mantel_connect" / name)
    shutil.copyfile(source / "setup-receiver.sh", output / "setup-receiver.sh")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    parser.add_argument("--receiver", action="store_true", help="stage minimal receiver instead of the HA App")
    args = parser.parse_args()
    (stage_receiver if args.receiver else stage)(args.output)
