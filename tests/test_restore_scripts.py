"""packaging/compose/restore.sh and the LXC's `mantel.sh restore`: moving another Mantel's backup (the Home Assistant
App's) in with its keys file. Run against stand-ins for docker, pct, id, chown and install that record what they were
asked, so the order is pinned: check first and change nothing on a bad backup, swap the keys only after the check,
put them back when the restore fails, and remove the copies either way."""
import os
import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
RESTORE_SH = ROOT / "packaging/compose/restore.sh"
MANTEL_SH = ROOT / "packaging/lxc/mantel.sh"

DOCKER = r"""#!/bin/sh
echo "docker $*" >> "$LOG"
case " $* " in
  *" ps "*) [ -n "$RUNNING" ] && echo c0ffee; exit 0 ;;
  *" --verify-only "*) [ -n "$FAIL_VERIFY" ] && exit 1
    case " $* " in *" --write-keys "*)
      work=$(echo "$*" | sed -n 's/.* -v \([^ ]*\):\/restore .*/\1/p')
      echo NEW-AT-REST > "$work/keys/at_rest.key"; echo NEW-BACKUP > "$work/keys/backup.key" ;; esac
    exit 0 ;;
  *" --replace "*) [ -n "$FAIL_RESTORE" ] && exit 1; exit 0 ;;
esac
exit 0
"""
STUBS = {
    "docker": DOCKER,
    "id": '#!/bin/sh\n[ "$1" = -u ] && { echo 0; exit 0; }\nexec /usr/bin/id "$@"\n',
    "chown": "#!/bin/sh\nexit 0\n",
    # install -o root -g 10001 -m 0440 SRC DST
    "install": '#!/bin/sh\nfor a; do src=$dst; dst=$a; done\n'
               '[ -n "$FAIL_INSTALL" ] && case "$dst" in *backup.key) exit 1 ;; esac\n'
               'cp "$src" "$dst" && chmod 0440 "$dst"\n',
}


def _bin(tmp_path: Path, stubs: dict) -> Path:
    b = tmp_path / "bin"
    b.mkdir(exist_ok=True)
    for name, body in stubs.items():
        (b / name).write_text(body)
        (b / name).chmod(0o755)
    return b


@pytest.fixture
def stack(tmp_path):
    """A compose folder holding a copy of restore.sh, a secrets folder with the new install's keys, and a backup."""
    compose = tmp_path / "compose"
    compose.mkdir()
    shutil.copy(RESTORE_SH, compose / "restore.sh")
    secrets = tmp_path / "secrets"
    secrets.mkdir()
    (secrets / "at_rest.key").write_text("OLD-AT-REST\n")
    (secrets / "backup.key").write_text("OLD-BACKUP\n")
    (compose / ".env").write_text(f"MANTEL_SECRETS_DIR={secrets}\n")
    (tmp_path / "app.mbk").write_bytes(b"fictional backup")
    (tmp_path / "mantel-keys.json").write_text('{"format": "mantel-keys"}')
    return tmp_path


def restore(stack: Path, *args: str, **env: str) -> tuple[subprocess.CompletedProcess, list[str]]:
    log = stack / "log"
    log.write_text("")
    path = f"{_bin(stack, STUBS)}:{os.environ['PATH']}"
    clean = {k: v for k, v in os.environ.items() if k not in ("RUNNING", "FAIL_VERIFY", "FAIL_RESTORE", "FAIL_INSTALL", "MANTEL_SECRETS_DIR")}
    r = subprocess.run(["bash", str(stack / "compose/restore.sh"), *args], capture_output=True, text=True,
                       env={**clean, "PATH": path, "LOG": str(log), **env})
    return r, log.read_text().splitlines()


def keys(stack: Path) -> tuple[str, str]:
    s = stack / "secrets"
    return (s / "at_rest.key").read_text().strip(), (s / "backup.key").read_text().strip()


def work_dirs(calls: list[str]) -> set[Path]:
    return {Path(m) for c in calls for m in re.findall(r"-v (\S+):/restore", c)}


def test_another_mantels_backup_is_checked_then_its_keys_put_in_place(stack):
    r, calls = restore(stack, str(stack / "app.mbk"), str(stack / "mantel-keys.json"), RUNNING="1")
    assert r.returncode == 0, r.stderr + r.stdout
    verbs = [("verify" if "--verify-only" in c else "restore" if "--replace" in c else
              "stop" if " stop " in c else "up" if " up " in c else "ps" if " ps " in c else c) for c in calls]
    assert verbs == ["verify", "ps", "stop", "restore", "up"], calls
    assert "--keys-file /restore/keys.json --write-keys /restore/keys" in calls[0]
    assert "--force-recreate mantel-server" in calls[-1], "recreated, so it mounts the new key files"
    assert keys(stack) == ("NEW-AT-REST", "NEW-BACKUP")
    kept = sorted(p.name.split(".before-restore-")[0] for p in (stack / "secrets").glob("*.before-restore-*"))
    assert kept == ["at_rest.key", "backup.key"]
    assert oct((stack / "secrets/at_rest.key").stat().st_mode)[-3:] == "440"
    assert all(not d.exists() for d in work_dirs(calls)), "the copies of the backup and keys are removed"
    assert "keep it with your backups' keys" in r.stdout and "Connections" in r.stdout


def test_a_backup_that_does_not_check_out_changes_nothing(stack):
    r, calls = restore(stack, str(stack / "app.mbk"), str(stack / "mantel-keys.json"), RUNNING="1", FAIL_VERIFY="1")
    assert r.returncode == 1 and "nothing was changed" in r.stderr
    assert len(calls) == 1 and "--verify-only" in calls[0], "not even stopped"
    assert keys(stack) == ("OLD-AT-REST", "OLD-BACKUP")
    assert all(not d.exists() for d in work_dirs(calls))


