#!/bin/sh
# Build HK, start the scratch HA, run the click-through, stop HA. See README.md.
set -e
cd "$(dirname "$0")/../.."
PY="${TESTHA_PY:-$HOME/.venvs/mantel/bin/python}"
trap '"$PY" tools/testha/testha.py down' EXIT
"$PY" tools/testha/testha.py up "$@"
"$PY" tools/testha/check.py