def test_a_failed_restore_puts_the_old_keys_back_and_starts_mantel_again(stack):
    r, calls = restore(stack, str(stack / "app.mbk"), str(stack / "mantel-keys.json"), RUNNING="1", FAIL_RESTORE="1")
    assert r.returncode == 1 and "the data was not changed" in r.stderr
    assert keys(stack) == ("OLD-AT-REST", "OLD-BACKUP")
    assert not list((stack / "secrets").glob("*.before-restore-*"))
    assert " up " in calls[-1]


def test_keys_half_swapped_when_the_script_stops_are_put_back_and_mantel_starts_again(stack):
    """DEP-11 (audit, third pass): only a failed restore put the old keys back. A set -e exit between moving the
    first key aside and the restore (a failed install of the second key, Ctrl-C, a closed terminal) left the new
    at_rest.key beside the old data and Mantel stopped."""
    r, calls = restore(stack, str(stack / "app.mbk"), str(stack / "mantel-keys.json"), RUNNING="1", FAIL_INSTALL="1")
    assert r.returncode != 0
    assert keys(stack) == ("OLD-AT-REST", "OLD-BACKUP"), "both old keys are back"
    assert not list((stack / "secrets").glob("*.before-restore-*"))
    assert not any("--replace" in c for c in calls), "the data was never touched"
    assert " up " in calls[-1] and "--force-recreate" not in calls[-1], "Mantel runs again, as it was"
    assert all(not d.exists() for d in work_dirs(calls))


def test_its_own_backup_on_a_new_install_keeps_the_keys_and_leaves_mantel_stopped(stack):
    r, calls = restore(stack, str(stack / "app.mbk"))
    assert r.returncode == 0, r.stderr + r.stdout
    assert "--keys-file" not in calls[0] and not any(" up " in c for c in calls)
    assert keys(stack) == ("OLD-AT-REST", "OLD-BACKUP")
    assert "Start Mantel when .env is ready" in r.stdout


def test_it_refuses_what_is_missing(stack):
    r, calls = restore(stack, str(stack / "nothing.mbk"))
    assert r.returncode == 1 and "no such backup file" in r.stderr and calls == []
    r, calls = restore(stack, str(stack / "app.mbk"), str(stack / "nothing.json"))
    assert r.returncode == 1 and "no such keys file" in r.stderr and calls == []


PCT = r"""#!/bin/sh
echo "pct $*" >> "$LOG"
case " $* " in *" test -f "*) ;; *"restore.sh"*) [ -n "$FAIL" ] && exit 3 ;; esac
exit 0
"""


def _bash4() -> str | None:
    for cand in (shutil.which("bash"), "/opt/homebrew/bin/bash", "/usr/local/bin/bash", "/bin/bash"):
        if cand and Path(cand).is_file():
            r = subprocess.run([cand, "-c", "echo ${BASH_VERSINFO[0]}"], capture_output=True, text=True)
            if r.stdout.strip().isdigit() and int(r.stdout) >= 4:
                return cand
    return None


@pytest.mark.skipif(_bash4() is None, reason="mantel.sh needs bash 4 or later")
@pytest.mark.parametrize("fail", [False, True])
def test_the_lxc_restore_copies_in_runs_restore_sh_and_removes_the_copies(stack, fail):
    log = stack / "log"
    log.write_text("")
    path = f"{_bin(stack, {'pct': PCT})}:{os.environ['PATH']}"
    env = {**{k: v for k, v in os.environ.items() if not k.startswith("var_")}, "PATH": path, "LOG": str(log),
           **({"FAIL": "1"} if fail else {})}
    r = subprocess.run([_bash4(), "-c", f'source "{MANTEL_SH}"; restore_backup 120 "$0" "$1"',
                        str(stack / "app.mbk"), str(stack / "mantel-keys.json")], capture_output=True, text=True, env=env)
    calls = log.read_text().splitlines()
    assert (r.returncode != 0) == fail, r.stderr
    assert any(c.startswith("pct push 120 ") and c.endswith("/root/mantel-restore/backup.mbk --perms 0600") for c in calls)
    assert any(c.endswith("/root/mantel-restore/mantel-keys.json --perms 0600") for c in calls)
    run = [c for c in calls if "restore.sh" in c and "test -f" not in c]
    assert run == ["pct exec 120 -- bash /opt/mantel/packaging/compose/restore.sh /root/mantel-restore/backup.mbk "
                   "/root/mantel-restore/mantel-keys.json"]
    assert calls[-1] == "pct exec 120 -- rm -rf /root/mantel-restore", "the copies go even when it fails"
    if fail:
        assert "data was not changed" in r.stderr


@pytest.mark.skipif(_bash4() is None, reason="mantel.sh needs bash 4 or later")
def test_var_restore_is_checked_before_anything_is_made(stack):
    clean = {k: v for k, v in os.environ.items() if not k.startswith("var_")}
    run = lambda **v: subprocess.run([_bash4(), "-c", f'source "{MANTEL_SH}"; variables'], capture_output=True,
                                     text=True, env={**clean, **v})
    assert run(var_restore=str(stack / "app.mbk"), var_restore_keys=str(stack / "mantel-keys.json")).returncode == 0
    assert "no such backup file" in run(var_restore=str(stack / "none.mbk")).stderr
    assert "needs var_restore" in run(var_restore_keys=str(stack / "mantel-keys.json")).stderr
